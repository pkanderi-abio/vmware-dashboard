"""Tests for main.PersistentCache — TTL, persistence, and concurrent access."""
from __future__ import annotations

import json
import threading
import time

import pytest


@pytest.fixture
def cache(isolated_cache_dir, monkeypatch):
    # Import lazily so CACHE_DIR resolves against the patched HOME.
    import importlib

    import main

    importlib.reload(main)
    monkeypatch.setattr(main, "CACHE_TTL_SECONDS", 1)
    c = main.PersistentCache(str(isolated_cache_dir))
    return c


def test_set_then_get_roundtrips(cache):
    cache.set("vms", [{"name": "vm-1"}])
    assert cache.get("vms") == [{"name": "vm-1"}]


def test_ttl_expires(cache):
    cache.set("hosts", [{"name": "h"}])
    time.sleep(1.1)
    assert cache.get("hosts") is None
    assert cache.get("hosts", ignore_ttl=True) == [{"name": "h"}]


def test_persists_across_instances(cache, isolated_cache_dir):
    from main import PersistentCache

    cache.set("networks", ["net-a"])
    reloaded = PersistentCache(str(isolated_cache_dir))
    assert reloaded.get("networks", ignore_ttl=True) == ["net-a"]


def test_clear_wipes_disk(cache, isolated_cache_dir):
    cache.set("k", "v")
    cache.clear()
    with open(isolated_cache_dir / "cache.json") as f:
        assert json.load(f) == {}


def test_status_reports_size_and_age(cache):
    cache.set("k", [1, 2, 3])
    status = cache.get_status()
    assert "k" in status
    assert status["k"]["size"] > 0
    assert status["k"]["age_seconds"] >= 0
    assert status["k"]["expired"] is False


def test_concurrent_writers_dont_corrupt(cache):
    def writer(i: int) -> None:
        for j in range(20):
            cache.set(f"key-{i}", {"j": j})

    threads = [threading.Thread(target=writer, args=(i,)) for i in range(4)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    # All four keys must be present and the file must remain valid JSON.
    for i in range(4):
        assert cache.get(f"key-{i}", ignore_ttl=True) == {"j": 19}
