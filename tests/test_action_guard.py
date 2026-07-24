"""Tests for the confirmation-token + audit-log guardrails."""
from __future__ import annotations

import importlib
import json
import time

import pytest


@pytest.fixture
def guard(isolated_cache_dir, monkeypatch):
    """Fresh action_guard bound to a temp audit log per test."""
    monkeypatch.setenv("HOME", str(isolated_cache_dir.parent))
    monkeypatch.setenv("USERPROFILE", str(isolated_cache_dir.parent))
    import action_guard
    importlib.reload(action_guard)
    # Point the audit file at the isolated cache dir explicitly (the module
    # picked up CACHE_DIR at reload time, but the env-based expand is machine-
    # specific — pin it here).
    monkeypatch.setattr(action_guard, "AUDIT_FILE", str(isolated_cache_dir / "audit.log"))
    return action_guard


def test_token_valid_roundtrip_consumes_once(guard):
    tok = guard.issue_token("delete", "prod-vm-01")["token"]
    # First use passes; second use is rejected (one-shot).
    guard.validate_token(tok, action="delete", target="prod-vm-01")
    with pytest.raises(guard.TokenError, match="invalid or has already been used"):
        guard.validate_token(tok, action="delete", target="prod-vm-01")


def test_token_wrong_action_rejected(guard):
    tok = guard.issue_token("delete", "prod-vm-01")["token"]
    with pytest.raises(guard.TokenError, match="issued for 'delete', not 'reset'"):
        guard.validate_token(tok, action="reset", target="prod-vm-01")


def test_token_wrong_target_rejected(guard):
    tok = guard.issue_token("delete", "prod-vm-01")["token"]
    with pytest.raises(guard.TokenError, match="issued for 'prod-vm-01', not 'staging-vm'"):
        guard.validate_token(tok, action="delete", target="staging-vm")


def test_token_expired(guard, monkeypatch):
    monkeypatch.setattr(guard, "TOKEN_TTL_SECONDS", 0)
    tok = guard.issue_token("delete", "prod-vm-01")["token"]
    time.sleep(0.05)
    with pytest.raises(guard.TokenError, match="expired|invalid"):
        guard.validate_token(tok, action="delete", target="prod-vm-01")


def test_missing_token_on_destructive_action(guard):
    with pytest.raises(guard.TokenError, match="Confirmation token required"):
        guard.validate_token(None, action="delete", target="prod-vm-01")


def test_non_destructive_action_skips_token(guard):
    # power_on is not in DESTRUCTIVE_ACTIONS; validate must return None quietly.
    guard.validate_token(None, action="power_on", target="prod-vm-01")


def test_issue_rejects_non_destructive_action(guard):
    with pytest.raises(guard.TokenError, match="does not require confirmation"):
        guard.issue_token("power_on", "prod-vm-01")


def test_issue_rejects_empty_target(guard):
    with pytest.raises(guard.TokenError, match="target name is required"):
        guard.issue_token("delete", "")


def test_audit_appends_jsonlines(guard):
    guard.audit(
        action="delete", target="prod-vm-01", vcenter="vc.example",
        client_ip="10.0.0.5", outcome="ok", detail="",
    )
    guard.audit(
        action="reset", target="staging", vcenter="vc.example",
        client_ip="10.0.0.5", outcome="failed", detail="offline",
    )
    entries = guard.read_audit(limit=10)
    # Newest first
    assert len(entries) == 2
    assert entries[0]["action"] == "reset"
    assert entries[0]["outcome"] == "failed"
    assert entries[1]["action"] == "delete"
    # File really is JSON lines
    with open(guard.AUDIT_FILE) as f:
        lines = [json.loads(x) for x in f if x.strip()]
    assert [e["action"] for e in lines] == ["delete", "reset"]


def test_audit_swallows_write_failures(guard, monkeypatch, tmp_path):
    # Point at an unwritable path — audit must not raise.
    monkeypatch.setattr(guard, "AUDIT_FILE", str(tmp_path / "nonexistent" / "dir" / "audit.log"))
    monkeypatch.setattr(guard, "CACHE_DIR", "/proc/1/nope-cannot-mkdir-here")
    guard.audit(
        action="delete", target="x", vcenter="v",
        client_ip="1.1.1.1", outcome="ok",
    )
