"""
Certificate expiry monitor for ESXi hosts and vCenter Servers.

Speaks raw TLS to port 443 with verification disabled — we're not trying to
prove the cert is trusted, we just want to know when it expires. Parses the
DER with `cryptography.x509` and classifies each cert into ok / warning /
critical / expired based on days-until-expiry thresholds.
"""
from __future__ import annotations

import logging
import socket
import ssl
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from typing import Any, Dict, List

try:
    from cryptography import x509
    from cryptography.hazmat.backends import default_backend
    from cryptography.x509.oid import NameOID
    CRYPTO_AVAILABLE = True
except ImportError:
    CRYPTO_AVAILABLE = False

logger = logging.getLogger(__name__)

DEFAULT_WARN_DAYS = 30
DEFAULT_CRITICAL_DAYS = 7
FETCH_TIMEOUT_SECONDS = 6


def _fetch_der(host: str, port: int = 443, timeout: int = FETCH_TIMEOUT_SECONDS) -> bytes:
    """Open a TLS socket and return the peer's cert as DER bytes.

    Verification is disabled — an ESXi host with an expired or self-signed
    cert is exactly what we're trying to detect, so failing verification here
    would defeat the whole point.
    """
    ctx = ssl._create_unverified_context()
    with socket.create_connection((host, port), timeout=timeout) as sock:
        with ctx.wrap_socket(sock, server_hostname=host) as ssock:
            der = ssock.getpeercert(binary_form=True)
    if not der:
        raise RuntimeError("empty peer certificate")
    return der


def _extract_name(name: x509.Name, oid) -> str:
    for attr in name.get_attributes_for_oid(oid):
        return str(attr.value)
    return ""


def _extract_san(cert: x509.Certificate) -> List[str]:
    try:
        ext = cert.extensions.get_extension_for_class(x509.SubjectAlternativeName)
        return [str(g) for g in ext.value]
    except x509.ExtensionNotFound:
        return []


def _classify(days: float, warn_days: int, critical_days: int) -> str:
    if days < 0:
        return "expired"
    if days <= critical_days:
        return "critical"
    if days <= warn_days:
        return "warning"
    return "ok"


def inspect(
    host: str,
    *,
    kind: str,
    vcenter: str = "",
    warn_days: int = DEFAULT_WARN_DAYS,
    critical_days: int = DEFAULT_CRITICAL_DAYS,
) -> Dict[str, Any]:
    """Fetch and parse the cert on `host:443`. Never raises — errors go in the
    returned dict as status='error' so the UI can render them alongside the
    good rows."""
    entry: Dict[str, Any] = {
        "host": host,
        "kind": kind,             # 'esxi' | 'vcenter'
        "vcenter": vcenter,
        "status": "error",
        "message": "",
    }
    if not CRYPTO_AVAILABLE:
        entry["message"] = "cryptography package is not installed on the server"
        return entry
    try:
        der = _fetch_der(host)
    except Exception as e:
        entry["message"] = f"TLS fetch failed: {e}"
        return entry

    try:
        cert = x509.load_der_x509_certificate(der, default_backend())
    except Exception as e:
        entry["message"] = f"Certificate parse failed: {e}"
        return entry

    not_before = cert.not_valid_before_utc if hasattr(cert, "not_valid_before_utc") else cert.not_valid_before.replace(tzinfo=timezone.utc)
    not_after = cert.not_valid_after_utc if hasattr(cert, "not_valid_after_utc") else cert.not_valid_after.replace(tzinfo=timezone.utc)
    now = datetime.now(timezone.utc)
    days_left = round((not_after - now).total_seconds() / 86400, 1)

    entry.update({
        "status": _classify(days_left, warn_days, critical_days),
        "message": "",
        "subject": _extract_name(cert.subject, NameOID.COMMON_NAME) or cert.subject.rfc4514_string(),
        "issuer": _extract_name(cert.issuer, NameOID.COMMON_NAME) or cert.issuer.rfc4514_string(),
        "notBefore": not_before.isoformat(timespec="seconds"),
        "notAfter": not_after.isoformat(timespec="seconds"),
        "daysUntilExpiry": days_left,
        "serialNumber": format(cert.serial_number, "x"),
        "san": _extract_san(cert),
        "signatureAlgorithm": cert.signature_algorithm_oid._name,
        "selfSigned": cert.subject == cert.issuer,
    })
    return entry


def inspect_all(
    targets: List[Dict[str, str]],
    *,
    warn_days: int = DEFAULT_WARN_DAYS,
    critical_days: int = DEFAULT_CRITICAL_DAYS,
    max_workers: int = 8,
) -> List[Dict[str, Any]]:
    """Inspect a list of {host, kind, vcenter} entries in parallel."""
    out: List[Dict[str, Any]] = []
    if not targets:
        return out
    with ThreadPoolExecutor(max_workers=max_workers) as pool:
        futures = {
            pool.submit(
                inspect, t["host"],
                kind=t.get("kind", "esxi"),
                vcenter=t.get("vcenter", ""),
                warn_days=warn_days,
                critical_days=critical_days,
            ): t for t in targets
        }
        for f in as_completed(futures):
            try:
                out.append(f.result())
            except Exception as e:
                t = futures[f]
                logger.exception("Cert inspect crashed for %s", t.get("host"))
                out.append({
                    "host": t.get("host", ""),
                    "kind": t.get("kind", "esxi"),
                    "vcenter": t.get("vcenter", ""),
                    "status": "error",
                    "message": repr(e),
                })
    out.sort(key=lambda e: (
        {"expired": 0, "critical": 1, "warning": 2, "ok": 3, "error": 4}.get(e.get("status", "error"), 5),
        e.get("host", ""),
    ))
    return out


def summarize(entries: List[Dict[str, Any]]) -> Dict[str, int]:
    counts = {"ok": 0, "warning": 0, "critical": 0, "expired": 0, "error": 0}
    for e in entries:
        counts[e.get("status", "error")] = counts.get(e.get("status", "error"), 0) + 1
    return counts
