import { useEffect, useRef, useState, type TouchEvent } from "react";
import { ExternalLink, MoreHorizontal, ThumbsUp } from "lucide-react";
import { classifyUserText } from "./message-kind";
import { MessageFile, MessageImage } from "./MessageAttachment";
import { Markdown } from "@/components/Markdown";
import type { ChatRow } from "./mobile-state";

interface MobileMessageProps {
  profile: string;
  row: ChatRow;
  previous?: ChatRow;
  onAction: (text: string) => void;
  reacted?: boolean;
  onReact?: () => void;
  onFileLink?: (path: string) => void;
  avatarFor?: (handle: string) => string | undefined;
}

export default function MobileMessage({ profile, row, previous, onAction, onReact, onFileLink, reacted, avatarFor }: MobileMessageProps) {
  const link = row.role === "assistant" ? /https?:\/\/[^\s<>)\]]+/i.exec(row.text)?.[0] : undefined;
  const linkedTitle = /\[([^\]]+)\]\((https?:\/\/[^)]+)\)/.exec(row.text);
  let preview: URL | null = null;
  try { if (link) preview = new URL(link); } catch { /* Invalid links stay plain text. */ }
  const kind = row.role === "user" ? classifyUserText(row.text) : null;
  const [timestampVisible, setTimestampVisible] = useState(false);
  const press = useRef<ReturnType<typeof setTimeout> | null>(null);
  const origin = useRef({ x: 0, y: 0 });
  const grouped = previous?.role === row.role && !(kind && kind.kind !== "human") && !(previous?.role === "user" && classifyUserText(previous.text).kind !== "human");
  const visibleUserText = row.role === "user" ? row.text.split(/\n\n--- (?:Attached Context|Context Warnings) ---\n/)[0] : row.text;
  const imageNames = row.role === "user" ? [...row.text.matchAll(/^@image:([^\n]+)$/gm)].map(match => match[1].split("/").at(-1) || "Photo") : [];
  const fileNames = row.role === "user" ? [...visibleUserText.matchAll(/^@file:([^\n]+)$/gm)].map(match => match[1].split("/").at(-1) || "File") : [];
  const attachmentUrl = (kind: "image" | "file", name: string) => `/api/chat/attachment/${encodeURIComponent(profile)}/${kind}/${encodeURIComponent(name)}`;
  const displayText = row.role === "user" ? visibleUserText.replace(/^@(?:image|file):[^\n]+\n?/gm, "").trim() : row.text;
  const cancelPress = () => { if (press.current) clearTimeout(press.current); press.current = null; };
  useEffect(() => cancelPress, []);
  const startPress = (event: TouchEvent) => {
    if ((event.target as Element).closest("a, button")) return;
    cancelPress();
    origin.current = { x: event.touches[0].clientX, y: event.touches[0].clientY };
    press.current = setTimeout(() => { press.current = null; setTimestampVisible(true); onAction(displayText || "Photo"); }, 550);
  };
  const movePress = (event: TouchEvent) => {
    if (Math.hypot(event.touches[0].clientX - origin.current.x, event.touches[0].clientY - origin.current.y) > 10) cancelPress();
  };
  const endPress = () => {
    if (press.current) setTimestampVisible(visible => !visible);
    cancelPress();
  };
  if (kind && kind.kind !== "human") {
    const avatar = kind.kind === "agent" ? avatarFor?.(kind.handle) : undefined;
    const title = kind.kind === "agent" ? `Message from ${kind.sender}` : kind.label;
    const body = kind.body;
    return <article className="m-message m-notice">
      {body ? <details className="m-notice-body">
        <summary><span className="m-notice-head">{kind.kind === "agent" && avatar && <img src={avatar} alt="" aria-hidden="true" />}<span>{title}</span></span><span className="m-notice-more">Show message</span></summary>
        <div className="m-notice-card"><Markdown content={body} onFileLink={onFileLink} /></div>
      </details> : <span className="m-notice-head">{kind.kind === "agent" && avatar && <img src={avatar} alt="" aria-hidden="true" />}<span>{title}</span></span>}
    </article>;
  }
  return <article className={`m-message m-${row.role}${grouped ? " m-grouped" : ""}`}
    data-timestamp-visible={timestampVisible || undefined}
    onTouchStart={startPress} onTouchMove={movePress} onTouchEnd={endPress} onTouchCancel={cancelPress}
    onContextMenu={event => { if (!(event.target as Element).closest("a, button")) { event.preventDefault(); onAction(displayText || "Photo"); } }}>
    <div className="m-message-body">
    <div className="m-bubble">
      {row.role === "assistant" ? <Markdown content={row.text} onFileLink={onFileLink} /> : <>{displayText && <div className="m-preserve">{displayText}</div>}{imageNames.map((image, index) => <MessageImage key={`${index}-${image}`} src={attachmentUrl("image", image)} name={image} />)}{fileNames.map((file, index) => <MessageFile key={`${index}-${file}`} src={attachmentUrl("file", file)} name={file} />)}</>}
      {preview && <a className="m-link-preview" href={preview.href} target="_blank" rel="noreferrer" aria-label={`Open ${preview.hostname}`}>
        <span className="m-link-domain">{preview.hostname}<ExternalLink size={14} aria-hidden="true" /></span>
        <strong>{linkedTitle?.[2] === preview.href ? linkedTitle[1] : preview.pathname.split("/").filter(Boolean).at(-1) || preview.hostname}</strong>
      </a>}
      {reacted && onReact && <button type="button" className="m-reaction" aria-label="Remove thumbs up" aria-pressed="true" onClick={onReact}><ThumbsUp size={14} aria-hidden="true" />1</button>}
    </div>
      <div className="m-message-footer">
      {row.timestamp && (!grouped || !previous?.timestamp || row.timestamp - previous.timestamp > 300) && <time dateTime={new Date(row.timestamp * 1000).toISOString()} className="m-message-time">{new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(row.timestamp * 1000)}</time>}
      <button type="button" className="m-message-actions" aria-label="Message actions" onClick={() => onAction(displayText || "Photo")}><MoreHorizontal size={16} aria-hidden="true" /></button>
      </div>
    </div>
  </article>;
}
