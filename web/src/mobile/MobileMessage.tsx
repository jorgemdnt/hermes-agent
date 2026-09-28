import { useEffect, useRef, type TouchEvent } from "react";
import { Copy, Image as ImageIcon } from "lucide-react";
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
  const grouped = previous?.role === row.role;
  const imageCount = row.role === "user" ? (row.text.match(/^@image:[^\n]+$/gm) || []).length : 0;
  const displayText = imageCount ? row.text.replace(/^@image:[^\n]+\n?/gm, "").trim() : row.text;
  const cancelPress = () => { if (press.current) clearTimeout(press.current); press.current = null; };
  useEffect(() => cancelPress, []);
  const startPress = (event: TouchEvent) => {
    if ((event.target as Element).closest("a, button")) return;
    cancelPress();
    origin.current = { x: event.touches[0].clientX, y: event.touches[0].clientY };
    press.current = setTimeout(() => { press.current = null; onAction(displayText || "Photo"); }, 550);
  };
  const movePress = (event: TouchEvent) => {
    if (Math.hypot(event.touches[0].clientX - origin.current.x, event.touches[0].clientY - origin.current.y) > 10) cancelPress();
  };
  return <article className={`m-message m-${row.role}${grouped ? " m-grouped" : ""}`}
    onTouchStart={startPress} onTouchMove={movePress} onTouchEnd={cancelPress} onTouchCancel={cancelPress}
    onContextMenu={event => { if (!(event.target as Element).closest("a, button")) { event.preventDefault(); onAction(displayText || "Photo"); } }}>
    {row.role === "assistant" ? <Markdown content={row.text} /> : <>{displayText && <div className="m-preserve">{displayText}</div>}{!!imageCount && <span className="m-image-ref"><ImageIcon size={16} aria-hidden="true" />{imageCount === 1 ? "Photo" : `${imageCount} photos`}</span>}</>}
    {row.timestamp && (!grouped || !previous?.timestamp || row.timestamp - previous.timestamp > 300) && <time dateTime={new Date(row.timestamp * 1000).toISOString()} className="m-message-time">{new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(row.timestamp * 1000)}</time>}
    <button type="button" className="m-copy-trigger" aria-label="Copy message" onClick={() => onAction(displayText || "Photo")}><Copy size={15} aria-hidden="true" /></button>
  </article>;
}
