from __future__ import annotations

import subprocess
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from hermes_cli import projects_db
from hermes_cli import web_mobile_workspace as workspace


def _git(path: Path, *args: str):
    subprocess.run(["git", *args], cwd=path, check=True, capture_output=True)


@pytest.fixture
def setup(tmp_path: Path, monkeypatch):
    home = tmp_path / "home"
    home.mkdir()
    repo = tmp_path / "example"
    repo.mkdir()
    _git(repo, "init", "-b", "main")
    _git(repo, "-c", "user.email=qa@example.test", "-c", "user.name=QA", "commit", "--allow-empty", "-m", "init")
    monkeypatch.setattr(workspace, "_resolve_profile_dir", lambda profile: home if profile == "default" else (_ for _ in ()).throw(ValueError("Unknown profile")))
    monkeypatch.setattr(workspace, "terminal_config", lambda profile: {"backend": "local"})
    with projects_db.connect_closing(db_path=home / "projects.db") as db:
        project_id = projects_db.create_project(db, name="Example", primary_path=str(repo))
    return home, repo, project_id


def test_project_list_and_local_first_send(setup):
    _, repo, project_id = setup
    result = workspace.list_workspaces("default")
    assert result == {"projects": [{"id": project_id, "label": "Example", "path": str(repo), "git": True}], "supported": True}
    prepared = workspace.prepare_workspace(workspace.WorkspaceRequest(profile="default", project_id=project_id, mode="local"))
    assert prepared == {"cwd": str(repo), "branch": None}


def test_project_without_folder_is_not_offered(setup):
    home, repo, project_id = setup
    with projects_db.connect_closing(db_path=home / "projects.db") as db:
        projects_db.create_project(db, name="No folder")
    assert workspace.list_workspaces("default")["projects"] == [{"id": project_id, "label": "Example", "path": str(repo), "git": True}]


def test_worktree_is_real_and_invalid_branch_does_not_create_it(setup):
    _, repo, project_id = setup
    with pytest.raises(ValueError, match="branch name"):
        workspace.prepare_workspace(workspace.WorkspaceRequest(profile="default", project_id=project_id, mode="worktree", branch="../../escape"))
    assert not (repo / ".worktrees").exists()
    result = workspace.prepare_workspace(workspace.WorkspaceRequest(profile="default", project_id=project_id, mode="worktree", branch="feat/qa-flow"))
    target = Path(result["cwd"])
    assert target.is_dir() and target.parent == repo / ".worktrees"
    assert subprocess.check_output(["git", "branch", "--show-current"], cwd=target, text=True).strip() == "feat/qa-flow"
    assert result["branch"] == "feat/qa-flow"


def test_branch_check_uses_git_ref_format(setup):
    app = FastAPI()
    app.include_router(workspace.router)
    client = TestClient(app)
    assert client.post("/api/mobile/branch-check", json={"branch": "feat/good-name"}).json() == {"valid": True}
    for invalid in ("../../bad", "feat//bad", "feat/bad/", "feat/heads.lock", "bad name"):
        response = client.post("/api/mobile/branch-check", json={"branch": invalid})
        assert response.status_code == 400, invalid
    assert client.post("/api/mobile/branch-check", json={"branch": "feat/good-name", "path": "/etc"}).status_code == 422


def test_branch_check_rejects_invalid_git_refs(setup):
    app = FastAPI()
    app.include_router(workspace.router)
    client = TestClient(app)
    assert client.post("/api/mobile/branch-check", json={"branch": "feat/qa-flow"}).json() == {"valid": True}
    for branch in ("../../escape", "feat//escape", "feat/escape/", "feat/.hidden"):
        response = client.post("/api/mobile/branch-check", json={"branch": branch})
        assert response.status_code == 400, branch
    assert client.post("/api/mobile/branch-check", json={"branch": "feat/qa-flow", "path": "/tmp"}).status_code == 422


def test_client_paths_are_not_accepted_and_foreign_project_is_rejected(setup):
    _, _, project_id = setup
    app = FastAPI()
    app.include_router(workspace.router)
    client = TestClient(app)
    assert client.post("/api/mobile/workspace", json={"profile": "default", "project_id": project_id, "mode": "local", "path": "/tmp/attacker"}).status_code == 422
    response = client.post("/api/mobile/workspace", json={"profile": "default", "project_id": "../example", "mode": "local"})
    assert response.status_code == 400
    assert response.json()["detail"].startswith("Project unavailable")


def test_non_git_project_does_not_get_initialized(setup, tmp_path):
    home, _, _ = setup
    folder = tmp_path / "plain"
    folder.mkdir()
    with projects_db.connect_closing(db_path=home / "projects.db") as db:
        project_id = projects_db.create_project(db, name="Plain", primary_path=str(folder))
    with pytest.raises(ValueError, match="existing Git repository"):
        workspace.prepare_workspace(workspace.WorkspaceRequest(profile="default", project_id=project_id, mode="worktree", branch="feat/plain"))
    assert not (folder / ".git").exists()


def test_remote_ids_are_resolved_on_the_terminal_host(setup, monkeypatch, tmp_path):
    import json
    import os
    import sys
    from hermes_cli.web_mobile_workspace_remote import REMOTE_WORKSPACES

    _, local_repo, local_id = setup
    remote_home = tmp_path / "remote"
    remote_repo = remote_home / "work" / "example"
    remote_repo.mkdir(parents=True)
    _git(remote_repo, "init", "-b", "main")
    _git(remote_repo, "-c", "user.email=qa@example.test", "-c", "user.name=QA", "commit", "--allow-empty", "-m", "init")

    def on_host(config, action, **values):
        result = subprocess.run([sys.executable, "-c", REMOTE_WORKSPACES],
            input=json.dumps({"action": action, "cwd": "~/work/example", **values}),
            text=True, capture_output=True, env={**os.environ, "HOME": str(remote_home)})
        payload = json.loads(result.stdout)
        if result.returncode:
            raise ValueError(payload["error"])
        return payload

    monkeypatch.setattr(workspace, "terminal_config", lambda profile: {"backend": "ssh"})
    monkeypatch.setattr(workspace, "remote_workspaces", on_host)
    choices = workspace.list_workspaces("default")["projects"]
    chosen = next(p for p in choices if p["path"] == str(remote_repo))
    assert chosen["git"] and all(p["path"] != str(local_repo) for p in choices)
    with pytest.raises(ValueError, match="Project unavailable"):
        workspace.prepare_workspace(workspace.WorkspaceRequest(profile="default", project_id=local_id, mode="local"))
    assert workspace.prepare_workspace(workspace.WorkspaceRequest(profile="default", project_id=chosen["id"], mode="local"))["cwd"] == str(remote_repo)
    prepared = workspace.prepare_workspace(workspace.WorkspaceRequest(profile="default", project_id=chosen["id"], mode="worktree", branch="feat/remote"))
    target = remote_home / "work/example-worktrees/feat-remote"
    assert prepared["cwd"] == str(target) and target.is_dir()
    assert subprocess.check_output(["git", "branch", "--show-current"], cwd=target, text=True).strip() == "feat/remote"
    assert not (local_repo / ".worktrees").exists()


def test_local_picker_includes_the_desktop_discovery_tree(setup, tmp_path, monkeypatch):
    from hermes_state import SessionDB

    home, _, _ = setup
    other_home = tmp_path / "other-home"
    other_home.mkdir()
    monkeypatch.setattr(workspace, "_resolve_profile_dir", lambda profile: other_home if profile == "other" else home)
    repo = tmp_path / "from-session"
    repo.mkdir()
    _git(repo, "init", "-b", "main")
    _git(repo, "-c", "user.email=qa@example.test", "-c", "user.name=QA", "commit", "--allow-empty", "-m", "init")
    with SessionDB(home / "state.db") as db:
        db.create_session("old-chat", "mobile", cwd=str(repo))
        db.append_message("old-chat", "user", "Work here")
    choices = workspace.list_workspaces("default")["projects"]
    assert workspace.list_workspaces("other")["projects"] == []
    assert workspace.list_workspaces("default")["projects"] == choices
    chosen = next(p for p in choices if p["path"] == str(repo))
    assert chosen["git"]
    assert workspace.prepare_workspace(workspace.WorkspaceRequest(profile="default", project_id=chosen["id"], mode="local"))["cwd"] == str(repo)
