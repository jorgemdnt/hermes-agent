"""Card history is a reader, not a second owner of the worker session."""
import importlib.util
import json
from pathlib import Path
import sys
import time

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from hermes_cli import kanban_db as kb
from hermes_cli.kanban_db_connect import connect
from hermes_state import SessionDB


@pytest.fixture
def fixture(tmp_path, monkeypatch):
    home = tmp_path / '.hermes'
    home.mkdir()
    monkeypatch.setenv('HERMES_HOME', str(home))
    monkeypatch.setenv('HERMES_KANBAN_DB', str(home / 'kanban.db'))
    monkeypatch.setattr(Path, 'home', lambda: tmp_path)
    kb.init_db()
    path = Path(__file__).resolve().parents[2] / 'plugins/kanban/dashboard/plugin_api.py'
    spec = importlib.util.spec_from_file_location('kanban_transcript_test_plugin', path)
    assert spec is not None and spec.loader is not None
    plugin = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = plugin
    spec.loader.exec_module(plugin)
    app = FastAPI()
    app.include_router(plugin.router, prefix='/kb')
    with connect() as conn:
        task = kb.create_task(conn, title='Worker transcript', assignee='default')
        other = kb.create_task(conn, title='Other worker', assignee='atlas')
        for rid, tid, profile, sid in [(1, task, 'default', 'worker'), (2, task, 'atlas', 'second'), (3, other, 'atlas', 'foreign')]:
            conn.execute("INSERT INTO task_runs (id,task_id,profile,status,started_at,session_id) VALUES (?,?,?,'running',?,?)", (rid,tid,profile,int(time.time())-5,sid))
    for profile, sid in [('default', 'worker'), ('atlas', 'second'), ('atlas', 'foreign')]:
        target = home if profile == 'default' else home / 'profiles' / profile
        target.mkdir(parents=True, exist_ok=True)
        with SessionDB(target / 'state.db') as db:
            db.create_session(sid, 'kanban')
            db.append_message(sid, 'user', 'Request for ' + sid)
    return home, task, other, TestClient(app)


def test_snapshot_is_read_only_and_profile_exact(fixture):
    home, task, _, client = fixture
    with SessionDB(home / 'state.db') as db:
        db.append_message('worker', 'assistant', 'Visible commentary', reasoning_content='Thinking about the request')
        db.append_message('worker', 'assistant', '', tool_calls=[{'id':'call','type':'function','function':{'name':'terminal','arguments':json.dumps({'command':'pwd'})}}])
        db.append_message('worker', 'tool', 'result omitted by shared projection', tool_call_id='call', tool_name='terminal')
        before = db.get_session('worker')
        lease_before = db._conn.execute('SELECT * FROM session_turn_leases').fetchall()
    response = client.get(f'/kb/tasks/{task}/transcript?run_id=1').json()
    assert response['session_id'] == 'worker'
    assert response['running']
    assert any(m.get('reasoning_content') == 'Thinking about the request' for m in response['messages'])
    assert any(m.get('name') == 'terminal' and m.get('args') == {'command':'pwd'} for m in response['messages'])
    with SessionDB(home / 'state.db', read_only=True) as db:
        assert db.get_session('worker') == before
        assert db._conn.execute('SELECT * FROM session_turn_leases').fetchall() == lease_before
    latest = client.get(f'/kb/tasks/{task}/transcript').json()
    assert latest['run_id'] == 2
    assert latest['profile'] == 'atlas'
    assert latest['messages'][0]['text'] == 'Request for second'
    assert client.get(f'/kb/tasks/{task}/transcript?run_id=3').status_code == 404


def test_running_snapshot_advances_and_finished_history_pages(fixture):
    home, task, _, client = fixture
    with SessionDB(home / 'state.db') as db:
        for i in range(105):
            db.append_message('worker', 'assistant', f'Step {i}')
    url = f'/kb/tasks/{task}/transcript?run_id=1&limit=100'
    first = client.get(url).json()
    assert first['has_more'] and first['returned'] == 100
    assert first['messages'][-1]['text'] == 'Step 104'
    older = client.get(url + '&offset=100').json()
    assert not older['has_more'] and older['returned'] == 6
    assert older['messages'][0]['text'] == 'Request for worker'
    with SessionDB(home / 'state.db') as db:
        db.append_message('worker', 'assistant', 'New live step')
    assert client.get(url).json()['messages'][-1]['text'] == 'New live step'
    with connect() as conn:
        conn.execute("UPDATE task_runs SET status='done',ended_at=? WHERE id=1", (int(time.time()),))
    assert not client.get(url).json()['running']


def test_compression_continuation_and_hidden_rows(fixture):
    home, task, _, client = fixture
    with SessionDB(home / 'state.db') as db:
        db.end_session('worker', 'compression')
        db.create_session('tip', 'kanban', parent_session_id='worker')
        db.append_message('tip', 'assistant', 'New continuation')
        db.append_message('tip', 'user', 'Internal scaffold', display_kind='hidden')
    result = client.get(f'/kb/tasks/{task}/transcript?run_id=1').json()
    assert [m['text'] for m in result['messages'] if m.get('text')] == ['Request for worker', 'New continuation']


def test_remote_fallback_and_no_store_creation(fixture):
    home, task, _, client = fixture
    target = home / 'profiles' / 'samwise'
    target.mkdir()
    (target / 'config.yaml').write_text('terminal:\n  backend: ssh\n')
    with connect() as conn:
        conn.execute("UPDATE task_runs SET profile='samwise',session_id='remote-session' WHERE id=2")
    result = client.get(f'/kb/tasks/{task}/transcript').json()
    assert result['location'] == 'vps'
    assert result['unavailable'] == 'Transcript on VPS'
    assert result['session_id'] == 'remote-session'
    assert not (target / 'state.db').exists()
    assert client.get(f'/kb/tasks/{task}/transcript?limit=999').status_code == 422
