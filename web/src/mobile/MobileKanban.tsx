import { LayoutGrid, RefreshCw } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { fetchJSON } from "@/lib/api";
import { Markdown } from "@/components/Markdown";
import { Skeleton } from "./ui";

const BASE = "/api/plugins/kanban";
const STATUSES = ["triage", "todo", "ready", "running", "blocked", "review", "done"];
interface Task { id: string; title: string; status: string; assignee?: string | null; body?: string | null; result?: string | null; latest_summary?: string | null; model_override?: string | null; created_at: number; started_at?: number | null; age?: { created_age_seconds?: number | null } }
interface Board { columns: Array<{ name: string; tasks: Task[] }>; now: number }
interface TaskDetail { task: Task; comments: Array<{ id: string | number; author: string; body: string }>; runs: Array<{ id: number; status: string; outcome?: string | null; summary?: string | null; model?: string | null }> }
interface BoardChoice { slug: string; name?: string }
const ageLabel = (seconds: number) => seconds < 3600 ? `${Math.max(1, Math.floor(seconds / 60))}m` : seconds < 86400 ? `${Math.floor(seconds / 3600)}h` : `${Math.floor(seconds / 86400)}d`;

export default function MobileKanban({ taskId, boardSlug, onSelectTask, getSavedScroll, onScroll, showBoardPicker = true, avatars = {} }: { taskId?: string; boardSlug?: string; onSelectTask: (id: string, board: string) => void; getSavedScroll: () => number; onScroll: (top: number) => void; showBoardPicker?: boolean; avatars?: Record<string, string> }) {
  const boardScroll = useRef<HTMLElement>(null);
  const [boards, setBoards] = useState<BoardChoice[]>([]);
  const [boardName, setBoardName] = useState(boardSlug || "");
  useEffect(() => { if (boardSlug) setBoardName(boardSlug); }, [boardSlug]);
  const [board, setBoard] = useState<Board | null>(null);
  const [task, setTask] = useState<TaskDetail | null>(null);
  const [error, setError] = useState("");
  const [revision, refresh] = useState(0);

  useEffect(() => {
    let alive = true;
    void fetchJSON<{ boards: BoardChoice[]; current: string }>(`${BASE}/boards`).then(data => {
      if (!alive) return;
      setBoards(data.boards); setBoardName(current => current || data.current);
    }).catch(e => { if (alive) setError(String(e)); });
    return () => { alive = false; };
  }, []);
  useEffect(() => {
    if (!boardName) return;
    let alive = true;
    const load = () => {
      if (document.visibilityState === "hidden") return;
      void fetchJSON<Board>(`${BASE}/board?board=${encodeURIComponent(boardName)}`).then(data => { if (alive) { setBoard(data); setError(""); } }).catch(e => { if (alive) setError(String(e)); });
    };
    load();
    const timer = window.setInterval(load, 15000);
    document.addEventListener("visibilitychange", load);
    return () => { alive = false; clearInterval(timer); document.removeEventListener("visibilitychange", load); };
  }, [boardName, revision]);
  useEffect(() => {
    if (!taskId || !boardName) return;
    let alive = true;
    setTask(null);
    void fetchJSON<TaskDetail>(`${BASE}/tasks/${encodeURIComponent(taskId)}?board=${encodeURIComponent(boardName)}`).then(data => { if (alive) { setTask(data); setError(""); } }).catch(e => { if (alive) setError(String(e)); });
    return () => { alive = false; };
  }, [boardName, revision, taskId]);
  useLayoutEffect(() => {
    if (!boardScroll.current) return;
    boardScroll.current.scrollTop = taskId ? 0 : getSavedScroll();
  }, [taskId, board, getSavedScroll]);

  return <section className="m-board" aria-label="Kanban board" ref={boardScroll} onScroll={e => { if (!taskId) onScroll(e.currentTarget.scrollTop); }}>
    {!taskId ? <>
      <header><button type="button" aria-label="Refresh board" onClick={() => refresh(n => n + 1)}><RefreshCw size={16} aria-hidden="true" /></button></header>
      {showBoardPicker && boards.length > 1 && <label>Board<select value={boardName} onChange={e => { setTask(null); setBoard(null); setBoardName(e.target.value); }}>{boards.map(b => <option key={b.slug} value={b.slug}>{b.name || b.slug}</option>)}</select></label>}
      {error && <p role="alert">{error}</p>}
      {!board && !error && <div className="m-loading" role="status" aria-label="Loading board"><Skeleton /><Skeleton /><Skeleton /></div>}
      {board && !board.columns.some(column => column.tasks.length) && <div className="m-board-empty"><LayoutGrid size={28} strokeWidth={1.5} aria-hidden="true" /><strong>No cards yet</strong></div>}
      {board && <div className="m-board-columns">{STATUSES.flatMap(status => status === "ready" && board.columns.some(column => column.name === "scheduled" && column.tasks.length) ? ["scheduled", status] : [status]).map(status => {
        const column = board.columns.find(c => c.name === status);
        return <section key={status} className="m-column"><h3>{status} <small>{column?.tasks.length || 0}</small></h3>
          {column?.tasks.map(item => <button type="button" key={item.id} className="m-task" onClick={() => { onScroll(boardScroll.current?.scrollTop || 0); setTask(null); setError(""); onSelectTask(item.id, boardName); }}>
            <strong>{item.title}</strong><span className="m-task-id">{item.id}</span>
            <span className="m-task-meta">{item.assignee && <span className="m-task-owner">{avatars[item.assignee] ? <img src={avatars[item.assignee]} alt="" width={20} height={20} /> : <span aria-hidden="true">{item.assignee.slice(0, 1).toUpperCase()}</span>}{item.assignee}</span>}
              {item.model_override && <span title={item.model_override} className="m-task-model">{item.model_override}</span>}
              <time dateTime={new Date(item.created_at * 1000).toISOString()} title={new Date(item.created_at * 1000).toLocaleString()}>{ageLabel(item.age?.created_age_seconds ?? Math.max(0, board.now - item.created_at))}</time>
              {status === "running" && <span className="m-task-live"><i className="m-status-dot" aria-hidden="true" />Running</span>}</span>
          </button>)}
        </section>;
      })}</div>}
    </> : <div className="m-task-detail">
      {error && <p role="alert">{error}</p>}
      {!task && !error && <div className="m-loading" role="status" aria-label="Loading task"><Skeleton /><Skeleton /></div>}
      {task && <>
        <h2>{task.task.title}</h2><p className="m-muted">{task.task.id} · {task.task.status} · {task.task.assignee || "Unassigned"}{task.task.model_override ? ` · ${task.task.model_override}` : ""}</p>
        {task.task.body && <section aria-label="Description" className="m-preserve"><Markdown content={task.task.body} /></section>}
        {(task.task.latest_summary || task.task.result) && <section><h3>Result</h3><Markdown content={task.task.latest_summary || task.task.result || ""} /></section>}
        <section><h3>Runs</h3>{task.runs.length ? task.runs.map(run => <article className="m-comment" key={run.id}><strong>Run {run.id} · {run.outcome || run.status}</strong>{run.summary && <p className="m-preserve">{run.summary}</p>}</article>) : <p className="m-muted">No runs yet.</p>}</section>
        <section><h3>Comments</h3>{task.comments.length ? task.comments.map(item => <article key={item.id} className="m-comment"><strong>{item.author}</strong><p className="m-preserve">{item.body}</p></article>) : <p className="m-muted">No comments yet.</p>}</section>
      </>}
    </div>}
  </section>;
}
