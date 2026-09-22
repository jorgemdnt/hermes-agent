"""Codex models catalog URL.

OpenAI hides a model when the requested ``client_version`` is older than that
model's ``minimal_client_version``. ``0.0.0`` used to be an ungated sentinel.
It is not. Send the newest real Codex client version we can see, and only
fall back to ``0.0.0`` when that fetch comes back empty.
"""

from __future__ import annotations

import json
import os
import re
import subprocess
from pathlib import Path
from typing import Any, Callable, Optional

CODEX_UNGATED_CLIENT_VERSION = "0.0.0"
_CATALOG = "https://chatgpt.com/backend-api/codex/models"
_VERSION_RE = re.compile(r"(\d+)\.(\d+)\.(\d+)")
_VERSION_TOKEN_RE = re.compile(r"(\d+\.\d+\.\d+(?:[-.][0-9A-Za-z]+)*)")


def _version_key(text: str) -> Optional[tuple[int, int, int]]:
    match = _VERSION_RE.search(text or "")
    if not match:
        return None
    return (int(match.group(1)), int(match.group(2)), int(match.group(3)))


def newest_codex_client_version(cache_version: Optional[str], cli_version: Optional[str]) -> str:
    """Newer of the two real versions. Cache wins a tie. Sentinel if neither parses."""
    best_text = ""
    best_key: Optional[tuple[int, int, int]] = None
    for raw in (cache_version, cli_version):
        text = (raw or "").strip()
        key = _version_key(text)
        if key is None:
            continue
        if best_key is None or key > best_key:
            best_key = key
            best_text = text
    return best_text or CODEX_UNGATED_CLIENT_VERSION


def _cache_client_version() -> Optional[str]:
    home = os.getenv("CODEX_HOME", "").strip()
    root = Path(home).expanduser() if home else Path.home() / ".codex"
    try:
        raw = json.loads((root / "models_cache.json").read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError):
        return None
    version = raw.get("client_version") if isinstance(raw, dict) else None
    text = version.strip() if isinstance(version, str) else ""
    return text if _version_key(text) else None


def _cli_client_version() -> Optional[str]:
    try:
        proc = subprocess.run(
            ["codex", "--version"],
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=3,
            stdin=subprocess.DEVNULL,
            check=False,
        )
    except (OSError, subprocess.TimeoutExpired):
        return None
    match = _VERSION_TOKEN_RE.search((proc.stdout or "") + "\n" + (proc.stderr or ""))
    return match.group(1) if match else None


def codex_catalog_client_version() -> str:
    return newest_codex_client_version(_cache_client_version(), _cli_client_version())


def codex_models_catalog_url(client_version: Optional[str] = None) -> str:
    version = codex_catalog_client_version() if client_version is None else client_version
    return f"{_CATALOG}?client_version={version}"


def _models_empty(data: Any) -> bool:
    if not isinstance(data, dict):
        return True
    models = data.get("models")
    return not isinstance(models, list) or not models


def fetch_codex_catalog(get: Callable[[str], Any]) -> Any:
    """GET the catalog. An empty body retries once with the ungated sentinel."""
    version = codex_catalog_client_version()
    response = get(codex_models_catalog_url(version))
    if version == CODEX_UNGATED_CLIENT_VERSION or getattr(response, "status_code", None) != 200:
        return response
    try:
        data = response.json()
    except Exception:
        return response
    if not _models_empty(data):
        return response
    return get(codex_models_catalog_url(CODEX_UNGATED_CLIENT_VERSION))
