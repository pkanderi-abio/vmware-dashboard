#!/usr/bin/env python3
"""
VM Lifecycle operations against a live pyVmomi session.

Every function takes a `VCenterPyVmomi` client and a target VM's managed-object
id, resolves it to a `vim.VirtualMachine`, invokes the vSphere op, and (for ops
that return a Task) blocks until the task settles — because our HTTP callers
want a synchronous "did it work?" answer, not a task handle they have to poll.

Any exception bubbles up to main.py's endpoint layer which turns it into a
structured error the UI can render.
"""
from __future__ import annotations

import logging
import time
from typing import TYPE_CHECKING, Any, Dict, List, Optional

try:
    from pyVmomi import vim  # noqa: F401
    PYVMOMI_AVAILABLE = True
except ImportError:
    vim = None  # type: ignore[assignment]
    PYVMOMI_AVAILABLE = False

if TYPE_CHECKING:  # pragma: no cover
    from main import VCenterPyVmomi

logger = logging.getLogger(__name__)

# Cap on how long we'll block waiting for a vSphere Task to complete before
# returning "still running" — clone / large disk-modify ops routinely exceed
# 30s so we allow generous headroom.
TASK_TIMEOUT_SECONDS = 300


class LifecycleError(RuntimeError):
    """Raised for any lifecycle op failure. Message is user-safe."""


def _require_pyvmomi() -> None:
    if not PYVMOMI_AVAILABLE:
        raise LifecycleError("pyVmomi is not installed on the server")


# ─── Object lookup ───────────────────────────────────────────────────────────

def _find_vm(client: "VCenterPyVmomi", vm_id: str) -> Any:
    """Resolve a VM managed-object id back to its vim.VirtualMachine."""
    _require_pyvmomi()
    if not client.ensure_connected() or not client.content:
        raise LifecycleError(f"vCenter {client.hostname} is not connected")

    view = client.content.viewManager.CreateContainerView(
        client.content.rootFolder, [vim.VirtualMachine], True
    )
    try:
        for vm in view.view:
            if getattr(vm, "_moId", "") == vm_id:
                return vm
    finally:
        try:
            view.Destroy()
        except Exception:
            pass
    raise LifecycleError(f"VM {vm_id} not found on {client.hostname}")


def _find_snapshot(vm: Any, snapshot_id: str) -> Any:
    """Walk the VM's snapshot tree looking for the matching moref id."""
    snap_root = getattr(getattr(vm, "snapshot", None), "rootSnapshotList", None)
    if not snap_root:
        raise LifecycleError("VM has no snapshots")

    stack = list(snap_root)
    while stack:
        node = stack.pop()
        snap_ref = getattr(node, "snapshot", None)
        if snap_ref is not None and getattr(snap_ref, "_moId", "") == snapshot_id:
            return snap_ref
        stack.extend(getattr(node, "childSnapshotList", []) or [])
    raise LifecycleError(f"Snapshot {snapshot_id} not found on this VM")


# ─── Task blocker ────────────────────────────────────────────────────────────

def _await_task(task: Any, description: str) -> Any:
    """Block until a vSphere Task settles; raise LifecycleError on failure."""
    deadline = time.monotonic() + TASK_TIMEOUT_SECONDS
    while True:
        state = str(getattr(task.info, "state", "")).lower()
        if "success" in state:
            return task.info.result
        if "error" in state:
            fault = getattr(task.info, "error", None)
            msg = getattr(fault, "msg", None) or str(fault) or "unknown vSphere fault"
            raise LifecycleError(f"{description} failed: {msg}")
        if time.monotonic() > deadline:
            raise LifecycleError(
                f"{description} still running after {TASK_TIMEOUT_SECONDS}s "
                "— check vCenter Tasks & Events"
            )
        time.sleep(1)


# ─── Power ops ───────────────────────────────────────────────────────────────

def power_on(client: "VCenterPyVmomi", vm_id: str) -> Dict[str, Any]:
    vm = _find_vm(client, vm_id)
    _await_task(vm.PowerOnVM_Task(), "Power on")
    return {"vmId": vm_id, "action": "power_on", "powerState": "poweredOn"}


def power_off(client: "VCenterPyVmomi", vm_id: str) -> Dict[str, Any]:
    """Hard power off — equivalent to pulling the plug."""
    vm = _find_vm(client, vm_id)
    _await_task(vm.PowerOffVM_Task(), "Power off")
    return {"vmId": vm_id, "action": "power_off", "powerState": "poweredOff"}


def reset(client: "VCenterPyVmomi", vm_id: str) -> Dict[str, Any]:
    """Hard reset — VM restarts without a clean guest shutdown."""
    vm = _find_vm(client, vm_id)
    _await_task(vm.ResetVM_Task(), "Reset")
    return {"vmId": vm_id, "action": "reset"}


def suspend(client: "VCenterPyVmomi", vm_id: str) -> Dict[str, Any]:
    vm = _find_vm(client, vm_id)
    _await_task(vm.SuspendVM_Task(), "Suspend")
    return {"vmId": vm_id, "action": "suspend", "powerState": "suspended"}


def guest_shutdown(client: "VCenterPyVmomi", vm_id: str) -> Dict[str, Any]:
    """Ask VMware Tools to gracefully shut down the guest OS. Requires tools."""
    vm = _find_vm(client, vm_id)
    tools_status = str(getattr(getattr(vm, "guest", None), "toolsStatus", "")).lower()
    if "notinstalled" in tools_status or "notrunning" in tools_status:
        raise LifecycleError(
            "Cannot request guest shutdown: VMware Tools is not running on this VM"
        )
    # ShutdownGuest is fire-and-forget — no Task object comes back.
    vm.ShutdownGuest()
    return {"vmId": vm_id, "action": "guest_shutdown", "message": "Shutdown requested"}


def guest_reboot(client: "VCenterPyVmomi", vm_id: str) -> Dict[str, Any]:
    vm = _find_vm(client, vm_id)
    tools_status = str(getattr(getattr(vm, "guest", None), "toolsStatus", "")).lower()
    if "notinstalled" in tools_status or "notrunning" in tools_status:
        raise LifecycleError(
            "Cannot request guest reboot: VMware Tools is not running on this VM"
        )
    vm.RebootGuest()
    return {"vmId": vm_id, "action": "guest_reboot", "message": "Reboot requested"}


# ─── Snapshot ops ────────────────────────────────────────────────────────────

def snapshot_create(
    client: "VCenterPyVmomi",
    vm_id: str,
    *,
    name: str,
    description: str = "",
    memory: bool = False,
    quiesce: bool = True,
) -> Dict[str, Any]:
    if not name.strip():
        raise LifecycleError("Snapshot name is required")
    vm = _find_vm(client, vm_id)
    task = vm.CreateSnapshot_Task(
        name=name.strip(),
        description=description or "",
        memory=memory,
        quiesce=quiesce,
    )
    _await_task(task, "Create snapshot")
    return {"vmId": vm_id, "action": "snapshot_create", "name": name.strip()}


def snapshot_revert(
    client: "VCenterPyVmomi", vm_id: str, *, snapshot_id: str
) -> Dict[str, Any]:
    vm = _find_vm(client, vm_id)
    snap = _find_snapshot(vm, snapshot_id)
    _await_task(snap.RevertToSnapshot_Task(), "Revert to snapshot")
    return {"vmId": vm_id, "action": "snapshot_revert", "snapshotId": snapshot_id}


def snapshot_delete(
    client: "VCenterPyVmomi",
    vm_id: str,
    *,
    snapshot_id: str,
    remove_children: bool = False,
) -> Dict[str, Any]:
    vm = _find_vm(client, vm_id)
    snap = _find_snapshot(vm, snapshot_id)
    _await_task(snap.RemoveSnapshot_Task(removeChildren=remove_children), "Delete snapshot")
    return {
        "vmId": vm_id,
        "action": "snapshot_delete",
        "snapshotId": snapshot_id,
        "removeChildren": remove_children,
    }


# ─── Modify: CPU / memory ────────────────────────────────────────────────────

def modify(
    client: "VCenterPyVmomi",
    vm_id: str,
    *,
    num_cpu: Optional[int] = None,
    memory_mb: Optional[int] = None,
) -> Dict[str, Any]:
    if num_cpu is None and memory_mb is None:
        raise LifecycleError("Nothing to modify: pass num_cpu or memory_mb")
    if num_cpu is not None and (num_cpu < 1 or num_cpu > 128):
        raise LifecycleError("num_cpu must be between 1 and 128")
    if memory_mb is not None and (memory_mb < 128 or memory_mb > 8_388_608):
        raise LifecycleError("memory_mb must be between 128 and 8388608 (8 TiB)")

    vm = _find_vm(client, vm_id)
    spec = vim.vm.ConfigSpec()
    if num_cpu is not None:
        spec.numCPUs = int(num_cpu)
    if memory_mb is not None:
        spec.memoryMB = int(memory_mb)
    _await_task(vm.ReconfigVM_Task(spec=spec), "Modify VM hardware")
    return {"vmId": vm_id, "action": "modify", "numCPU": num_cpu, "memoryMB": memory_mb}


# ─── Delete / decommission ───────────────────────────────────────────────────

def delete(client: "VCenterPyVmomi", vm_id: str) -> Dict[str, Any]:
    """Power off (if running) then destroy the VM. Irreversible."""
    vm = _find_vm(client, vm_id)
    power = str(getattr(getattr(vm, "runtime", None), "powerState", "")).lower()
    if "on" in power:
        try:
            _await_task(vm.PowerOffVM_Task(), "Power off before delete")
        except LifecycleError as e:
            logger.warning("Ignoring power-off failure before delete: %s", e)
    _await_task(vm.Destroy_Task(), "Destroy VM")
    return {"vmId": vm_id, "action": "delete"}


# ─── Templates + clone ───────────────────────────────────────────────────────

def list_templates(client: "VCenterPyVmomi") -> List[Dict[str, Any]]:
    """Return every VM marked as a template on this vCenter."""
    _require_pyvmomi()
    if not client.ensure_connected() or not client.content:
        raise LifecycleError(f"vCenter {client.hostname} is not connected")

    view = client.content.viewManager.CreateContainerView(
        client.content.rootFolder, [vim.VirtualMachine], True
    )
    templates: List[Dict[str, Any]] = []
    try:
        for vm in view.view:
            if not getattr(getattr(vm, "config", None), "template", False):
                continue
            cfg = vm.config
            templates.append({
                "templateId": vm._moId,
                "name": vm.name,
                "guestFullName": getattr(cfg, "guestFullName", ""),
                "numCPU": getattr(getattr(cfg, "hardware", None), "numCPU", 0),
                "memoryMB": getattr(getattr(cfg, "hardware", None), "memoryMB", 0),
                "vcenterName": client.hostname,
            })
    finally:
        try:
            view.Destroy()
        except Exception:
            pass
    return sorted(templates, key=lambda t: t["name"].lower())


def _find_by_moid(client: "VCenterPyVmomi", type_cls: Any, moid: str) -> Any:
    view = client.content.viewManager.CreateContainerView(
        client.content.rootFolder, [type_cls], True
    )
    try:
        for obj in view.view:
            if getattr(obj, "_moId", "") == moid:
                return obj
    finally:
        try:
            view.Destroy()
        except Exception:
            pass
    return None


def clone_from_template(
    client: "VCenterPyVmomi",
    *,
    template_id: str,
    target_name: str,
    datastore_id: Optional[str] = None,
    host_id: Optional[str] = None,
    power_on: bool = False,
) -> Dict[str, Any]:
    if not target_name.strip():
        raise LifecycleError("Target VM name is required")

    template = _find_by_moid(client, vim.VirtualMachine, template_id)
    if template is None or not getattr(getattr(template, "config", None), "template", False):
        raise LifecycleError(f"Template {template_id} not found or not a template")

    # Destination folder = the template's parent folder.
    dest_folder = template.parent
    while dest_folder is not None and not isinstance(dest_folder, vim.Folder):
        dest_folder = getattr(dest_folder, "parent", None)
    if dest_folder is None:
        raise LifecycleError("Could not resolve a destination folder from the template")

    relocate = vim.vm.RelocateSpec()
    if datastore_id:
        ds = _find_by_moid(client, vim.Datastore, datastore_id)
        if ds is None:
            raise LifecycleError(f"Datastore {datastore_id} not found")
        relocate.datastore = ds
    if host_id:
        host = _find_by_moid(client, vim.HostSystem, host_id)
        if host is None:
            raise LifecycleError(f"Host {host_id} not found")
        relocate.host = host

    spec = vim.vm.CloneSpec(
        location=relocate,
        powerOn=bool(power_on),
        template=False,
    )
    task = template.CloneVM_Task(
        folder=dest_folder,
        name=target_name.strip(),
        spec=spec,
    )
    _await_task(task, "Clone from template")
    return {
        "action": "clone_from_template",
        "templateId": template_id,
        "targetName": target_name.strip(),
        "poweredOn": bool(power_on),
    }
