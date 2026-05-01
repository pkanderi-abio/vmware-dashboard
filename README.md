# VMware Dashboard

> **VMware Dashboard** — A full-stack monitoring tool for VMware vCenter environments.  
> Provides real-time visibility into ESXi hosts, virtual machines, datastores, networks, and VM snapshots across multiple vCenter endpoints.

---

## Changelog
<details>
    <summary>Click to expand!</summary>
  
        ### v2.9 — 2026-04-26
        **CMDB dark mode fixes, UUID display**
        - `cmdb.tsx`: All hardcoded `bg-*-50/100` colors replaced with `bg-*-500/15` + `dark:text-*-400` — full dark mode compatibility
        - `cmdb.tsx`: **BIOS UUID** and **Instance UUID** now shown in the CMDB Info expanded panel
        - `cmdb.tsx`: Row background tints changed to opacity-based variants (dark mode compatible)
        - `cmdb.tsx`: Puppet section expanded: shows Env, Uptime, Mem Total, Last Report
        - `cmdb.tsx`: "Custom Attributes & Puppet Facts" grid — purple tiles for Puppet facts alongside vCenter custom attributes
        - `cmdb.tsx`: Export split into **CSV** (with Puppet columns) and **JSON** (full record export)
        - `cmdb.tsx`: `PuppetData` interface expanded with all available puppet fact fields

        ### v2.4 — 2026-04-25
        **CI/CD auto-deploy pipeline**
        - `.github/workflows/deploy.yml`: Self-hosted runner (`cie-server`) — git pull, pip install, npm build, systemctl restart, health-check retry loop
        - `.github/workflows/ci.yml`: PR validation — tsc + build check
        - `docs/DEPLOY_NEW_SERVER.md`: Full guide for CI/CD setup on a new server
        - `/etc/sudoers.d/z-vm-deploy`: NOPASSWD systemctl rules (z- prefix overrides uadmins group)
        - `.env` + `EnvironmentFile` in `vm-api.service`: environment variables loaded by systemd
        
        ---
</details>

## Features

- **Multi-vCenter Support** — Connect and monitor up to N vCenter Server instances simultaneously
- **Live Data Collection** — Parallel background refresh using pyVmomi PropertyCollector (fast, low-overhead)
- **ESXi Hosts** — Status, CPU/memory usage, maintenance mode detection
- **Virtual Machines** — Power state, VMware Tools status, decommission/template detection
- **Datastores** — Capacity, usage percentage, accessibility status
- **Networks / Port Groups** — Type, VLAN info, accessibility
- **VM Snapshots** — Age, depth, power state, current snapshot tracking
- **CMDB Integration** — Historical VM inventory with decommission tracking and UUID display
- **PuppetDB Integration** — Enrich VM records with Puppet facts and classification
- **Global Search** — Ctrl+K / ⌘K search across all resource types
- **Dark / Light Theme** — Persisted in browser localStorage; all badges use opacity-based colors for full compatibility
- **Alerts Dashboard** — Automatic alerts for disconnected hosts, old snapshots, high storage usage
- **vCenter Health** — Per-vCenter uptime and connectivity monitoring
- **API Base URL Override** — Change the backend URL from the Settings page without redeployment
- **CI/CD Auto-Deploy** — GitHub Actions self-hosted runner pipeline (build → deploy → health-check)

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 18, TypeScript, Vite 4, Tailwind CSS, shadcn/ui |
| Backend | Python 3.9+, FastAPI, Uvicorn |
| VMware SDK | pyVmomi |
| Routing | React Router v6 |
| Icons | Lucide React |

---

## Prerequisites

- **Python 3.9+** with `pip`
- **Node.js 18+** with `npm`
- Network access to your vCenter Server(s) on port 443
- *(Optional)* PuppetDB v4 API access for Puppet enrichment

---

## Quick Start

### 1. Clone the repository

```bash
git clone https://github.com/your-github-org/vmware-dashboard.git
cd vmware-dashboard
```

### 2. Configure environment

```bash
cp .env.example .env
# Edit .env and set your values:
#   API_URL — backend host for Vite proxy
#   PUPPETDB_URL — PuppetDB endpoint (optional)
#   VM_ALLOWED_ORIGINS — CORS origins
```

### 3. Install backend dependencies

```bash
python3 -m venv venv
source venv/bin/activate        # Windows: venv\Scripts\activate
pip install -r requirements.txt
```

### 4. Start the backend

```bash
source venv/bin/activate
uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```

### 5. Install frontend dependencies

```bash
npm install
```

### 6. Start the frontend (development)

```bash
# Load the API_URL from .env so Vite proxy knows where the backend is
export $(grep -v '^#' .env | xargs)
npm run dev
```

Open [http://localhost:5173](http://localhost:5173)

---

## Production Deployment

```bash
# Build frontend
npm run build        # outputs to dist/

# Serve with Vite preview (or any static server + reverse proxy)
npm run preview      # http://0.0.0.0:5173
```

For systemd service deployment see the **Operations Guide** in `docs/`.

To set up the auto-deploy CI/CD pipeline on a **new or different server**, see [`docs/DEPLOY_NEW_SERVER.md`](docs/DEPLOY_NEW_SERVER.md).

---

## Project Structure

```
vmware-dashboard/
├── main.py                  # FastAPI backend — all API routes
├── vcenter_fast.py          # Parallel vCenter collector (pyVmomi)
├── vcenter_health.py        # Per-vCenter health checker
├── cmdb_history.py          # Historical CMDB / decommission tracking
├── puppet_client.py         # PuppetDB REST API client
├── global_search.py         # Cross-resource search engine
├── requirements.txt         # Python dependencies
├── .env                     # Secrets (not committed) — PUPPETDB_URL, etc.
├── .env.example             # Environment variable template
├── .github/
│   └── workflows/
│       ├── deploy.yml       # Auto-deploy on push to main (self-hosted runner)
│       └── ci.yml           # PR validation (tsc + build)
├── src/
│   ├── App.tsx              # Root component + router
│   ├── pages/               # One file per page/route
│   │   ├── index.tsx        # Dashboard home + alerts
│   │   ├── hosts.tsx        # ESXi hosts
│   │   ├── vms.tsx          # Virtual machines
│   │   ├── datastores.tsx   # Datastores
│   │   ├── networks.tsx     # Networks / port groups
│   │   ├── snapshots.tsx    # VM snapshots
│   │   ├── cmdb.tsx         # CMDB inventory (Puppet facts, dark mode)
│   │   ├── settings.tsx     # vCenter connections + app config
│   │   ├── vcenter-health.tsx
│   │   ├── vm-detail.tsx    # VM detail with Puppet / History tabs
│   │   └── _layout.tsx      # App shell with sidebar + search
│   ├── lib/
│   │   ├── api.ts           # API client
│   │   ├── theme.tsx        # Dark/light theme context
│   │   └── utils.ts
│   ├── config/
│   │   └── api.ts           # API base URL (supports runtime override)
│   └── components/ui/       # shadcn/ui component library
├── docs/
│   ├── VM_Dashboard_Confluence.html   # Internal Confluence documentation
│   └── DEPLOY_NEW_SERVER.md            # CI/CD setup guide for a new server
├── vite.config.ts
├── tailwind.config.js
└── package.json
```

---

## Configuration Reference

All configuration is via environment variables. See `.env.example` for the full list.

| Variable | Default | Description |
|---|---|---|
| `API_URL` | `http://localhost:8000` | Backend origin for Vite proxy |
| `PUPPETDB_URL` | *(none)* | PuppetDB v4 endpoint |
| `VM_ALLOWED_ORIGINS` | `http://localhost:5173` | CORS allowed origins |
| `VM_LOG_LEVEL` | `INFO` | Python log level |
| `VM_CACHE_TTL` | `1800` | Cache TTL in seconds |

---

## Adding a vCenter

1. Go to **Settings** in the sidebar
2. Click **Add vCenter**
3. Enter hostname, username, and password
4. Credentials are stored locally at `~/.vmware-dashboard-cache/vcenter_credentials.json` — this file is **never committed**

---

## Security Notes

- vCenter credentials are stored only on the server filesystem (`~/.vmware-dashboard-cache/`), never in the database or source code
- The `~/.vmware-dashboard-cache/` directory is outside the repository and never committed
- CORS is restricted to origins listed in `VM_ALLOWED_ORIGINS`
- SSL verification for PuppetDB is disabled by default (internal CA); enable by removing `verify=False` in `puppet_client.py` if your CA is trusted
- Passwords are never returned by any API endpoint (`hasCredentials` boolean only)

---

## Development

```bash
# Run backend with auto-reload
uvicorn main:app --reload --port 8000

# Run frontend dev server
npm run dev

# Type-check frontend
npx tsc --noEmit

# Lint
npx eslint src/
```

---

## Author

**Prasannakumar Kanderi** — [mail2kanderi@gmail.com](mailto:mail2kanderi@gmail.com)

---

## License

Copyright (c) 2026 Prasannakumar Kanderi

This project is licensed under a **Non-Commercial License** — see the [LICENSE](LICENSE) file for the full text.

**Permitted:** Personal use, educational use, research, and internal business use.  
**Prohibited:** Commercial use, resale, or inclusion in any product or service offered for monetary gain without prior written permission.

For commercial licensing inquiries contact [mail2kanderi@gmail.com](mailto:mail2kanderi@gmail.com).
