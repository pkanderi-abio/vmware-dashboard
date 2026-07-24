"""Tests for the credential save/load layer in main.py.

The invariant we care about: passwords round-trip through JSON on disk but are
never leaked back into the API contract (only `hasPassword` is exposed by
`/api/vcenters/connections`).
"""
from __future__ import annotations

import importlib
import json


def _reload_main():
    import main

    importlib.reload(main)
    return main


def test_save_and_load_credentials(isolated_cache_dir):
    main = _reload_main()
    main.save_credentials("vc-01.example", "svc", "hunter2", port=8443)

    creds = main.load_credentials()
    assert "vc-01.example" in creds
    rec = creds["vc-01.example"]
    assert rec["username"] == "svc"
    assert rec["password"] == "hunter2"
    assert rec["port"] == 8443
    assert rec["enabled"] is True


def test_remove_credentials(isolated_cache_dir):
    main = _reload_main()
    main.save_credentials("vc-01", "u", "p")
    main.remove_credentials("vc-01")
    assert main.load_credentials() == {}


def test_credentials_file_written_atomically(isolated_cache_dir):
    main = _reload_main()
    main.save_credentials("vc", "u", "p")
    # No leftover .tmp shadow file.
    assert not (isolated_cache_dir / "vcenter_credentials.json.tmp").exists()
    with open(isolated_cache_dir / "vcenter_credentials.json") as f:
        raw = json.load(f)
    # Stored under hostname, includes password (server-only file).
    assert raw["vc"]["password"] == "p"
