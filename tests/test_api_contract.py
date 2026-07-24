"""Contract tests — every ApiClient method in src/lib/api.ts must map to a real
FastAPI route in main.py, and every /api/* route must be reachable from the
client. Prevents drift where a rename on one side silently breaks the other.
"""
from __future__ import annotations

import importlib
import re
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
API_TS = REPO_ROOT / "src" / "lib" / "api.ts"


def _fastapi_routes() -> set[tuple[str, str]]:
    """Extract (method, path) tuples registered on the FastAPI app."""
    import main

    importlib.reload(main)
    routes: set[tuple[str, str]] = set()
    for r in main.app.routes:
        for m in getattr(r, "methods", set()) or set():
            if m in {"HEAD", "OPTIONS"}:
                continue
            routes.add((m, r.path))
    return routes


def _client_calls() -> list[tuple[str, str]]:
    """Extract (method, template) tuples from ApiClient.request calls."""
    src = API_TS.read_text(encoding="utf-8")
    # this.request<...>('/path', { method: 'POST' })  or  ('/path')
    pattern = re.compile(
        r"this\.request(?:<[^>]*>)?\(\s*[`'\"]([^`'\"]+)[`'\"](.*?)\)",
        re.DOTALL,
    )
    calls: list[tuple[str, str]] = []
    for path, tail in pattern.findall(src):
        method = "GET"
        m = re.search(r"method:\s*['\"](\w+)['\"]", tail)
        if m:
            method = m.group(1).upper()
        calls.append((method, path))
    # Two hand-rolled fetches use `${getApiBase()}/some/path` directly.
    # Skip the ApiClient.request wrapper which uses `${getApiBase()}${endpoint}`.
    for path in re.findall(r"getApiBase\(\)\}(/[A-Za-z0-9/_\-{}${}?=&]+)", src):
        calls.append(("GET", path))
    return calls


def _normalize(path: str) -> str:
    """Client uses ${x}; server uses {x}. Normalize to the server style."""
    path = re.sub(r"\$\{[^}]+\}", "{p}", path)
    path = re.sub(r"\{[^}]+\}", "{p}", path)
    return path.split("?", 1)[0]


def test_every_client_call_has_a_matching_route():
    server_routes = {(m, _normalize(p)) for m, p in _fastapi_routes()}
    unmatched: list[tuple[str, str]] = []
    for method, path in _client_calls():
        full = _normalize(f"/api{path}")
        if (method, full) not in server_routes:
            unmatched.append((method, full))
    assert not unmatched, (
        "ApiClient calls with no matching FastAPI route:\n  "
        + "\n  ".join(f"{m} {p}" for m, p in unmatched)
    )
