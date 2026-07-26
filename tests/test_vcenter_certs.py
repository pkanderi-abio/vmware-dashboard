"""Tests for the TLS certificate expiry scanner."""
from __future__ import annotations

import pytest


@pytest.fixture
def certs_module():
    import vcenter_certs
    return vcenter_certs


def test_classify_expired(certs_module):
    assert certs_module._classify(-1, warn_days=30, critical_days=7) == "expired"
    assert certs_module._classify(-100, warn_days=30, critical_days=7) == "expired"


def test_classify_critical(certs_module):
    assert certs_module._classify(0, warn_days=30, critical_days=7) == "critical"
    assert certs_module._classify(5, warn_days=30, critical_days=7) == "critical"
    assert certs_module._classify(7, warn_days=30, critical_days=7) == "critical"


def test_classify_warning(certs_module):
    assert certs_module._classify(8, warn_days=30, critical_days=7) == "warning"
    assert certs_module._classify(30, warn_days=30, critical_days=7) == "warning"


def test_classify_ok(certs_module):
    assert certs_module._classify(31, warn_days=30, critical_days=7) == "ok"
    assert certs_module._classify(365, warn_days=30, critical_days=7) == "ok"


def test_summarize_counts_every_status(certs_module):
    entries = [
        {"status": "ok"}, {"status": "ok"},
        {"status": "warning"},
        {"status": "critical"}, {"status": "critical"},
        {"status": "expired"},
        {"status": "error"},
    ]
    s = certs_module.summarize(entries)
    assert s == {"ok": 2, "warning": 1, "critical": 2, "expired": 1, "error": 1}


def test_inspect_returns_error_row_when_host_unreachable(certs_module, monkeypatch):
    """Unreachable target must not raise — the row is what the UI renders."""
    def _boom(*a, **kw):
        raise OSError("Network is unreachable")
    monkeypatch.setattr(certs_module, "_fetch_der", _boom)
    r = certs_module.inspect("nonexistent.invalid", kind="esxi", vcenter="vc.example")
    assert r["status"] == "error"
    assert "Network is unreachable" in r["message"]
    assert r["host"] == "nonexistent.invalid"
    assert r["kind"] == "esxi"


def test_inspect_all_parallelizes_and_sorts_by_severity(certs_module, monkeypatch):
    """Sort: expired -> critical -> warning -> ok -> error."""
    fixtures = {
        "ok.example": ("ok", 100),
        "warn.example": ("warning", 20),
        "crit.example": ("critical", 3),
        "gone.example": ("expired", -5),
        "err.example": None,  # signal the fetch will raise
    }
    def fake_inspect(host, *, kind, vcenter="", warn_days, critical_days):
        v = fixtures[host]
        if v is None:
            return {"host": host, "kind": kind, "vcenter": vcenter, "status": "error", "message": "boom"}
        status, days = v
        return {
            "host": host, "kind": kind, "vcenter": vcenter,
            "status": status, "daysUntilExpiry": days,
        }
    monkeypatch.setattr(certs_module, "inspect", fake_inspect)

    targets = [{"host": h, "kind": "esxi"} for h in fixtures]
    out = certs_module.inspect_all(targets, warn_days=30, critical_days=7)

    assert [r["host"] for r in out] == [
        "gone.example", "crit.example", "warn.example", "ok.example", "err.example",
    ]
