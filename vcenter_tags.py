"""
vSphere CIS REST API — tag collection.
Supports both the v7.0+ /api/ path and the legacy /rest/ path.
"""
from __future__ import annotations

import logging
from contextlib import suppress
from typing import Any, Dict, List, Optional

import requests
import urllib3

urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)
logger = logging.getLogger("vmware-dashboard.tags")

_TIMEOUT_AUTH = 15
_TIMEOUT_LIST = 15
_TIMEOUT_ITEM = 10


def collect_vsphere_tags(hostname: str, username: str, password: str) -> Dict[str, Any]:
    """
    Returns::

        {
            "tags": [{"id": str, "name": str, "categoryId": str, "categoryName": str}],
            "vm_tags": {"vm-moref": ["tag1", "tag2"], ...},
        }

    Falls back to empty dicts/lists on any failure so callers don't need to
    handle exceptions.
    """
    session = requests.Session()
    session.verify = False

    result = _try_v7(session, hostname, username, password)
    if result is None:
        result = _try_v6(session, hostname, username, password)

    session.close()
    return result or {"tags": [], "vm_tags": {}}


# ─────────────────────────────────────────────────────────────
# vSphere 7.0+ REST API  (/api/…)
# ─────────────────────────────────────────────────────────────
def _try_v7(session: requests.Session, hostname: str, username: str, password: str) -> Optional[Dict[str, Any]]:
    base = f"https://{hostname}/api"
    try:
        r = session.post(f"{base}/session", auth=(username, password), timeout=_TIMEOUT_AUTH)
        if r.status_code != 201:
            return None
        token: str = r.json()
        session.headers["vmware-api-session-id"] = token

        r = session.get(f"{base}/cis/tagging/tag", timeout=_TIMEOUT_LIST)
        if not r.ok:
            return None
        tag_ids: List[str] = r.json() or []

        # Fetch categories once
        cat_names: Dict[str, str] = {}
        with suppress(Exception):
            r2 = session.get(f"{base}/cis/tagging/category", timeout=_TIMEOUT_LIST)
            if r2.ok:
                for cat_id in (r2.json() or []):
                    with suppress(Exception):
                        rc = session.get(f"{base}/cis/tagging/category/{cat_id}", timeout=_TIMEOUT_ITEM)
                        if rc.ok:
                            cat_names[cat_id] = rc.json().get("name", cat_id)

        tags: List[Dict[str, Any]] = []
        tag_id_to_name: Dict[str, str] = {}
        for tag_id in tag_ids:
            with suppress(Exception):
                rt = session.get(f"{base}/cis/tagging/tag/{tag_id}", timeout=_TIMEOUT_ITEM)
                if rt.ok:
                    td = rt.json()
                    name: str = td.get("name", "")
                    cat_id: str = td.get("category_id", "")
                    tags.append({
                        "id": tag_id,
                        "name": name,
                        "categoryId": cat_id,
                        "categoryName": cat_names.get(cat_id, ""),
                    })
                    tag_id_to_name[tag_id] = name

        vm_tags: Dict[str, List[str]] = {}
        for tag_id in tag_ids:
            with suppress(Exception):
                ra = session.post(
                    f"{base}/cis/tagging/tag-association?action=list-attached-objects-on-tag",
                    json={"tag_id": tag_id},
                    timeout=_TIMEOUT_ITEM,
                )
                if ra.ok:
                    for obj in (ra.json() or []):
                        if obj.get("type") == "VirtualMachine":
                            moref = obj.get("id", "")
                            if moref:
                                vm_tags.setdefault(moref, []).append(
                                    tag_id_to_name.get(tag_id, tag_id)
                                )

        with suppress(Exception):
            session.delete(f"{base}/session", timeout=5)

        logger.info("Tags collected via v7 API from %s: %d tags, %d VMs", hostname, len(tags), len(vm_tags))
        return {"tags": tags, "vm_tags": vm_tags}

    except Exception as exc:
        logger.debug("v7 tag API failed for %s: %s", hostname, exc)
        return None


# ─────────────────────────────────────────────────────────────
# vSphere 6.5–6.7 REST API  (/rest/…)
# ─────────────────────────────────────────────────────────────
def _try_v6(session: requests.Session, hostname: str, username: str, password: str) -> Optional[Dict[str, Any]]:
    base = f"https://{hostname}/rest"
    try:
        r = session.post(f"{base}/com/vmware/cis/session", auth=(username, password), timeout=_TIMEOUT_AUTH)
        if not r.ok:
            return None
        token = r.json().get("value", "")
        session.headers["vmware-api-session-id"] = token

        r = session.get(f"{base}/com/vmware/cis/tagging/tag", timeout=_TIMEOUT_LIST)
        if not r.ok:
            return None
        tag_ids: List[str] = r.json().get("value", []) or []

        cat_names: Dict[str, str] = {}
        with suppress(Exception):
            r2 = session.get(f"{base}/com/vmware/cis/tagging/category", timeout=_TIMEOUT_LIST)
            if r2.ok:
                for cat_id in (r2.json().get("value", []) or []):
                    with suppress(Exception):
                        rc = session.get(f"{base}/com/vmware/cis/tagging/category/{cat_id}", timeout=_TIMEOUT_ITEM)
                        if rc.ok:
                            cat_names[cat_id] = rc.json().get("value", {}).get("name", cat_id)

        tags: List[Dict[str, Any]] = []
        tag_id_to_name: Dict[str, str] = {}
        for tag_id in tag_ids:
            with suppress(Exception):
                rt = session.get(f"{base}/com/vmware/cis/tagging/tag/{tag_id}", timeout=_TIMEOUT_ITEM)
                if rt.ok:
                    td = rt.json().get("value", {})
                    name = td.get("name", "")
                    cat_id = td.get("category_id", "")
                    tags.append({
                        "id": tag_id,
                        "name": name,
                        "categoryId": cat_id,
                        "categoryName": cat_names.get(cat_id, ""),
                    })
                    tag_id_to_name[tag_id] = name

        vm_tags: Dict[str, List[str]] = {}
        for tag_id in tag_ids:
            with suppress(Exception):
                ra = session.post(
                    f"{base}/com/vmware/cis/tagging/tag-association?~action=list-attached-objects-on-tag",
                    json={"tag_id": tag_id},
                    timeout=_TIMEOUT_ITEM,
                )
                if ra.ok:
                    for obj in (ra.json().get("value", []) or []):
                        if obj.get("type") == "VirtualMachine":
                            moref = obj.get("id", "")
                            if moref:
                                vm_tags.setdefault(moref, []).append(
                                    tag_id_to_name.get(tag_id, tag_id)
                                )

        with suppress(Exception):
            session.delete(f"{base}/com/vmware/cis/session", timeout=5)

        logger.info("Tags collected via v6 API from %s: %d tags, %d VMs", hostname, len(tags), len(vm_tags))
        return {"tags": tags, "vm_tags": vm_tags}

    except Exception as exc:
        logger.debug("v6 tag API failed for %s: %s", hostname, exc)
        return None
