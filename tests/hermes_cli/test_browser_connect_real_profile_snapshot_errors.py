"""Real-profile snapshot while the browser is running: cookie-only, fail closed on Cookies.

A running Chrome/Dia on macOS/Linux lets ``Cookies`` back up but holds ``Login Data`` /
``Login Data For Account`` / ``Web Data`` with a write lock, so their SQLite online backup misses
its deadline. Saved passwords and autofill are not needed for agent browsing, so those are
skipped and the snapshot still launches. ``Cookies`` is the session: when it cannot be read the
launch fails closed and names it with the reason, never a bare count (#111647).
"""
import json
import os
import sqlite3

import pytest

import hermes_cli.browser_connect as bc

_LOCKED = ("Login Data", "Login Data For Account", "Web Data")


def _fake_profile(root):
    (root / "Default" / "Network").mkdir(parents=True)
    (root / "Local State").write_text(json.dumps({"profile": {"last_used": "Default"}}))
    (root / "Default" / "Preferences").write_text("{}")
    for name in ("Cookies", *_LOCKED):
        con = sqlite3.connect(root / "Default" / name)
        con.execute("create table t(x)")
        con.execute("insert into t values(1)")
        con.commit()
        con.close()


def _hold(root, names):
    holders = []
    for name in names:
        h = sqlite3.connect(root / "Default" / name)
        h.execute("begin exclusive")
        holders.append(h)
    return holders


def _release(holders):
    for h in holders:
        h.rollback()
        h.close()


def test_locked_login_dbs_yield_cookie_only_snapshot(tmp_path, monkeypatch):
    """Write-locked login/autofill DBs do not block the snapshot: it completes with Cookies,
    Preferences and Local State, and simply lacks the locked DBs."""
    root = tmp_path / "real"
    _fake_profile(root)
    monkeypatch.setattr(bc, "get_hermes_home", lambda: tmp_path / "hh")
    monkeypatch.setattr(bc, "_AUTH_BACKUP_DEADLINE_S", 0.3)  # keep the test fast; 5 s in prod
    holders = _hold(root, _LOCKED)
    try:
        dst, err = bc.snapshot_real_profile("chrome", src=str(root))
    finally:
        _release(holders)
    assert err is None and dst
    default = os.path.join(dst, "Default")
    assert sqlite3.connect(os.path.join(default, "Cookies")).execute("select x from t").fetchall() == [(1,)]
    assert os.path.isfile(os.path.join(default, "Preferences"))
    assert os.path.isfile(os.path.join(dst, "Local State"))
    assert os.path.isfile(os.path.join(dst, bc._SNAPSHOT_DONE_MARKER))
    for name in _LOCKED:
        assert not os.path.exists(os.path.join(default, name))


def test_unlocked_profile_snapshots_every_auth_db(tmp_path, monkeypatch):
    """With nothing holding a lock the refresh still carries the login/autofill DBs."""
    root = tmp_path / "real"
    _fake_profile(root)
    monkeypatch.setattr(bc, "get_hermes_home", lambda: tmp_path / "hh")
    dst, err = bc.snapshot_real_profile("chrome", src=str(root))
    assert err is None and dst
    for name in ("Cookies", *_LOCKED):
        assert os.path.isfile(os.path.join(dst, "Default", name)), name


def test_locked_cookies_fails_closed_by_name(tmp_path, monkeypatch):
    """Cookies is the session: a write-locked Cookies DB fails the snapshot with the lock
    wording and names only Cookies."""
    root = tmp_path / "real"
    _fake_profile(root)
    monkeypatch.setattr(bc, "get_hermes_home", lambda: tmp_path / "hh")
    monkeypatch.setattr(bc, "_AUTH_BACKUP_DEADLINE_S", 0.3)
    holders = _hold(root, ("Cookies", *_LOCKED))
    try:
        dst, err = bc.snapshot_real_profile("chrome", src=str(root))
    finally:
        _release(holders)
    assert dst is None and err
    assert "holds the profile's Cookies with a write lock" in err, err
    for name in _LOCKED:
        assert name not in err


@pytest.mark.parametrize("reason, expect", [
    (None, ("is running and holds the profile's Cookies with a write lock", "Fully quit chrome")),
    ("file is not a database", ("Cookies: file is not a database", "Close chrome")),
])
def test_snapshot_error_names_cookies_and_reason(tmp_path, monkeypatch, reason, expect):
    """The user-facing error carries the failed DB name plus the reason: the lock wording when
    the failure is the backup deadline, the SQLite error otherwise."""
    root = tmp_path / "real"
    _fake_profile(root)
    monkeypatch.setattr(bc, "get_hermes_home", lambda: tmp_path / "hh")
    failing = reason or bc._AUTH_DB_LOCKED

    def fake_copy(src, dst_file):
        return failing if os.path.basename(src) in ("Cookies", *_LOCKED) else None

    monkeypatch.setattr(bc, "_copy_auth_file", fake_copy)
    dst, err = bc.snapshot_real_profile("chrome", src=str(root))
    assert dst is None and err
    for fragment in expect:
        assert fragment in err, err
    assert "database(s) unavailable" not in err
    assert "Login Data" not in err  # skipped DBs are not blamed
