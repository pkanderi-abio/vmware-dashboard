"""Tests for the trending-snapshot writer in main.py."""
from __future__ import annotations

import importlib
import json
import time


def _fresh_main(monkeypatch, cache_dir):
    monkeypatch.setenv("HOME", str(cache_dir.parent))
    monkeypatch.setenv("USERPROFILE", str(cache_dir.parent))
    import main

    importlib.reload(main)
    # Aim the trending file at the isolated cache.
    monkeypatch.setattr(main, "TRENDING_FILE", str(cache_dir / "trending.json"))
    monkeypatch.setattr(main, "TRENDING_MIN_INTERVAL", 0)
    return main


def _seed_cache(main, vms, hosts, datastores):
    main.data_cache.set("vms", vms)
    main.data_cache.set("hosts", hosts)
    main.data_cache.set("datastores", datastores)


def test_snapshot_writes_expected_shape(isolated_cache_dir, monkeypatch):
    main = _fresh_main(monkeypatch, isolated_cache_dir)
    _seed_cache(
        main,
        vms=[{"powerState": "poweredOn"}, {"powerState": "poweredOff"}],
        hosts=[{"cpuUsagePct": 50, "memoryUsagePct": 60}],
        datastores=[{"capacityGB": 1000, "freeSpaceGB": 250}],
    )

    main._snapshot_trending()

    with open(main.TRENDING_FILE) as f:
        points = json.load(f)
    assert len(points) == 1
    p = points[0]
    assert p["totalVMs"] == 2
    assert p["poweredOnVMs"] == 1
    assert p["avgCpuPct"] == 50.0
    assert p["avgMemPct"] == 60.0
    assert p["avgStoragePct"] == 75.0  # (1000-250)/1000
    assert p["totalHosts"] == 1


def test_snapshot_noop_when_all_caches_empty(isolated_cache_dir, monkeypatch):
    main = _fresh_main(monkeypatch, isolated_cache_dir)
    main._snapshot_trending()
    import os

    assert not os.path.exists(main.TRENDING_FILE)


def test_snapshot_respects_min_interval(isolated_cache_dir, monkeypatch):
    main = _fresh_main(monkeypatch, isolated_cache_dir)
    monkeypatch.setattr(main, "TRENDING_MIN_INTERVAL", 3600)
    _seed_cache(main, vms=[{"powerState": "on"}], hosts=[], datastores=[])
    main._snapshot_trending()
    main._snapshot_trending()  # second call within the interval is a no-op
    with open(main.TRENDING_FILE) as f:
        assert len(json.load(f)) == 1


def test_snapshot_caps_at_max_points(isolated_cache_dir, monkeypatch):
    main = _fresh_main(monkeypatch, isolated_cache_dir)
    monkeypatch.setattr(main, "TRENDING_MAX_POINTS", 3)
    _seed_cache(main, vms=[{"powerState": "on"}], hosts=[], datastores=[])
    for _ in range(5):
        main._snapshot_trending()
        time.sleep(0.001)
    with open(main.TRENDING_FILE) as f:
        assert len(json.load(f)) == 3
