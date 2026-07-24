"""Shared pytest fixtures.

Point CACHE_DIR at a per-test temp directory *before* main.py is imported so
the persistent cache never touches the developer's real ~/.vmware-dashboard-cache/.
"""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT))


@pytest.fixture
def isolated_cache_dir(tmp_path, monkeypatch):
    """Redirect the persistent cache to a temp dir for a single test."""
    monkeypatch.setenv("HOME", str(tmp_path))
    monkeypatch.setenv("USERPROFILE", str(tmp_path))
    cache_dir = tmp_path / ".vmware-dashboard-cache"
    cache_dir.mkdir(parents=True, exist_ok=True)
    return cache_dir
