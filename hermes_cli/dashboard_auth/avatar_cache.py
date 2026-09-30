"""Private dashboard-owned photo cache; never stores session credentials."""
from __future__ import annotations

from contextlib import closing, contextmanager
import hashlib
import json
import os
import sqlite3
import time

from hermes_constants import get_process_hermes_home

_MAX_ENTRIES = 32
_MAX_AGE = 30 * 86400


def _key(value: object) -> str:
    return hashlib.sha256(json.dumps(value, separators=(",", ":")).encode()).hexdigest()


@contextmanager
def _db():
    directory = get_process_hermes_home() / "cache" / "dashboard-avatars"
    directory.mkdir(mode=0o700, parents=True, exist_ok=True)
    path = directory / "photos.db"
    try:
        fd = os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    except FileExistsError:
        pass
    else:
        os.close(fd)
    if path.is_symlink():
        raise OSError("Dashboard photo cache cannot be a symlink")
    path.chmod(0o600)
    with closing(sqlite3.connect(path, timeout=5)) as db, db:
        db.execute("CREATE TABLE IF NOT EXISTS profiles (identity TEXT PRIMARY KEY, url TEXT, updated REAL)")
        db.execute("CREATE TABLE IF NOT EXISTS images (url TEXT PRIMARY KEY, body BLOB, media_type TEXT, updated REAL)")
        yield db


def profile_picture(provider: str, user_id: str, picture: str) -> str:
    """Keep a known photo when a later verified identity omits optional profile claims."""
    identity = _key([provider, user_id])
    with _db() as db:
        now = time.time()
        db.execute("DELETE FROM profiles WHERE updated < ?", (now - _MAX_AGE,))
        if picture:
            db.execute("INSERT OR REPLACE INTO profiles VALUES (?, ?, ?)", (identity, picture, now))
            db.execute("DELETE FROM profiles WHERE identity NOT IN (SELECT identity FROM profiles ORDER BY updated DESC LIMIT ?)", (_MAX_ENTRIES,))
            return picture
        row = db.execute("SELECT url FROM profiles WHERE identity=?", (identity,)).fetchone()
        return row[0] if row else ""


def read_image(url: str) -> tuple[bytes, str, float] | None:
    with _db() as db:
        row = db.execute("SELECT body, media_type, updated FROM images WHERE url=? AND updated>=?",
                         (_key(url), time.time() - _MAX_AGE)).fetchone()
    return tuple(row) if row else None


def write_image(url: str, body: bytes, media_type: str) -> None:
    with _db() as db:
        db.execute("INSERT OR REPLACE INTO images VALUES (?, ?, ?, ?)", (_key(url), body, media_type, time.time()))
        db.execute("DELETE FROM images WHERE url NOT IN (SELECT url FROM images ORDER BY updated DESC LIMIT ?)", (_MAX_ENTRIES,))
