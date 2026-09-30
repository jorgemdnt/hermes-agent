import { LayoutGrid } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router";
import { fetchJSON } from "@/lib/api";
import { Skeleton } from "./ui";

interface BoardChoice { slug: string; name?: string }
interface BoardChoices { boards: BoardChoice[]; current: string }

export function BoardSidebar({ selected }: { selected?: string }) {
  const [choices, setChoices] = useState<BoardChoices | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let alive = true;
    void fetchJSON<BoardChoices>("/api/plugins/kanban/boards").then(data => {
      if (alive) setChoices(data);
    }).catch(error => { if (alive) setError(String(error)); });
    return () => { alive = false; };
  }, []);

  return <nav className="m-board-list" aria-label="Boards">
    {error && <p className="m-error" role="alert">{error}</p>}
    {!choices && !error && <div className="m-loading" role="status" aria-label="Loading boards"><Skeleton /></div>}
    {choices?.boards.map(board => <Link key={board.slug} to={`/m/board?board=${encodeURIComponent(board.slug)}`}
      aria-current={board.slug === (selected || choices.current) ? "page" : undefined}>
      <LayoutGrid size={18} aria-hidden="true" /><span>{board.name || board.slug}</span>
    </Link>)}
    {choices && !choices.boards.length && <p className="m-muted">No boards yet.</p>}
  </nav>;
}
