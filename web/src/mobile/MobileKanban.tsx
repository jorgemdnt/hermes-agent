import { LayoutGrid, RefreshCw, X } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { fetchJSON } from "@/lib/api";
import { Button, Dialog, Skeleton, Textarea } from "./ui";

const BASE = "/api/plugins/kanban";
interface Task { id: string; title: string; status: string; assignee?: string | null; body?: string | null; latest_summary?: string | null }
interface Board { columns: Array<{ name: string; tasks: Task[] }> }
interface TaskDetail { task: Task; comments: Array<{ id: string | number; author: string; body: string }> }
interface BoardChoice { slug: string; name?: string }

export default function MobileKanban() {
  const [boards, setBoards] = useState<BoardChoice[]>([]);
  const [boardName, setBoardName] = useState("");
  const [board, setBoard] = useState<Board | null>(null);
  const [task, setTask] = useState<TaskDetail | null>(null);
  const [comment, setComment] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [revision, refresh] = useState(0);

  useEffect(() => {
    let alive = true;
    void fetchJSON<{ boards: BoardChoice[]; current: string }>(`${BASE}/boards`).then(data => {
      if (!alive) return;
      setBoards(data.boards);
      setBoardName(current => current || data.current);
    }).catch(e => { if (alive) setError(String(e)); });
    return () => { alive = false; };
  }, []);
  useEffect(() => {
    if (!boardName) return;
    let alive = true;
    void fetchJSON<Board>(`${BASE}/board?board=${encodeURIComponent(boardName)}`).then(data => { if (alive) setBoard(data); }).catch(e => { if (alive) setError(String(e)); });
    return () => { alive = false; };
  }, [boardName, revision]);
  useEffect(() => {
    if (!task?.task.id) return;
    const taskId = task.task.id;
    let alive = true;
    void fetchJSON<TaskDetail>(`${BASE}/tasks/${encodeURIComponent(taskId)}?board=${encodeURIComponent(boardName)}`).then(data => { if (alive) setTask(data); }).catch(e => { if (alive) setError(String(e)); });
    return () => { alive = false; };
  }, [boardName, revision, task?.task.id]);

  async function saveComment(event: FormEvent) {
    event.preventDefault();
    if (!task || !comment.trim() || saving) return;
    setSaving(true); setError("");
    try {
      await fetchJSON(`${BASE}/tasks/${encodeURIComponent(task.task.id)}/comments?board=${encodeURIComponent(boardName)}`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ body: comment.trim(), author: "phone" }),
      });
      setComment(""); refresh(n => n + 1);
    } catch (e) { setError(String(e)); }
    finally { setSaving(false); }
  }

  return <section className="m-board" aria-label="Kanban board">
    <header><Button variant="outline" type="button" onClick={() => refresh(n => n + 1)}><RefreshCw size={15} aria-hidden="true" /> Refresh</Button></header>
    {boards.length > 1 && <label>Board<select value={boardName} onChange={e => { setTask(null); setBoard(null); setBoardName(e.target.value); }}>{boards.map(b => <option key={b.slug} value={b.slug}>{b.name || b.slug}</option>)}</select></label>}
    {error && <p role="alert">{error}</p>}
    {!board && !error && <div className="m-loading" role="status" aria-label="Loading board"><Skeleton /><Skeleton /><Skeleton /></div>}
    {board && !board.columns.some(column => column.tasks.length) && <div className="m-board-empty"><LayoutGrid size={28} strokeWidth={1.5} aria-hidden="true" /><strong>No cards yet</strong><p>New work will appear here.</p></div>}
    {board?.columns.filter(column => column.tasks.length > 0).map(column => <section key={column.name} className="m-column"><h3>{column.name} <small>{column.tasks.length}</small></h3>
      {column.tasks.map(item => <button type="button" key={item.id} className="m-task" onClick={() => {
        setTask(null); setError("");
        void fetchJSON<TaskDetail>(`${BASE}/tasks/${encodeURIComponent(item.id)}?board=${encodeURIComponent(boardName)}`).then(setTask).catch(e => setError(String(e)));
      }}><strong>{item.title}</strong><small>{item.id} · {item.status}{item.assignee ? ` · ${item.assignee}` : ""}</small></button>)}
    </section>)}
    {task && <Dialog open onClose={() => setTask(null)} label={task.task.title}>
      <Button variant="ghost" size="icon" type="button" className="m-close" onClick={() => setTask(null)} aria-label="Close task"><X size={19} /></Button>
      <h2>{task.task.title}</h2><p>{task.task.id} · {task.task.status}</p><p className="m-preserve">{task.task.body}</p>
      <h3>Comments</h3>{task.comments.map((item, index) => <article key={`${item.id}-${index}`} className="m-comment"><strong>{item.author}</strong><p className="m-preserve">{item.body}</p></article>)}
      <form onSubmit={e => void saveComment(e)}><label>Add comment<Textarea value={comment} onChange={e => setComment(e.target.value)} required /></label><Button variant="primary" type="submit" disabled={saving}>{saving ? "Posting…" : "Post comment"}</Button></form>
    </Dialog>}
  </section>;
}
