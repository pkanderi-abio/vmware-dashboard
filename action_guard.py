"""
Two guardrails between an unauthenticated HTTP client and a destructive
vSphere op:

  1. Confirmation tokens
     Any endpoint declared destructive requires the caller to first hit
     `POST /api/confirm` with the exact action + target VM name they intend to
     perform. The server hands back a short-lived token; the caller must then
     replay it as `X-Confirm-Token` on the actual mutating request. This
     stops accidental double-clicks, misdirected curls, and CSRF from being
     enough to nuke a VM — the caller has to physically type the VM name.

  2. Audit log
     Every mutation — successful or not — is appended to `audit.log` as
     JSON-lines with timestamp, client IP, action, target, and outcome.

Nothing here is auth. If the local network is hostile you still need real
credentials in front of the app; this module just makes accidents loud and
double-clicks impossible.
"""
from __future__ import annotations

import json
import logging
import os
import secrets
import threading
import time
from datetime import datetime
from typing import Any, Dict, Optional, Tuple

logger = logging.getLogger(__name__)

CACHE_DIR = os.path.expanduser("~/.vmware-dashboard-cache")
AUDIT_FILE = os.path.join(CACHE_DIR, "audit.log")

TOKEN_TTL_SECONDS = 120  # user has 2 minutes between confirm and act

# Actions that require a confirmation token. Anything not in this set is
# treated as safe (power on, snapshot create, clone, guest shutdown, etc.).
DESTRUCTIVE_ACTIONS = frozenset({
    "power_off",
    "reset",
    "snapshot_revert",
    "snapshot_delete",
    "modify",
    "delete",
})


class TokenError(RuntimeError):
    """Client-visible token-validation failure."""


_lock = threading.RLock()
# token -> (issued_at, action, target)
_tokens: Dict[str, Tuple[float, str, str]] = {}


def _prune_locked() -> None:
    """Drop expired tokens. Caller must hold _lock."""
    cutoff = time.time() - TOKEN_TTL_SECONDS
    for tok in [t for t, (ts, _, _) in _tokens.items() if ts < cutoff]:
        _tokens.pop(tok, None)


def issue_token(action: str, target: str) -> Dict[str, Any]:
    """Mint a token for `action` on `target`. Returns the JSON to hand back."""
    action = (action or "").strip()
    target = (target or "").strip()
    if action not in DESTRUCTIVE_ACTIONS:
        raise TokenError(
            f"Action {action!r} does not require confirmation — call the endpoint directly"
        )
    if not target:
        raise TokenError("A target name is required to issue a confirmation token")

    with _lock:
        _prune_locked()
        token = secrets.token_urlsafe(24)
        _tokens[token] = (time.time(), action, target)

    return {
        "token": token,
        "action": action,
        "target": target,
        "expires_in": TOKEN_TTL_SECONDS,
    }


def validate_token(token: Optional[str], *, action: str, target: str) -> None:
    """Consume a token exactly once. Raises TokenError on any mismatch."""
    if action not in DESTRUCTIVE_ACTIONS:
        return  # non-destructive endpoints skip token checks entirely

    if not token:
        raise TokenError(
            f"Confirmation token required for {action}. "
            "POST /api/confirm first, then include X-Confirm-Token on your request."
        )

    with _lock:
        _prune_locked()
        entry = _tokens.pop(token, None)

    if entry is None:
        raise TokenError("Confirmation token is invalid or has already been used")

    issued, tok_action, tok_target = entry
    if time.time() - issued > TOKEN_TTL_SECONDS:
        raise TokenError(f"Confirmation token expired (limit {TOKEN_TTL_SECONDS}s)")
    if tok_action != action:
        raise TokenError(
            f"Confirmation token was issued for {tok_action!r}, not {action!r}"
        )
    if tok_target != target:
        raise TokenError(
            f"Confirmation token was issued for {tok_target!r}, not {target!r}"
        )
    # Token consumed by the pop above — one-shot.


# ─── Audit log ───────────────────────────────────────────────────────────────

def audit(
    *,
    action: str,
    target: str,
    vcenter: str,
    client_ip: str,
    outcome: str,
    detail: str = "",
) -> None:
    """Append a JSON-line record for a mutation. Never raises."""
    entry = {
        "ts": datetime.now().isoformat(timespec="seconds"),
        "action": action,
        "target": target,
        "vcenter": vcenter,
        "client_ip": client_ip,
        "outcome": outcome,
        "detail": detail,
    }
    try:
        os.makedirs(CACHE_DIR, exist_ok=True)
        with open(AUDIT_FILE, "a", encoding="utf-8") as f:
            f.write(json.dumps(entry) + "\n")
    except Exception:
        logger.exception("Failed to append audit entry: %s", entry)


def read_audit(limit: int = 500) -> list[Dict[str, Any]]:
    """Return the last N audit entries, newest first."""
    if not os.path.exists(AUDIT_FILE):
        return []
    try:
        with open(AUDIT_FILE, encoding="utf-8") as f:
            lines = f.readlines()
    except OSError:
        return []
    out: list[Dict[str, Any]] = []
    for raw in lines[-limit:]:
        try:
            out.append(json.loads(raw))
        except json.JSONDecodeError:
            continue
    out.reverse()
    return out
