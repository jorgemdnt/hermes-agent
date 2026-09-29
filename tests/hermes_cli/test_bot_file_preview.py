import subprocess
import sys

import pytest
from starlette.testclient import TestClient

from hermes_cli import web_server
from hermes_cli.web_file_preview import list_preview, open_confined, read_preview, remote_preview


def test_preview_confines_every_component_and_symlinks(tmp_path):
    root = tmp_path / "project"
    root.mkdir()
    (root / "inside").mkdir()
    (root / "inside" / "safe.md").write_text("# Safe")
    (root / ".hidden.json").write_text('{"token":"no"}')
    (tmp_path / "secret.md").write_text("outside")
    (root / "escape.md").symlink_to(tmp_path / "secret.md")
    (root / "link").symlink_to(tmp_path, target_is_directory=True)
    assert read_preview(str(root), "inside/safe.md") == ("markdown", b"# Safe")
    assert list_preview(str(root), "") == [{"name": "inside", "kind": "directory"}]
    for path in ("../secret.md", "inside/../../secret.md", "/etc/passwd", ".hidden.json", "inside//safe.md", "inside/./safe.md", "inside\\safe.md", "inside/\x00.md"):
        with pytest.raises((ValueError, OSError)):
            open_confined(str(root), path)
    for path in ("escape.md", "link/secret.md"):
        with pytest.raises(OSError):
            read_preview(str(root), path)


def test_preview_limits_size_format_and_directories(tmp_path):
    (tmp_path / "huge.txt").write_bytes(b"x" * (8 * 1024 * 1024 + 1))
    (tmp_path / "script.svg").write_text("<script>alert(1)</script>")
    with pytest.raises(ValueError):
        read_preview(str(tmp_path), "huge.txt")
    with pytest.raises(ValueError):
        read_preview(str(tmp_path), "script.svg")
    with pytest.raises(ValueError):
        read_preview(str(tmp_path), "")




def test_remote_preview_executes_the_same_confined_reader(monkeypatch, tmp_path):
    import tools.environments.ssh as ssh

    (tmp_path / "safe.md").write_text("# Remote")
    (tmp_path / "escape.md").symlink_to(tmp_path.parent / "secret.md")
    (tmp_path.parent / "secret.md").write_text("outside")
    monkeypatch.setattr(ssh, "interactive_ssh_argv", lambda *_args, **_kwargs: ["ssh", "-tt", "dummy"])
    original_run = subprocess.run

    def run_locally(argv, **kwargs):
        assert argv[:3] == ["ssh", "-T", "dummy"]
        assert argv[3].startswith("python3 - ")
        encoded = argv[3].split(" ", 2)[2]
        return original_run([sys.executable, "-", encoded], **kwargs)

    monkeypatch.setattr(subprocess, "run", run_locally)
    config = {"ssh_host": "example.test", "ssh_user": "bot"}
    listing = remote_preview(config, str(tmp_path), "", "list")
    assert isinstance(listing, dict)
    assert {entry["name"]: entry["kind"] for entry in listing["entries"]}["safe.md"] == "markdown"
    assert "escape.md" not in {entry["name"] for entry in listing["entries"]}
    assert remote_preview(config, str(tmp_path), "safe.md", "content") == ("markdown", b"# Remote")
    with pytest.raises(ValueError, match="could not read"):
        remote_preview(config, str(tmp_path), "escape.md", "content")
    with pytest.raises(ValueError, match="Invalid preview path"):
        remote_preview(config, str(tmp_path), "../secret.md", "content")


def test_preview_api_uses_stored_folder_and_rejects_client_root(monkeypatch, tmp_path):
    import hermes_cli.web_bot_terminal as bot_terminal
    import hermes_cli.web_server_profiles as profiles
    root = tmp_path / "conversation"
    root.mkdir()
    (root / "note.md").write_text("# Conversation")
    (tmp_path / "other.md").write_text("Private")
    monkeypatch.setattr(profiles, "_resolve_profile_dir", lambda _profile: tmp_path)
    monkeypatch.setattr(bot_terminal, "terminal_config", lambda _profile: {"backend": "local", "cwd": str(tmp_path)})
    monkeypatch.setattr(bot_terminal, "stored_session_folder", lambda _profile, _session: {"cwd": str(root)})
    from hermes_cli.web_server import _SESSION_TOKEN
    client = TestClient(web_server.app, headers={"X-Hermes-Session-Token": _SESSION_TOKEN})
    base = {"profile": "default", "session": "chat-a"}
    assert client.get("/api/bot-preview", params=base).json()["folder"] == str(root)
    assert client.get("/api/bot-preview", params={**base, "path": "note.md", "view": "content"}).json() == {"kind": "markdown", "content": "# Conversation"}
    assert client.get("/api/bot-preview", params={**base, "path": "../other.md", "view": "content"}).status_code == 400
    assert client.get("/api/bot-preview", params={**base, "root": str(tmp_path)}).status_code == 400
    assert TestClient(web_server.app).get("/api/bot-preview", params=base).status_code == 401
    monkeypatch.setattr(bot_terminal, "terminal_config", lambda _profile: {"backend": "ssh", "cwd": str(root), "ssh_host": "example.test", "ssh_user": "bot"})
    monkeypatch.setattr(bot_terminal, "remote_folder_exists", lambda _config, _folder: True)
    import hermes_cli.web_file_preview as preview
    monkeypatch.setattr(preview, "remote_preview", lambda _config, folder, relative, view: {"folder": folder, "path": relative, "entries": [{"name": "note.md", "kind": "markdown"}]} if view == "list" else ("markdown", b"# Remote"))
    assert client.get("/api/bot-preview", params=base).json()["entries"] == [{"name": "note.md", "kind": "markdown"}]
    assert client.get("/api/bot-preview", params={**base, "view": "content", "path": "note.md"}).json()["content"] == "# Remote"
