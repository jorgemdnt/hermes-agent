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
    assert result == {"projects": [{"id": project_id, "label": "Example", "path": str(repo)}], "supported": True}
    prepared = workspace.prepare_workspace(workspace.WorkspaceRequest(profile="default", project_id=project_id, mode="local"))
    assert prepared == {"cwd": str(repo), "branch": None}


def test_project_without_folder_is_not_offered(setup):
    home, repo, project_id = setup
    with projects_db.connect_closing(db_path=home / "projects.db") as db:
        projects_db.create_project(db, name="No folder")
    assert workspace.list_workspaces("default")["projects"] == [{"id": project_id, "label": "Example", "path": str(repo)}]


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


def test_remote_bot_is_explicitly_unsupported(setup, monkeypatch):
    _, _, project_id = setup
    monkeypatch.setattr(workspace, "terminal_config", lambda profile: {"backend": "ssh"})
    assert workspace.list_workspaces("default")["supported"] is False
    with pytest.raises(ValueError, match="Remote bot"):
        workspace.prepare_workspace(workspace.WorkspaceRequest(profile="default", project_id=project_id, mode="worktree", branch="feat/qa"))
