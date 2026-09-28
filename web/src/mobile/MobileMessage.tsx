import { useEffect, useRef, type TouchEvent } from "react";
import { Bot, Copy, ExternalLink, Image as ImageIcon, Info, ThumbsUp } from "lucide-react";
import { classifyUserText } from "./message-kind";
import { Markdown } from "@/components/Markdown";
import type { ChatRow } from "./mobile-state";

interface MobileMessageProps {
  row: ChatRow;
  previous?: ChatRow;
  onAction: (text: string) => void;
  reacted?: boolean;
  onReact?: () => void;
  avatarFor?: (handle: string) => string | undefined;
}

export default function MobileMessage({ row, previous, onAction, onReact, reacted, avatarFor }: MobileMessageProps) {
  const link = row.role === "assistant" ? /https?:\/\/[^\s<>)\]]+/i.exec(row.text)?.[0] : undefined;
  const linkedTitle = /\[([^\]]+)\]\((https?:\/\/[^)]+)\)/.exec(row.text);
  let preview: URL | null = null;
  try { if (link) preview = new URL(link); } catch { /* Invalid links stay plain text. */ }
  const kind = row.role === "user" ? classifyUserText(row.text) : null;
  const press = useRef<ReturnType<typeof setTimeout> | null>(null);
  const origin = useRef({ x: 0, y: 0 });
  const grouped = previous?.role === row.role && !(kind && kind.kind !== "human") && !(previous?.role === "user" && classifyUserText(previous.text).kind !== "human");
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
  if (kind && kind.kind !== "human") {
    const avatar = kind.kind === "agent" ? avatarFor?.(kind.handle) : undefined;
    const title = kind.kind === "agent" ? `Message from ${kind.sender}` : kind.label;
    const body = kind.body;
    return <article className="m-message m-notice">
      <div className="m-notice-head">
        {kind.kind === "agent"
          ? (avatar ? <img src={avatar} alt="" aria-hidden="true" /> : <Bot size={14} aria-hidden="true" />)
          : <Info size={14} aria-hidden="true" />}
        <span>{title}</span>
      </div>
      {body && <details className="m-notice-body">
        <summary>Show message</summary>
        <div className="m-notice-card"><Markdown content={body} /></div>
      </details>}
    </article>;
  }
  return <article className={`m-message m-${row.role}${grouped ? " m-grouped" : ""}`}
    onTouchStart={startPress} onTouchMove={movePress} onTouchEnd={cancelPress} onTouchCancel={cancelPress}
    onContextMenu={event => { if (!(event.target as Element).closest("a, button")) { event.preventDefault(); onAction(displayText || "Photo"); } }}>
    {row.role === "assistant" ? <Markdown content={row.text} /> : <>{displayText && <div className="m-preserve">{displayText}</div>}{!!imageCount && <span className="m-image-ref"><ImageIcon size={16} aria-hidden="true" />{imageCount === 1 ? "Photo" : `${imageCount} photos`}</span>}</>}
    {preview && <a className="m-link-preview" href={preview.href} target="_blank" rel="noreferrer" aria-label={`Open ${preview.hostname}`}>
      <span className="m-link-domain">{preview.hostname}<ExternalLink size={14} aria-hidden="true" /></span>
      <strong>{linkedTitle?.[2] === preview.href ? linkedTitle[1] : preview.pathname.split("/").filter(Boolean).at(-1) || preview.hostname}</strong>
    </a>}
    {onReact && <button type="button" className="m-reaction" aria-label={reacted ? "Remove thumbs up" : "React thumbs up"} aria-pressed={!!reacted} onClick={onReact}><ThumbsUp size={14} aria-hidden="true" />{reacted ? "1" : ""}</button>}
    {row.timestamp && (!grouped || !previous?.timestamp || row.timestamp - previous.timestamp > 300) && <time dateTime={new Date(row.timestamp * 1000).toISOString()} className="m-message-time">{new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(row.timestamp * 1000)}</time>}
    <button type="button" className="m-copy-trigger" aria-label="Copy message" onClick={() => onAction(displayText || "Photo")}><Copy size={15} aria-hidden="true" /></button>
  </article>;
}
