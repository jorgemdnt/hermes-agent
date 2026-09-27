"""Dashboard-local sign-out: bind cookie tokens to a browser, not Google's grant."""
from __future__ import annotations

import hashlib
import os
import sqlite3
import time
from contextlib import contextmanager
from pathlib import Path

from hermes_constants import get_process_hermes_home


def _path() -> Path:
    path = get_process_hermes_home() / "dashboard-auth-logout.db"
    if not path.exists():
        try:
            fd = os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
        except FileExistsError:
            pass
        else:
            os.close(fd)
    if path.is_symlink() or path.stat().st_mode & 0o077:
        raise ValueError("Dashboard logout store must be private (0600)")
    return path


@contextmanager
def _db():
    with sqlite3.connect(_path(), timeout=5) as db:
        db.execute("CREATE TABLE IF NOT EXISTS browser_tokens ("
                   "digest TEXT NOT NULL, browser_id TEXT NOT NULL, until REAL NOT NULL, "
                   "revoked INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(digest, browser_id))")
        db.execute("CREATE TABLE IF NOT EXISTS browser_revocations ("
                   "browser_id TEXT PRIMARY KEY, epoch INTEGER NOT NULL)")
        yield db


def _digest(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def bind(access: str, refresh: str, browser_id: str) -> None:
    now = time.time()
    with _db() as db:
        db.execute("DELETE FROM browser_tokens WHERE until < ?", (now,))
        for token, until in ((access, now + 7200), (refresh, now + 31 * 86400)):
            if token:
                db.execute("INSERT OR REPLACE INTO browser_tokens VALUES (?, ?, ?, 0)",
                           (_digest(token), browser_id, until))


def revoke(access: str, refresh: str, browser_id: str | None) -> None:
    if not browser_id:
        return  # Old cookie sets have no per-browser identity to revoke safely.
    with _db() as db:
        for token in (access, refresh):
            if token:
                db.execute("UPDATE browser_tokens SET revoked=1 WHERE digest=? AND browser_id=?",
                           (_digest(token), browser_id))
        # A live socket minted against an earlier access token must also lose its authority.
        db.execute("UPDATE browser_tokens SET revoked=1 WHERE browser_id=?", (browser_id,))
        db.execute("INSERT INTO browser_revocations(browser_id, epoch) VALUES (?, 1) "
                   "ON CONFLICT(browser_id) DO UPDATE SET epoch=epoch+1", (browser_id,))


def browser_epoch(browser_id: str) -> int:
    if not browser_id:
        return -1
    with _db() as db:
        row = db.execute("SELECT epoch FROM browser_revocations WHERE browser_id=?", (browser_id,)).fetchone()
        return row[0] if row else 0


def browser_token_active(access_digest: str, browser_id: str) -> bool:
    """Validate the exact access cookie that minted this live socket's ticket.

    Logout revokes that browser's existing rows; a fresh login can bind a new
    access token without resurrecting any of the old sockets.
    """
    if not access_digest or not browser_id:
        return False
    path = get_process_hermes_home() / "dashboard-auth-logout.db"
    if not path.exists():
        return False
    with _db() as db:
        return db.execute("SELECT 1 FROM browser_tokens WHERE digest=? AND browser_id=? "
                          "AND revoked=0 AND until>=? LIMIT 1",
                          (access_digest, browser_id, time.time())).fetchone() is not None


def allowed(token: str | None, browser_id: str | None) -> bool:
    if not token:
        return True
    path = get_process_hermes_home() / "dashboard-auth-logout.db"
    if not path.exists():
        return True  # Pre-deployment sessions remain valid until their own expiry.
    with _db() as db:
        rows = db.execute("SELECT browser_id, revoked FROM browser_tokens WHERE digest=? AND until>=?",
                          (_digest(token), time.time())).fetchall()
    if not rows:
        return True
    return any(browser_id == bound_id and not revoked for bound_id, revoked in rows)
