import { useEffect, useRef, type TouchEvent } from "react";
import { Copy } from "lucide-react";
import { Markdown } from "@/components/Markdown";
import type { ChatRow } from "./mobile-state";

interface MobileMessageProps {
  row: ChatRow;
  previous?: ChatRow;
  onAction: (text: string) => void;
}

export default function MobileMessage({ row, previous, onAction }: MobileMessageProps) {
  const press = useRef<ReturnType<typeof setTimeout> | null>(null);
  const origin = useRef({ x: 0, y: 0 });
  const cancelPress = () => { if (press.current) clearTimeout(press.current); press.current = null; };
  useEffect(() => cancelPress, []);
  const startPress = (event: TouchEvent) => {
    if ((event.target as Element).closest("a, button")) return;
    cancelPress();
    origin.current = { x: event.touches[0].clientX, y: event.touches[0].clientY };
    press.current = setTimeout(() => { press.current = null; onAction(row.text); }, 550);
  };
  const movePress = (event: TouchEvent) => {
    if (Math.hypot(event.touches[0].clientX - origin.current.x, event.touches[0].clientY - origin.current.y) > 10) cancelPress();
  };
  const grouped = previous?.role === row.role;
  return <article className={`m-message m-${row.role}${grouped ? " m-grouped" : ""}`}
    onTouchStart={startPress} onTouchMove={movePress} onTouchEnd={cancelPress} onTouchCancel={cancelPress}
    onContextMenu={event => { if (!(event.target as Element).closest("a, button")) { event.preventDefault(); onAction(row.text); } }}>
    {row.role === "assistant" ? <Markdown content={row.text} /> : <div className="m-preserve">{row.text}</div>}
    {row.timestamp && (!grouped || !previous?.timestamp || row.timestamp - previous.timestamp > 300) && <time dateTime={new Date(row.timestamp * 1000).toISOString()} className="m-message-time">{new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(row.timestamp * 1000)}</time>}
    <button type="button" className="m-copy-trigger" aria-label="Copy message" onClick={() => onAction(row.text)}><Copy size={15} aria-hidden="true" /></button>
  </article>;
}
