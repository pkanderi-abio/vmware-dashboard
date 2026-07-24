# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Common commands

Backend (FastAPI, Python 3.9+):
```bash
python3 -m venv venv && source venv/bin/activate   # first time only
pip install -r requirements.txt
uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```

Frontend (Vite + React + TS):
```bash
npm install
export $(grep -v '^#' .env | xargs)   # so Vite proxy picks up API_URL
npm run dev            # http://localhost:5173
npm run build          # runs `tsc && vite build` (type-check gates the build)
npm run preview        # serve dist/ with the same /api proxy
npx tsc --noEmit       # frontend type-check only
npx eslint src/        # lint (eslint is not a devDependency; install ad-hoc)
```

There is **no test suite** in this repo — the CI signal is `tsc --noEmit` + `vite build` for the frontend and `python -m compileall` for the backend (see [.github/workflows/ci.yml](.github/workflows/ci.yml)). Do not claim "tests pass" as a check; run the type-check + build instead.

Note: `requirements.txt` pins runtime deps only. `pyVmomi` is imported by [main.py](main.py) / [vcenter_fast.py](vcenter_fast.py) but is **not** in `requirements.txt` — the backend gracefully degrades (`PYVMOMI_AVAILABLE = False`) when it is missing, and the deploy server has it pre-installed. Add `pyvmomi` to your venv locally if you need to exercise the vCenter code paths.

## Architecture

Two-process app: a Python FastAPI backend that talks to vCenter over pyVmomi, and a React SPA that consumes it through a JSON `/api/*` surface.

### Backend (`main.py` + support modules)

- All HTTP routes live in [main.py](main.py) — every endpoint is prefixed `/api/...`. When adding a route, add it here and add a matching method on `ApiClient` in [src/lib/api.ts](src/lib/api.ts).
- **Persistent, on-disk cache** at `~/.vmware-dashboard-cache/` (created on startup):
  - `cache.json` — the resource cache (`vcenters`, `vms`, `hosts`, `datastores`, `networks`, `snapshots`, `tags`) with a 30-min TTL (`CACHE_TTL_SECONDS = 1800`). Managed by the `PersistentCache` class in [main.py](main.py).
  - `vcenter_credentials.json` — vCenter creds keyed by hostname. **Never returned by the API** (only `hasCredentials`/`hasPassword` booleans are). Never log, never commit, never include in fixtures.
  - `cmdb_history.json` — historical VM inventory, written by [cmdb_history.py](cmdb_history.py) after every refresh.
  - `trending.json` — one rolling snapshot of cluster metrics per refresh, capped at `TRENDING_MAX_POINTS = 720` (~30d hourly). Powers the Trending page.
- **Refresh model:** `background_refresh()` is a threaded, single-flight function (guarded by `refresh_lock` + `refresh_in_progress`). It calls `collect_vcenter_data_parallel` in [vcenter_fast.py](vcenter_fast.py) (pyVmomi PropertyCollector over a ThreadPoolExecutor), assigns row IDs, writes each resource type to the cache, then fires CMDB sync, tag collection, and trending snapshot in `suppress(Exception)` blocks so a partial vCenter failure never poisons the whole refresh. Kicked off on startup and on `POST /api/cache/refresh`.
- **Long-lived vCenter sessions** live in `pyvmomi_sessions: Dict[hostname, VCenterPyVmomi]` and are used for snapshot enumeration (parallel refresh spins up its own connections). `VCenterPyVmomi` supports auto-reconnect. On shutdown all sessions are disconnected.
- Health checking is separated into [vcenter_health.py](vcenter_health.py) and driven by a periodic asyncio task (`_auto_health_loop`, 5 min).
- Everything that talks to vSphere/PuppetDB uses `ssl._create_unverified_context()` / `verify=False` — internal-CA environments. Don't add a "fix" for this unless you're wiring in a CA bundle.

### Frontend (`src/`)

- Vite + React 18 + TS, path alias `@/* → src/*` (see [tsconfig.json](tsconfig.json)).
- Router set up in [src/App.tsx](src/App.tsx). One file per route under [src/pages/](src/pages/) — the file name is the URL (`vms.tsx → /vms`, `_layout.tsx` is the shell).
- All backend calls go through the single `api` singleton in [src/lib/api.ts](src/lib/api.ts). Do **not** hand-roll `fetch('/api/...')` in components.
- **API base URL is runtime-switchable.** [src/config/api.ts](src/config/api.ts) reads `localStorage['vm-api-origin']`; when empty, requests go to relative `/api/...` and Vite's dev-server proxy forwards them to `API_URL` (default `http://localhost:8000`) — see [vite.config.ts](vite.config.ts). The Settings page lets a user point the SPA at a different backend without a rebuild.
- Theme, thresholds, and API origin are all persisted in `localStorage` under distinct keys (`cie-theme`, `vm-dashboard-thresholds`, `vm-api-origin`). No cookie/session state.
- Alert threshold defaults live in [src/lib/thresholds.ts](src/lib/thresholds.ts); the Settings page overrides them client-side.
- UI kit is shadcn/ui — components are copied into [src/components/ui/](src/components/ui/) rather than pulled from a package. Prefer editing what's there over adding new primitives.

### Deployment

- Production runs on a self-hosted GitHub Actions runner. Push to `main` → [.github/workflows/deploy.yml](.github/workflows/deploy.yml) runs `git pull`, installs deps, `npm run build`, restarts `vm-api` and `vm-frontend` systemd units, then polls `/api/health` for up to 60s. Full server bootstrap: [docs/DEPLOY_NEW_SERVER.md](docs/DEPLOY_NEW_SERVER.md).
- **Any push to `main` deploys to prod.** Treat `main` as the release branch.

## Repo conventions worth knowing

- Backend endpoints must return `{ success: bool, data?, message?, count? }` — the `ApiClient.request` wrapper checks for `success` and passes through, otherwise wraps the raw payload. Keeping this shape avoids double-wrapping surprises.
- `_add_ids(items)` in [main.py](main.py) assigns a sequential `ID` field to every list before caching — the frontend tables rely on it as a stable key. New collections that get cached need the same treatment.
- Legacy route pairs exist for CMDB (`/cmdb/vm-history/{key}` preferred, `/cmdb/vm/{key}` fallback) and for vCenter connections (`/vcenters/connections` preferred, `/vcenters` fallback) — the client tries the preferred one first. When adding new consumers, use the preferred path; don't remove the fallback without checking older deployed backends.
- `.env` is git-ignored; only `.env.example` is committed. Environment variables consumed by the backend are prefixed `VM_*` (see [.env.example](.env.example)); `API_URL` is Vite-only.
