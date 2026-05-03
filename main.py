#!/usr/bin/env python3
"""
VMware Dashboard Backend v2.6
Copyright (c) 2026 Prasannakumar Kanderi <mail2kanderi@gmail.com>
Non-Commercial License — see LICENSE for details.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import ssl
import threading
import time
from contextlib import suppress
from datetime import datetime
from typing import Any, Dict, List, Optional

import urllib3
from fastapi import BackgroundTasks, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from starlette.middleware import Middleware

from cmdb_history import historical_cmdb
from vcenter_fast import collect_vcenter_data_parallel
from vcenter_health import vcenter_health as vc_health_checker
from puppet_client import puppet_client
from global_search import GlobalSearch
from vcenter_tags import collect_vsphere_tags

urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

# ============================================
# LOGGING
# ============================================
logging.basicConfig(
    level=os.getenv("VM_LOG_LEVEL", "INFO"),
    format="%(asctime)s %(levelname)s %(name)s - %(message)s",
)
logger = logging.getLogger("vmware-dashboard")

# ============================================
# pyVmomi import
# ============================================
try:
    from pyVim.connect import Disconnect, SmartConnect
    from pyVmomi import vim  # noqa: F401

    PYVMOMI_AVAILABLE = True
    logger.info("pyVmomi available")
except ImportError:
    PYVMOMI_AVAILABLE = False
    logger.warning("pyVmomi not installed")

# ============================================
# CONFIGURATION
# ============================================
CACHE_TTL_SECONDS = 1800
CACHE_DIR = os.path.expanduser("~/.vmware-dashboard-cache")
CREDENTIALS_FILE = os.path.join(CACHE_DIR, "vcenter_credentials.json")
CACHE_FILE = os.path.join(CACHE_DIR, "cache.json")
os.makedirs(CACHE_DIR, exist_ok=True)

ALLOWED_ORIGINS = [
    origin.strip()
    for origin in os.getenv(
        "VM_ALLOWED_ORIGINS",
        "http://localhost:5173,http://127.0.0.1:5173",
    ).split(",")
    if origin.strip()
]

# ============================================
# CACHE CLASS
# ============================================
class PersistentCache:
    def __init__(self, cache_dir: str):
        self.cache_dir = cache_dir
        self.cache_file = CACHE_FILE
        self._lock = threading.RLock()
        self._cache: Dict[str, Dict[str, Any]] = self._load_from_disk()

    def _load_from_disk(self) -> Dict[str, Dict[str, Any]]:
        if not os.path.exists(self.cache_file):
            return {}
        try:
            with open(self.cache_file, "r") as f:
                data = json.load(f) or {}
            if isinstance(data, dict):
                return data
        except Exception:
            logger.exception("Failed loading cache from disk")
        return {}

    def _save_to_disk(self) -> None:
        tmp = f"{self.cache_file}.tmp"
        with open(tmp, "w") as f:
            json.dump(self._cache, f, indent=2)
        os.replace(tmp, self.cache_file)

    def get(self, key: str, ignore_ttl: bool = False) -> Any:
        with self._lock:
            item = self._cache.get(key)
            if not item:
                return None
            if ignore_ttl:
                return item.get("value")
            ts = float(item.get("timestamp", 0))
            if time.time() - ts > CACHE_TTL_SECONDS:
                return None
            return item.get("value")

    def set(self, key: str, value: Any) -> None:
        with self._lock:
            self._cache[key] = {"timestamp": time.time(), "value": value}
            self._save_to_disk()

    def clear(self) -> None:
        with self._lock:
            self._cache.clear()
            self._save_to_disk()

    def get_status(self) -> Dict[str, Any]:
        with self._lock:
            status: Dict[str, Any] = {}
            now = time.time()
            for k, item in self._cache.items():
                ts = float(item.get("timestamp", 0))
                status[k] = {
                    "age_seconds": int(now - ts),
                    "expired": (now - ts) > CACHE_TTL_SECONDS,
                    "size": len(json.dumps(item.get("value", []), default=str)),
                }
            return status


data_cache = PersistentCache(CACHE_DIR)

# ============================================
# CREDENTIALS
# ============================================
credentials_lock = threading.RLock()


def _credential_id(hostname: str) -> str:
    return f"vc-{abs(hash(hostname)) & 0xffffffff}"


def _normalize_credential_record(
    hostname: str, record: Optional[Dict[str, Any]] = None
) -> Dict[str, Any]:
    record = record or {}
    return {
        "id": record.get("id") or _credential_id(hostname),
        "hostname": hostname,
        "username": str(record.get("username", "")).strip(),
        "password": record.get("password", ""),
        "port": int(record.get("port", 443) or 443),
        "enabled": bool(record.get("enabled", True)),
        "lastConnected": record.get("lastConnected", ""),
    }


def _write_credentials(creds: Dict[str, Dict[str, Any]]) -> None:
    normalized = {
        hostname: _normalize_credential_record(hostname, record)
        for hostname, record in creds.items()
    }
    tmp_file = f"{CREDENTIALS_FILE}.tmp"
    with credentials_lock:
        with open(tmp_file, "w") as f:
            json.dump(normalized, f, indent=2)
        os.replace(tmp_file, CREDENTIALS_FILE)


def load_credentials() -> Dict[str, Dict[str, Any]]:
    with credentials_lock:
        if not os.path.exists(CREDENTIALS_FILE):
            return {}
        try:
            with open(CREDENTIALS_FILE, "r") as f:
                raw = json.load(f) or {}
            return {
                hostname: _normalize_credential_record(hostname, record)
                for hostname, record in raw.items()
            }
        except Exception:
            logger.exception("Failed to load credentials")
            return {}


def save_credentials(
    hostname: str,
    username: str,
    password: str,
    *,
    port: int = 443,
    enabled: bool = True,
    last_connected: str = "",
) -> None:
    creds = load_credentials()
    prev = creds.get(hostname, {})
    creds[hostname] = _normalize_credential_record(
        hostname,
        {
            "id": prev.get("id"),
            "username": username,
            "password": password,
            "port": port,
            "enabled": enabled,
            "lastConnected": last_connected or prev.get("lastConnected", ""),
        },
    )
    _write_credentials(creds)


def mark_last_connected(hostname: str) -> None:
    creds = load_credentials()
    if hostname in creds:
        creds[hostname]["lastConnected"] = datetime.now().isoformat()
        _write_credentials(creds)


def remove_credentials(hostname: str) -> None:
    creds = load_credentials()
    if hostname in creds:
        del creds[hostname]
        _write_credentials(creds)


# ============================================
# HELPERS
# ============================================
def _norm_host(h: str) -> str:
    return str(h or "").strip().lower()


def get_known_vcenters() -> List[str]:
    creds = load_credentials()
    known = set(creds.keys())
    known.update(pyvmomi_sessions.keys())
    return sorted({k.strip() for k in known if k and k.strip()})


# ============================================
# APP SETUP
# ============================================
middleware = [
    Middleware(
        CORSMiddleware,
        allow_origins=ALLOWED_ORIGINS if ALLOWED_ORIGINS else ["http://localhost:5173", "http://127.0.0.1:5173"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
]
app = FastAPI(title="VMware Dashboard API", version="2.6", middleware=middleware)


class VCenterConfig(BaseModel):
    hostname: str
    username: str
    password: str


class VCenterConnectionsRequest(BaseModel):
    connections: List[Dict[str, Any]]


# ============================================
# PYVMOMI CLIENT WITH AUTO-RECONNECT
# ============================================
class VCenterPyVmomi:
    def __init__(self, hostname: str, username: str, password: str):
        self.hostname = hostname
        self.username = username
        self.password = password
        self.si = None
        self.content = None
        self.last_connect = 0.0

    def connect(self) -> bool:
        if not PYVMOMI_AVAILABLE:
            return False
        try:
            if self.si:
                self.disconnect()
            ctx = ssl._create_unverified_context()
            self.si = SmartConnect(
                host=self.hostname,
                user=self.username,
                pwd=self.password,
                sslContext=ctx,
            )
            self.content = self.si.RetrieveContent()
            self.last_connect = time.time()
            return True
        except Exception:
            logger.exception("Failed to connect to %s", self.hostname)
            self.si = None
            self.content = None
            return False

    def reconnect(self) -> bool:
        self.disconnect()
        return self.connect()

    def disconnect(self) -> None:
        if self.si:
            with suppress(Exception):
                Disconnect(self.si)
        self.si = None
        self.content = None

    def ensure_connected(self) -> bool:
        try:
            if self.si and self.content:
                _ = self.content.rootFolder.name
                return True
        except Exception:
            pass
        return self.reconnect()

    def get_custom_attributes_map(self) -> Dict[int, str]:
        if not self.ensure_connected() or not self.content:
            return {}
        result: Dict[int, str] = {}
        with suppress(Exception):
            for field in getattr(self.content.customFieldsManager, "field", []) or []:
                result[int(field.key)] = str(field.name)
        return result

    def get_all_snapshots(self) -> List[Dict[str, Any]]:
        snapshots: List[Dict[str, Any]] = []
        if not self.ensure_connected() or not self.content:
            return snapshots
        try:
            from datetime import timezone as _tz
            view = self.content.viewManager.CreateContainerView(
                self.content.rootFolder, [vim.VirtualMachine], True
            )
            now_utc = datetime.now(_tz.utc)

            for vm_obj in view.view:
                snap = getattr(vm_obj, "snapshot", None)
                if not snap or not getattr(snap, "rootSnapshotList", None):
                    continue

                # Current snapshot moref id
                current_ref = getattr(snap, "currentSnapshot", None)
                current_moId = getattr(current_ref, "_moId", None) if current_ref else None

                # VM power state and id
                runtime = getattr(vm_obj, "runtime", None)
                power_state = str(getattr(runtime, "powerState", "unknown"))
                vm_id = getattr(vm_obj, "_moId", "") or ""

                def walk(nodes: list, parent_name: str = "", depth: int = 1) -> None:
                    for node in nodes:
                        create_time = getattr(node, "createTime", None)
                        # Compute age safely, handling tz-aware and tz-naive datetimes
                        age_days = 0
                        create_time_str = ""
                        create_time_display = ""
                        if create_time:
                            try:
                                create_time_str = create_time.isoformat()
                                create_time_display = create_time.strftime("%Y-%m-%d %H:%M")
                                ct_utc = create_time if create_time.tzinfo else create_time.replace(tzinfo=_tz.utc)
                                age_days = max(0, (now_utc - ct_utc).days)
                            except Exception:
                                pass

                        snap_ref = getattr(node, "snapshot", None)
                        snap_moId = getattr(snap_ref, "_moId", None) if snap_ref else None
                        is_current = bool(snap_moId and current_moId and snap_moId == current_moId)

                        snapshots.append({
                            "snapshotId": snap_moId or f"{vm_obj.name}-{getattr(node, 'name', '')}",
                            "snapshotName": getattr(node, "name", ""),
                            "description": getattr(node, "description", ""),
                            "vmName": vm_obj.name,
                            "vmId": vm_id,
                            "vcenterName": self.hostname,
                            "vmPowerState": power_state,
                            "createTime": create_time_display,
                            "createTimeRaw": create_time_str,
                            "ageDays": age_days,
                            "isCurrent": is_current,
                            "quiesced": bool(getattr(node, "quiesced", False)),
                            "replaySupported": bool(getattr(node, "replaySupported", False)),
                            "parentSnapshot": parent_name,
                            "snapshotDepth": depth,
                        })
                        walk(getattr(node, "childSnapshotList", []) or [], getattr(node, "name", ""), depth + 1)

                walk(snap.rootSnapshotList)
            with suppress(Exception):
                view.Destroy()
        except Exception:
            logger.exception("Snapshot collection failed for %s", self.hostname)
        return snapshots


# ============================================
# SESSIONS
# ============================================
pyvmomi_sessions: Dict[str, VCenterPyVmomi] = {}
refresh_in_progress = False
refresh_lock = threading.Lock()
auto_health_task: Optional[asyncio.Task] = None

# ============================================
# BACKGROUND REFRESH
# ============================================
def _add_ids(items: List[Dict[str, Any]]) -> None:
    for i, item in enumerate(items, start=1):
        item["ID"] = i


def background_refresh() -> None:
    global refresh_in_progress

    with refresh_lock:
        if refresh_in_progress:
            return
        refresh_in_progress = True

    try:
        creds = load_credentials()
        enabled_creds = [
            {
                "hostname": c["hostname"],
                "username": c["username"],
                "password": c["password"],
            }
            for c in creds.values()
            if c.get("enabled", True) and c.get("username") and c.get("password")
        ]

        if not enabled_creds:
            logger.info("No enabled credentials for refresh")
            return

        data = collect_vcenter_data_parallel(
            enabled_creds, max_workers=min(4, len(enabled_creds))
        )

        vcenters = data.get("vcenters", []) or []
        vms = data.get("vms", []) or []
        hosts = data.get("hosts", []) or []
        datastores = data.get("datastores", []) or []
        networks = data.get("networks", []) or []

        _add_ids(vcenters)
        _add_ids(vms)
        _add_ids(hosts)
        _add_ids(datastores)
        _add_ids(networks)

        data_cache.set("vcenters", vcenters)
        data_cache.set("vms", vms)
        data_cache.set("hosts", hosts)
        data_cache.set("datastores", datastores)
        data_cache.set("networks", networks)

        all_snapshots: List[Dict[str, Any]] = []
        for hostname, client in list(pyvmomi_sessions.items()):
            with suppress(Exception):
                all_snapshots.extend(client.get_all_snapshots())
            if hostname not in pyvmomi_sessions:
                continue
        _add_ids(all_snapshots)
        data_cache.set("snapshots", all_snapshots)

        # CMDB sync from refreshed VMs
        with suppress(Exception):
            connected = list(pyvmomi_sessions.keys())
            historical_cmdb.update_from_refresh(vms, connected)

        # Collect vSphere tags via CIS REST API (best-effort, non-blocking)
        all_tags: List[Dict[str, Any]] = []
        all_vm_tags: Dict[str, List[str]] = {}
        for cred in enabled_creds:
            with suppress(Exception):
                tag_data = collect_vsphere_tags(
                    cred["hostname"], cred["username"], cred["password"]
                )
                all_tags.extend(tag_data.get("tags", []))
                for moref, tag_names in tag_data.get("vm_tags", {}).items():
                    all_vm_tags.setdefault(moref, []).extend(tag_names)
        data_cache.set("tags", {"tags": all_tags, "vm_tags": all_vm_tags})

    except Exception:
        logger.exception("Fatal refresh error")
    finally:
        with refresh_lock:
            refresh_in_progress = False


# ============================================
# STARTUP / SHUTDOWN
# ============================================
@app.on_event("startup")
async def startup() -> None:
    global auto_health_task
    logger.info("Starting VMware Dashboard API v2.6")

    creds = load_credentials()
    for hostname, cred in creds.items():
        if not cred.get("enabled", True):
            continue
        if not cred.get("username") or not cred.get("password"):
            continue
        client = VCenterPyVmomi(cred["hostname"], cred["username"], cred["password"])
        if client.connect():
            pyvmomi_sessions[hostname] = client
            mark_last_connected(hostname)

    if pyvmomi_sessions:
        threading.Thread(target=background_refresh, daemon=True).start()
        # Seed health checker with known vcenters
        with suppress(Exception):
            connected = list(pyvmomi_sessions.keys())
            all_known = list(connected)
            creds_file = os.path.join(CACHE_DIR, "vcenter_credentials.json")
            if os.path.exists(creds_file):
                with open(creds_file) as _f:
                    _all_creds = json.load(_f)
                all_known += [h for h in _all_creds.keys() if h not in all_known]
            vc_health_checker.sync_with_connections(connected, all_known)

    if auto_health_task is None or auto_health_task.done():
        auto_health_task = asyncio.create_task(_auto_health_loop())


@app.on_event("shutdown")
async def shutdown() -> None:
    global auto_health_task
    if auto_health_task:
        auto_health_task.cancel()
        with suppress(asyncio.CancelledError):
            await auto_health_task
    for _, client in list(pyvmomi_sessions.items()):
        with suppress(Exception):
            client.disconnect()
    pyvmomi_sessions.clear()


# ============================================
# HEALTH LOOP
# ============================================
_last_health_check: Optional[datetime] = None
HEALTH_CHECK_INTERVAL = 300

async def _auto_health_loop() -> None:
    global _last_health_check
    while True:
        await asyncio.sleep(HEALTH_CHECK_INTERVAL)
        _last_health_check = datetime.now()


# ============================================
# ENDPOINTS
# ============================================
@app.get("/api/health")
async def health() -> Dict[str, Any]:
    cache_status = data_cache.get_status()
    oldest_age = 0
    if cache_status:
        oldest_age = max(v.get("age_seconds", 0) for v in cache_status.values())
    return {
        "status": "ok",
        "vcenters_connected": len(pyvmomi_sessions),
        "vcenters_list": sorted(pyvmomi_sessions.keys()),
        "cache_age_seconds": oldest_age,
        "cache": cache_status,
        "pyvmomi_available": PYVMOMI_AVAILABLE,
        "refresh_in_progress": refresh_in_progress,
    }


@app.get("/api/cache/status")
async def cache_status() -> Dict[str, Any]:
    return {"success": True, "data": data_cache.get_status()}


@app.post("/api/cache/refresh")
async def trigger_refresh(bg: BackgroundTasks) -> Dict[str, Any]:
    bg.add_task(background_refresh)
    return {"success": True, "message": "Refresh started"}


@app.post("/api/cache/clear")
async def clear_cache() -> Dict[str, Any]:
    data_cache.clear()
    return {"success": True, "message": "Cache cleared"}


@app.get("/api/vcenters")
async def get_vcenters() -> Dict[str, Any]:
    data = data_cache.get("vcenters", ignore_ttl=True) or []
    if not data:
        # fallback from sessions
        data = [
            {
                "name": h,
                "hostname": h,
                "status": {"Value": "Connected"},
                "vmCount": "0",
                "hostCount": "0",
            }
            for h in pyvmomi_sessions.keys()
        ]
    return {"success": True, "data": data, "count": len(data)}


@app.get("/api/vcenters/connections")
async def get_vcenter_connections() -> Dict[str, Any]:
    creds = load_credentials()
    out: List[Dict[str, Any]] = []
    seen: set = set()

    # Build per-vcenter VM and host counts from the actual cache
    cached_vms = data_cache.get("vms", ignore_ttl=True) or []
    cached_hosts = data_cache.get("hosts", ignore_ttl=True) or []

    vm_counts: Dict[str, int] = {}
    for vm in cached_vms:
        vc = _norm_host(vm.get("vcenterName") or vm.get("vcenter") or "")
        if vc:
            vm_counts[vc] = vm_counts.get(vc, 0) + 1

    host_counts: Dict[str, int] = {}
    for h in cached_hosts:
        vc = _norm_host(h.get("vcenterName") or h.get("vcenter") or "")
        if vc:
            host_counts[vc] = host_counts.get(vc, 0) + 1

    # 1. From credentials (authoritative)
    for hostname, c in creds.items():
        connected = hostname in pyvmomi_sessions
        key = _norm_host(hostname)
        seen.add(key)
        out.append(
            {
                "id": c.get("id") or _credential_id(hostname),
                "hostname": hostname,
                "name": hostname,
                "username": c.get("username", ""),
                "port": c.get("port", 443),
                "enabled": c.get("enabled", True),
                "status": "connected" if connected else "disconnected",
                "hasPassword": bool(c.get("password")),
                "lastConnected": c.get("lastConnected", ""),
                "error": "",
                "vmCount": str(vm_counts.get(key, 0)),
                "hostCount": str(host_counts.get(key, 0)),
            }
        )

    # 2. From cache — show vCenters with no saved credentials so user can Reconnect
    cached_vcenters = data_cache.get("vcenters", ignore_ttl=True) or []
    for vc in cached_vcenters:
        hostname = str(vc.get("hostname") or vc.get("name") or "").strip()
        if not hostname or _norm_host(hostname) in seen:
            continue
        key = _norm_host(hostname)
        seen.add(key)
        out.append(
            {
                "id": _credential_id(hostname),
                "hostname": hostname,
                "name": hostname,
                "username": "",
                "port": 443,
                "enabled": False,
                "status": "disconnected",
                "hasPassword": False,
                "lastConnected": "",
                "error": "Credentials not saved — click Reconnect to re-enter",
                "vmCount": str(vm_counts.get(key, int(vc.get("vmCount", 0)))),
                "hostCount": str(host_counts.get(key, int(vc.get("hostCount", 0)))),
            }
        )

    # 3. From active sessions with no saved credentials
    for hostname in pyvmomi_sessions:
        key = _norm_host(hostname)
        if key in seen:
            continue
        seen.add(key)
        out.append(
            {
                "id": _credential_id(hostname),
                "hostname": hostname,
                "name": hostname,
                "username": "",
                "port": 443,
                "enabled": True,
                "status": "connected",
                "hasPassword": False,
                "lastConnected": "",
                "error": "",
                "vmCount": str(vm_counts.get(key, 0)),
                "hostCount": str(host_counts.get(key, 0)),
            }
        )

    return {"success": True, "data": out, "count": len(out)}


@app.post("/api/vcenter/connect")
async def connect_vcenter(config: VCenterConfig, bg: BackgroundTasks) -> Dict[str, Any]:
    client = VCenterPyVmomi(config.hostname, config.username, config.password)
    if not client.connect():
        raise HTTPException(status_code=401, detail="Failed to connect")

    pyvmomi_sessions[config.hostname] = client
    save_credentials(
        config.hostname,
        config.username,
        config.password,
        enabled=True,
        last_connected=datetime.now().isoformat(),
    )
    bg.add_task(background_refresh)
    return {"success": True, "data": {"hostname": config.hostname}}


@app.post("/api/vcenter/disconnect/{hostname}")
async def disconnect_vcenter(hostname: str) -> Dict[str, Any]:
    client = pyvmomi_sessions.pop(hostname, None)
    if client:
        client.disconnect()
    remove_credentials(hostname)
    return {"success": True}


@app.post("/api/vcenters/test")
async def test_vcenter(config: VCenterConfig) -> Dict[str, Any]:
    client = VCenterPyVmomi(config.hostname, config.username, config.password)
    ok = client.connect()
    with suppress(Exception):
        client.disconnect()
    return {"success": ok, "message": "Connection successful" if ok else "Connection failed"}


@app.post("/api/vcenters/connections")
async def save_vcenter_connections(
    request: VCenterConnectionsRequest, bg: BackgroundTasks
) -> Dict[str, Any]:
    current = load_credentials()
    next_creds: Dict[str, Dict[str, Any]] = {}

    for conn in request.connections:
        hostname = str(conn.get("hostname", "")).strip()
        if not hostname:
            continue
        existing = current.get(hostname, {})
        password = str(conn.get("password", "")).strip() or existing.get("password", "")
        next_creds[hostname] = _normalize_credential_record(
            hostname,
            {
                "id": conn.get("id") or existing.get("id") or _credential_id(hostname),
                "username": str(conn.get("username", "")).strip(),
                "password": password,
                "port": conn.get("port", existing.get("port", 443)),
                "enabled": bool(conn.get("enabled", True)),
                "lastConnected": existing.get("lastConnected", ""),
            },
        )

    # disconnect removed/disabled
    for hostname in list(pyvmomi_sessions.keys()):
        tgt = next_creds.get(hostname)
        if tgt is None or not tgt.get("enabled", True):
            with suppress(Exception):
                pyvmomi_sessions[hostname].disconnect()
            del pyvmomi_sessions[hostname]

    # connect/reconnect enabled
    for hostname, cred in next_creds.items():
        if not cred.get("enabled", True):
            continue
        sess = pyvmomi_sessions.get(hostname)
        needs_reconnect = (
            sess is None
            or sess.username != cred["username"]
            or sess.password != cred["password"]
        )
        if needs_reconnect:
            if sess:
                with suppress(Exception):
                    sess.disconnect()
            client = VCenterPyVmomi(cred["hostname"], cred["username"], cred["password"])
            if client.connect():
                pyvmomi_sessions[hostname] = client
                cred["lastConnected"] = datetime.now().isoformat()

    _write_credentials(next_creds)

    if pyvmomi_sessions:
        bg.add_task(background_refresh)

    return {"success": True, "message": f"Saved {len(next_creds)} connection(s)"}


@app.delete("/api/vcenters/connections/{hostname}")
async def delete_vcenter_connection(hostname: str) -> Dict[str, Any]:
    client = pyvmomi_sessions.pop(hostname, None)
    if client:
        with suppress(Exception):
            client.disconnect()
    remove_credentials(hostname)
    return {"success": True, "message": f"Deleted connection to {hostname}"}


@app.put("/api/vcenters/connections/{hostname}/toggle")
async def toggle_vcenter_connection(hostname: str, bg: BackgroundTasks) -> Dict[str, Any]:
    creds = load_credentials()
    if hostname not in creds:
        return {"success": False, "message": f"Connection not found: {hostname}"}

    creds[hostname]["enabled"] = not creds[hostname].get("enabled", True)

    if creds[hostname]["enabled"]:
        c = creds[hostname]
        client = VCenterPyVmomi(c["hostname"], c["username"], c["password"])
        if client.connect():
            pyvmomi_sessions[hostname] = client
            creds[hostname]["lastConnected"] = datetime.now().isoformat()
            bg.add_task(background_refresh)
    else:
        client = pyvmomi_sessions.pop(hostname, None)
        if client:
            with suppress(Exception):
                client.disconnect()

    _write_credentials(creds)
    return {
        "success": True,
        "enabled": creds[hostname]["enabled"],
        "message": f"Connection {'enabled' if creds[hostname]['enabled'] else 'disabled'}",
    }


@app.post("/api/vcenters/connections/{hostname}/reconnect")
async def reconnect_vcenter(hostname: str, bg: BackgroundTasks) -> Dict[str, Any]:
    creds = load_credentials()
    if hostname not in creds:
        return {"success": False, "message": f"Connection not found: {hostname}"}

    old = pyvmomi_sessions.pop(hostname, None)
    if old:
        with suppress(Exception):
            old.disconnect()

    c = creds[hostname]
    client = VCenterPyVmomi(c["hostname"], c["username"], c["password"])
    if not client.connect():
        return {"success": False, "message": f"Failed to reconnect to {hostname}"}

    pyvmomi_sessions[hostname] = client
    creds[hostname]["lastConnected"] = datetime.now().isoformat()
    _write_credentials(creds)
    bg.add_task(background_refresh)
    return {"success": True, "message": f"Reconnected to {hostname}"}


@app.get("/api/hosts")
async def get_hosts() -> Dict[str, Any]:
    data = data_cache.get("hosts") or data_cache.get("hosts", ignore_ttl=True) or []
    return {"success": True, "data": data, "count": len(data)}


@app.get("/api/host/{host_id}")
async def get_host(host_id: str) -> Dict[str, Any]:
    hosts = data_cache.get("hosts", ignore_ttl=True) or []
    for h in hosts:
        if str(h.get("hostId")) == host_id or str(h.get("name")) == host_id:
            return {"success": True, "data": h}
    return {"success": False, "message": "Host not found"}


@app.get("/api/vms")
async def get_vms() -> Dict[str, Any]:
    data = data_cache.get("vms") or data_cache.get("vms", ignore_ttl=True) or []
    return {"success": True, "data": data, "count": len(data)}


@app.get("/api/vm/{vm_id}")
async def get_cached_vm_detail(vm_id: str) -> Dict[str, Any]:
    vms = data_cache.get("vms", ignore_ttl=True) or []
    for vm in vms:
        if str(vm.get("vmId")) == vm_id or str(vm.get("name")) == vm_id:
            return {"success": True, "data": vm}
    return {"success": False, "message": "VM not found"}


@app.get("/api/datastores")
async def get_datastores() -> Dict[str, Any]:
    data = data_cache.get("datastores") or data_cache.get("datastores", ignore_ttl=True) or []
    return {"success": True, "data": data, "count": len(data)}


@app.get("/api/datastore/{ds_id}")
async def get_datastore(ds_id: str) -> Dict[str, Any]:
    data = data_cache.get("datastores", ignore_ttl=True) or []
    for d in data:
        if str(d.get("datastoreId")) == ds_id or str(d.get("name")) == ds_id:
            return {"success": True, "data": d}
    return {"success": False, "message": "Datastore not found"}


@app.get("/api/networks")
async def get_networks() -> Dict[str, Any]:
    data = data_cache.get("networks") or data_cache.get("networks", ignore_ttl=True) or []
    return {"success": True, "data": data, "count": len(data)}


@app.get("/api/network/{net_id}")
async def get_network(net_id: str) -> Dict[str, Any]:
    data = data_cache.get("networks", ignore_ttl=True) or []
    for n in data:
        if str(n.get("networkId")) == net_id or str(n.get("name")) == net_id:
            return {"success": True, "data": n}
    return {"success": False, "message": "Network not found"}


@app.get("/api/snapshots")
async def get_snapshots() -> Dict[str, Any]:
    data = data_cache.get("snapshots") or data_cache.get("snapshots", ignore_ttl=True) or []
    return {"success": True, "data": data, "count": len(data)}


@app.get("/api/tags")
async def get_tags() -> Dict[str, Any]:
    data = data_cache.get("tags", ignore_ttl=True) or {"tags": [], "vm_tags": {}}
    tag_names = sorted({t["name"] for t in data.get("tags", []) if t.get("name")})
    return {
        "success": True,
        "data": data,
        "tag_names": tag_names,
        "count": len(data.get("tags", [])),
    }


@app.get("/api/health-check/status")
async def get_health_check_status() -> Dict[str, Any]:
    return {
        "success": True,
        "data": {
            "interval_seconds": HEALTH_CHECK_INTERVAL,
            "last_check": _last_health_check.isoformat() if _last_health_check else None,
        },
    }


# ============================================
# CMDB ENDPOINTS
# ============================================
@app.get("/api/cmdb/vms")
async def get_cmdb_vms(include_decommissioned: bool = True) -> Dict[str, Any]:
    try:
        data = historical_cmdb.get_all(include_decommissioned=include_decommissioned)
        return {"success": True, "data": data, "count": len(data)}
    except Exception as e:
        return {"success": False, "message": str(e)}


@app.get("/api/cmdb/active")
async def get_cmdb_active() -> Dict[str, Any]:
    try:
        data = historical_cmdb.get_active()
        for i, r in enumerate(data): r['ID'] = i + 1
        return {"success": True, "data": data, "count": len(data)}
    except Exception as e:
        return {"success": False, "message": str(e)}


@app.get("/api/cmdb/decommissioned")
async def get_cmdb_decommissioned() -> Dict[str, Any]:
    try:
        data = [r for r in historical_cmdb.records.values() if r.get('status') == 'decommissioned']
        for i, r in enumerate(data): r['ID'] = i + 1
        return {"success": True, "data": data, "count": len(data)}
    except Exception as e:
        return {"success": False, "message": str(e)}


@app.get("/api/cmdb/stats")
async def get_cmdb_stats() -> Dict[str, Any]:
    try:
        if hasattr(historical_cmdb, "get_stats"):
            stats = historical_cmdb.get_stats()
        else:
            stats = {}
        return {"success": True, "data": stats}
    except Exception as e:
        return {"success": False, "message": str(e)}


@app.get("/api/cmdb/search")
async def search_cmdb(q: str = "", include_decommissioned: bool = True) -> Dict[str, Any]:
    try:
        term = q.strip().lower()
        all_records = historical_cmdb.get_all(include_decommissioned=include_decommissioned)
        if not term:
            return {"success": True, "data": all_records, "count": len(all_records)}
        data = [
            r for r in all_records
            if term in (r.get('vmName') or '').lower()
            or term in (r.get('ipAddress') or '').lower()
            or term in (r.get('guestOS') or '').lower()
            or term in (r.get('vcenterName') or '').lower()
            or term in (r.get('hostName') or '').lower()
            or term in (r.get('cluster') or '').lower()
        ]
        return {"success": True, "data": data, "count": len(data)}
    except Exception as e:
        return {"success": False, "message": str(e)}


@app.get("/api/cmdb/export")
async def export_cmdb() -> Dict[str, Any]:
    try:
        data = {"records": historical_cmdb.records, "last_updated": datetime.now().isoformat()}
        return {"success": True, "data": data}
    except Exception as e:
        return {"success": False, "message": str(e)}


@app.get("/api/cmdb/vm-history/{vm_key}")
async def get_cmdb_vm_history(vm_key: str) -> Dict[str, Any]:
    try:
        vm = historical_cmdb.get_vm(vm_key)
        if vm:
            return {"success": True, "data": vm}
        return {"success": False, "message": "VM not found"}
    except Exception as e:
        return {"success": False, "message": str(e)}


@app.get("/api/cmdb/vm/{identifier}")
async def get_cmdb_vm_detail(identifier: str) -> Dict[str, Any]:
    try:
        if hasattr(historical_cmdb, "get_vm"):
            vm = historical_cmdb.get_vm(identifier)
            if vm:
                return {"success": True, "data": vm}
        return {"success": False, "message": "VM not found"}
    except Exception as e:
        return {"success": False, "message": str(e)}


@app.post("/api/cmdb/sync")
async def sync_cmdb_endpoint() -> Dict[str, Any]:
    try:
        current_vms = data_cache.get("vms", ignore_ttl=True) or []
        connected = list(pyvmomi_sessions.keys())
        stats = historical_cmdb.update_from_refresh(current_vms, connected)
        return {"success": True, "data": stats, "message": "CMDB synced successfully"}
    except Exception as e:
        return {"success": False, "message": str(e)}


# ============================================
# VCENTER HEALTH ENDPOINTS
# ============================================
@app.get("/api/vcenter-health")
async def get_vcenter_health() -> Dict[str, Any]:
    try:
        summary = vc_health_checker.get_summary()
        # If no data yet, seed from known vcenters and run a quick check
        if summary["total"] == 0:
            all_known = list(pyvmomi_sessions.keys())
            try:
                import json as _json
                creds_file = os.path.join(CACHE_DIR, "vcenter_credentials.json")
                if os.path.exists(creds_file):
                    with open(creds_file) as _f:
                        _creds = _json.load(_f)
                    all_known += [h for h in _creds.keys() if h not in all_known]
            except Exception:
                pass
            if all_known:
                connected = list(pyvmomi_sessions.keys())
                vc_health_checker.sync_with_connections(connected, all_known)
                summary = vc_health_checker.get_summary()
        return {"success": True, "data": summary}
    except Exception as e:
        return {"success": False, "message": str(e)}


@app.post("/api/vcenter-health/check")
async def trigger_full_health_check(background_tasks: BackgroundTasks) -> Dict[str, Any]:
    def _run_check():
        try:
            connected = list(pyvmomi_sessions.keys())
            creds_file = os.path.join(CACHE_DIR, "vcenter_credentials.json")
            all_known = list(connected)
            if os.path.exists(creds_file):
                with open(creds_file) as f:
                    creds = json.load(f)
                all_known += [h for h in creds.keys() if h not in all_known]
            if all_known:
                vc_health_checker.check_all_vcenters(all_known, connected)
        except Exception as e:
            print(f"[HEALTH CHECK] Error: {e}")
    background_tasks.add_task(_run_check)
    return {"success": True, "message": "Health check started"}


@app.post("/api/vcenter-health/check/{hostname}")
async def trigger_single_health_check(hostname: str) -> Dict[str, Any]:
    try:
        connected = list(pyvmomi_sessions.keys())
        is_connected = hostname in connected
        result = vc_health_checker.check_vcenter(hostname, is_connected=is_connected)
        return {"success": True, "data": result}
    except Exception as e:
        return {"success": False, "message": str(e)}


# ============================================
# PUPPET ENDPOINTS
# ============================================
@app.get("/api/puppet/{hostname}")
async def get_puppet_for_host(hostname: str) -> Dict[str, Any]:
    """Get Puppet data for a single hostname from PuppetDB"""
    try:
        data = puppet_client.get_puppet_data(hostname)
        if data:
            return {"success": True, "data": data}
        return {"success": False, "message": f"{hostname} not found in PuppetDB"}
    except Exception as e:
        return {"success": False, "message": str(e)}


@app.post("/api/cmdb/enrich/puppet")
async def enrich_cmdb_with_puppet(background_tasks: BackgroundTasks) -> Dict[str, Any]:
    """Background task: enrich all active CMDB records with PuppetDB data"""
    def _enrich():
        from concurrent.futures import ThreadPoolExecutor, as_completed
        records = historical_cmdb.records
        active = [r for r in records.values()
                  if r.get('status') != 'decommissioned' and r.get('vmName')]
        print(f"[PUPPET ENRICH] Starting enrichment for {len(active)} active VMs")
        enriched = 0
        not_found = 0

        def enrich_one(rec):
            name = rec.get('vmName', '')
            if not name or not name.endswith('.biz') and '.' not in name:
                return None
            data = puppet_client.get_puppet_data(name)
            return rec, data

        with ThreadPoolExecutor(max_workers=20) as ex:
            futures = {ex.submit(enrich_one, r): r for r in active}
            for future in as_completed(futures):
                result = future.result()
                if result is None:
                    continue
                rec, puppet_data = result
                vm_key = rec.get('vmKey', '')
                if not vm_key:
                    continue
                if puppet_data:
                    with historical_cmdb.lock:
                        if vm_key in historical_cmdb.records:
                            historical_cmdb.records[vm_key]['puppetData'] = puppet_data
                    enriched += 1
                else:
                    not_found += 1

        historical_cmdb.save()
        print(f"[PUPPET ENRICH] Done: {enriched} enriched, {not_found} not found")

    background_tasks.add_task(_enrich)
    return {"success": True, "message": "Puppet enrichment started in background"}




# ============================================
# GLOBAL SEARCH ENDPOINT
# ============================================
@app.get("/api/search")
async def global_search(q: str = "", limit: int = 20) -> Dict[str, Any]:
    try:
        if not q or len(q) < 2:
            return {"success": True, "data": {"vms": [], "hosts": [], "datastores": [], "networks": [], "total": 0}}
        cache_dict = {
            'hosts': data_cache.get('hosts') or [],
            'datastores': data_cache.get('datastores') or [],
            'networks': data_cache.get('networks') or [],
        }
        searcher = GlobalSearch(cache_dict, historical_cmdb)
        results = searcher.search(q, limit=limit)
        return {"success": True, "data": results}
    except Exception as e:
        return {"success": False, "message": str(e)}


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8000)