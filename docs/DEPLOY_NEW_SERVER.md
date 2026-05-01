# Deploying VMware Dashboard to a New Server

This guide covers everything needed to set up the auto-deploy CI/CD pipeline on a new server.
The pipeline uses a **GitHub Actions self-hosted runner** that runs directly on the target server —
no public IP or inbound SSH from GitHub is required.

---

## Overview

```
Developer pushes to main
        │
        ▼
GitHub Actions triggers workflow
        │
        ▼
Self-hosted runner (on the server) receives job
        │
        ├── git pull origin main
        ├── pip install -r requirements.txt
        ├── npm ci && npm run build
        ├── sudo systemctl restart vm-api vm-frontend
        └── curl /api/health  ← passes when API responds with {"status":"ok"}
```

---

## Prerequisites

Install on the new server before proceeding:

| Package | Minimum version | Install command (RHEL / CBL-Mariner) |
|---|---|---|
| Python | 3.9+ | `sudo dnf install -y python3 python3-pip` |
| Node.js | 18+ | `sudo dnf install -y nodejs` |
| npm | bundled with Node | — |
| git | any | `sudo dnf install -y git` |
| curl | any | `sudo dnf install -y curl` |

---

## Step-by-step Setup

### 1. Clone the repository

```bash
git clone git@github.com:your-github-org/vmware-dashboard.git ~/VMware-Dashboard
cd ~/VMware-Dashboard
```

> SSH access to GitHub is configured in Step 3. If you're bootstrapping for the first time, use HTTPS:
> `git clone https://github.com/your-github-org/vmware-dashboard.git ~/VMware-Dashboard`

---

### 2. Set up the application

```bash
cd ~/VMware-Dashboard

# Python virtual environment
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt

# Node dependencies + build
npm ci
npm run build

# Copy and fill in environment variables
cp .env.example .env
# Edit .env — set API_URL, PUPPETDB_URL, VM_ALLOWED_ORIGINS, etc.
```

---

### 3. Configure SSH key for GitHub (`git pull`)

The runner needs to authenticate to GitHub to pull code on each deploy.

```bash
# Generate a dedicated deploy key (no passphrase)
ssh-keygen -t ed25519 -C "github-actions-deploy-<server-name>" \
  -f ~/.ssh/vm_deploy_key -N ""

# Tell SSH to use this key for github.com
cat >> ~/.ssh/config << 'EOF'

Host github.com
  IdentityFile ~/.ssh/vm_deploy_key
  IdentitiesOnly yes
EOF
chmod 600 ~/.ssh/config

# Test the connection
ssh -T git@github.com
# Expected: "Hi your-github-org! You've successfully authenticated..."
```

**Add the public key to the GitHub repository:**

1. Copy the public key: `cat ~/.ssh/vm_deploy_key.pub`
2. Go to: `https://github.com/your-github-org/vmware-dashboard/settings/keys/new`
3. Title: `<server-name>-deploy-key`
4. Key: paste the public key
5. Leave **Allow write access** unchecked (read-only is sufficient)
6. Click **Add key**

Alternatively, use the `gh` CLI:
```bash
gh api -X POST repos/your-github-org/vmware-dashboard/keys \
  --field title="<server-name>-deploy-key" \
  --field key="$(cat ~/.ssh/vm_deploy_key.pub)" \
  --field read_only=true
```

---

### 4. Create systemd services

#### `vm-api.service` — FastAPI backend

Create `/etc/systemd/system/vm-api.service`:

```ini
[Unit]
Description=VMware Dashboard API
After=network.target

[Service]
Type=simple
User=<your-username>
WorkingDirectory=/home/<your-username>/VMware-Dashboard
ExecStart=/home/<your-username>/VMware-Dashboard/venv/bin/uvicorn main:app --host 0.0.0.0 --port 8000
EnvironmentFile=/home/<your-username>/VMware-Dashboard/.env
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

#### `vm-frontend.service` — Vite preview server

Create `/etc/systemd/system/vm-frontend.service`:

```ini
[Unit]
Description=VMware Dashboard Frontend
After=network.target

[Service]
Type=simple
User=<your-username>
WorkingDirectory=/home/<your-username>/VMware-Dashboard
ExecStart=/usr/bin/npx vite preview --host 0.0.0.0 --port 5173
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

Enable and start both services:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now vm-api vm-frontend
sudo systemctl status vm-api vm-frontend
```

---

### 5. Configure passwordless `sudo` for service restarts

The deploy workflow calls `sudo systemctl restart vm-api vm-frontend` without a password.

Create `/etc/sudoers.d/z-vm-deploy` (the `z-` prefix ensures it sorts last and overrides other rules):

```bash
cat > /tmp/vm-deploy-sudoers << EOF
Defaults:<your-username> !requiretty
<your-username> ALL=(ALL) NOPASSWD: /usr/bin/systemctl restart vm-api vm-frontend, /usr/bin/systemctl restart vm-api, /usr/bin/systemctl restart vm-frontend, /usr/bin/systemctl is-active vm-api vm-frontend, /usr/bin/systemctl is-active vm-api, /usr/bin/systemctl is-active vm-frontend
EOF

sudo cp /tmp/vm-deploy-sudoers /etc/sudoers.d/z-vm-deploy
sudo chmod 440 /etc/sudoers.d/z-vm-deploy
sudo visudo -c   # must print "parsed OK" — if not, fix before proceeding
```

> **Important:** The filename must sort alphabetically *after* any group sudoers files (e.g. `uadmins`)
> that grant password-required sudo. Using `z-` as a prefix ensures this.

Test that it works:

```bash
sudo -n systemctl is-active vm-api && echo "NOPASSWD OK"
```

---

### 6. Register the GitHub Actions self-hosted runner

```bash
mkdir ~/actions-runner && cd ~/actions-runner

# Download the runner (check https://github.com/actions/runner/releases for the latest version)
curl -Lo actions-runner.tar.gz \
  https://github.com/actions/runner/releases/download/v2.323.0/actions-runner-linux-x64-2.323.0.tar.gz
tar xzf actions-runner.tar.gz
```

Get a fresh registration token (valid for 1 hour):

```bash
# Option A — via gh CLI
gh api -X POST repos/your-github-org/vmware-dashboard/actions/runners/registration-token \
  --jq .token

# Option B — via GitHub UI
# Go to: https://github.com/your-github-org/vmware-dashboard/settings/actions/runners/new
# Copy the token from the --token argument shown on that page
```

Configure and register the runner:

```bash
./config.sh \
  --url https://github.com/your-github-org/vmware-dashboard \
  --token <TOKEN> \
  --name <server-name> \
  --work ~/actions-runner/_work \
  --unattended \
  --replace
```

Install as a systemd service and start it:

```bash
sudo ./svc.sh install <your-username>
sudo ./svc.sh start
sudo ./svc.sh status   # should show "active (running)"
```

---

### 7. Update `deploy.yml` for the new server path

If the project lives at a different path (e.g. not `/home/your-username/VMware-Dashboard`), update these lines in [`.github/workflows/deploy.yml`](../.github/workflows/deploy.yml):

```yaml
# Change all occurrences of:
cd /home/your-username/VMware-Dashboard
# To:
cd /home/<your-username>/VMware-Dashboard
```

Also update the health check port if the API runs on a port other than `8000`:

```yaml
# Change:
curl -sf http://localhost:8000/api/health
# To:
curl -sf http://localhost:<your-port>/api/health
```

### 8. Configure git `core.sshCommand` for the runner

The self-hosted runner runs as `your-username` but in a restricted environment that ignores `~/.ssh/config`.
This one-time config tells git which key to use for all GitHub operations in this repo:

```bash
cd ~/VMware-Dashboard
git config core.sshCommand "ssh -i /home/<your-username>/.ssh/vm_deploy_key -o StrictHostKeyChecking=no -o IdentitiesOnly=yes"
```

Commit and push the updated workflow to trigger the first deploy:

```bash
git add .github/workflows/deploy.yml
git commit -m "ci: update deploy paths for <server-name>"
git push origin main
```

---

## Verification

After setup, push any commit to `main` and check:

1. **GitHub Actions:** `https://github.com/your-github-org/vmware-dashboard/actions`  
   All steps should show green checkmarks.

2. **Runner status on the server:**
   ```bash
   sudo systemctl status actions.runner.your-github-org-vmware-dashboard.<server-name>
   ```

3. **Services running:**
   ```bash
   sudo systemctl is-active vm-api vm-frontend
   # Expected: active / active
   ```

4. **API health:**
   ```bash
   curl http://localhost:8000/api/health
   # Expected: {"status":"ok", ...}
   ```

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `Permission denied (publickey)` on git pull | Deploy key not added to GitHub | Redo Step 3 |
| `sudo: a password is required` | sudoers file sorts before `uadmins` | Rename to `z-vm-deploy` |
| `sudo: sorry, you must have a tty` | Missing `!requiretty` in sudoers | Add `Defaults:<user> !requiretty` |
| Health check fails with JSON error | API not ready within 5s | Workflow retries up to 60s automatically |
| Runner shows `Offline` in GitHub | Runner service stopped | `sudo ./svc.sh start` in `~/actions-runner` |
| `404 Not Found` during runner registration | Token expired (1hr limit) | Generate a new token and re-run `config.sh` |
