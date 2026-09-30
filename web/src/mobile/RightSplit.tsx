import { useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowLeft, ArrowRight, ChevronRight, Code2, ExternalLink, FileText, Folder, Globe2, Monitor, PanelRight, RefreshCw } from "lucide-react";
import hljs from "highlight.js/lib/common";
import { Markdown } from "@/components/Markdown";
import { authedFetch, fetchJSON } from "@/lib/api";
import { browserAddress } from "./preview-links";
import "./right-split.css";
import type { useMobileNavigation } from "./navigation";
type HistoryNavigation = ReturnType<typeof useMobileNavigation>;

export type SplitTab = "browser" | "files" | "screen";
type Guest = HTMLElement & {
  loadURL(url: string): Promise<void>; getURL(): string; getWebContentsId(): number;
  canGoBack(): boolean; canGoForward(): boolean; goBack(): void; goForward(): void; reload(): void;
};
const partition = "persist:hermetic-browser";
const message = (error: unknown) => error instanceof Error ? error.message : String(error);
const query = (profile: string, session: string, path: string, view: "list" | "content") =>
  `/api/bot-preview?${new URLSearchParams({ profile, session, path, view })}`;

function BrowserPane({ address, onAddress, suggestions, navigation }: { address: string; onAddress: (url: string, replace?: boolean) => void; suggestions: string[]; navigation?: HistoryNavigation }) {
  const [draft, setDraft] = useState<{ base: string; value: string } | null>(null);
  const [error, setError] = useState("");
  const guest = useRef<Guest | null>(null);
  const [ready, setReady] = useState(false);
  const [frameKey, setFrameKey] = useState(0);
  const current = address || "";
  const native = !!window.hermetic;
  const activeAddress = useRef(address);
  const loadingAddress = useRef("");
  // Native events can arrive between this render and the load effect. Fence
  // the outgoing page immediately so it cannot add itself to the new history.
  if (activeAddress.current !== address) {
    activeAddress.current = address;
    loadingAddress.current = address;
  }
  const onGuestAddress = useRef(onAddress);
  onGuestAddress.current = onAddress;
  useEffect(() => {
    const node = guest.current;
    if (!native || !ready || !address || !node) return;
    if (node.getURL() === address) {
      loadingAddress.current = "";
      return;
    }
    loadingAddress.current = address;
    void node.loadURL(address).then(() => {
      if (activeAddress.current !== address) return;
      const final = browserAddress(node.getURL());
      if (final && final !== address) onGuestAddress.current(final, true);
    }).catch((cause: unknown) => {
      if (activeAddress.current === address) setError(message(cause));
    }).finally(() => {
      if (loadingAddress.current === address) loadingAddress.current = "";
    });
  }, [address, native, ready]);
  useEffect(() => {
    if (!native || !guest.current) return;
    const node = guest.current;
    const sync = (replace = false) => {
      const next = browserAddress(node.getURL());
      // Late load events must not resurrect a preview closed by Back.
      if (next && activeAddress.current && !loadingAddress.current && next !== activeAddress.current) onGuestAddress.current(next, replace);
    };
    const attached = () => { setReady(true); };
    const navigated = () => sync();
    const inPage = () => sync(true);
    const failed = (event: Event) => setError((event as Event & { errorDescription?: string }).errorDescription || "Page could not load.");
    node.addEventListener("dom-ready", attached);
    node.addEventListener("did-navigate", navigated);
    node.addEventListener("did-navigate-in-page", inPage);
    node.addEventListener("did-fail-load", failed);
    return () => {
      node.removeEventListener("dom-ready", attached);
      node.removeEventListener("did-navigate", navigated);
      node.removeEventListener("did-navigate-in-page", inPage);
      node.removeEventListener("did-fail-load", failed);
    };
  }, [native]);
  const visit = (value: string) => {
    const url = browserAddress(value);
    if (!url) { setError("Enter an HTTP or HTTPS address."); return; }
    setError("");
    setDraft(null);
    onAddress(url);
  };
  const back = () => navigation?.back();
  const forward = () => navigation?.forward();
  const reload = () => native ? guest.current?.reload() : setFrameKey(value => value + 1);
  const openExternal = () => {
    if (!address) return;
    if (window.hermetic) void window.hermetic.openBrowserExternal(address).catch((cause: unknown) => setError(message(cause)));
    else window.open(address, "_blank", "noopener,noreferrer");
  };
  return <div className="m-split-browser">
    <form className="m-split-address" onSubmit={event => { event.preventDefault(); visit(draft?.base === current ? draft.value : current); }}>
      <button type="button" aria-label="Back" disabled={!navigation?.canGoBack} onClick={back}><ArrowLeft size={17} /></button>
      <button type="button" aria-label="Forward" disabled={!navigation?.canGoForward} onClick={forward}><ArrowRight size={17} /></button>
      <button type="button" aria-label="Reload page" disabled={!address} onClick={reload}><RefreshCw size={16} /></button>
      <input type="text" inputMode="url" name="browser-address" autoComplete="off" aria-label="Browser address" value={draft?.base === current ? draft.value : current} onChange={event => setDraft({ base: current, value: event.target.value })} onFocus={() => setDraft({ base: current, value: current })} placeholder="https://example.com…" spellCheck={false} />
      <button type="submit" aria-label="Go to address"><ChevronRight size={17} /></button>
      <button type="button" aria-label="Open in default browser" disabled={!address} onClick={openExternal}><ExternalLink size={16} /></button>
      {native && <button type="button" aria-label="Browser DevTools" onClick={() => {
        const id = guest.current?.getWebContentsId();
        if (id) void window.hermetic?.openBrowserDevTools(id).catch((cause: unknown) => setError(message(cause)));
      }}><Code2 size={16} /></button>}
    </form>
    {error && <p className="m-split-error" role="alert">{error}</p>}
    {!native && <p className="m-split-framing">Some sites refuse to load in a frame. If this stays blank, open it in your browser.</p>}
    {native && <div className="m-split-page" hidden={!address}>
      <webview ref={node => { guest.current = node as Guest | null; }} src="about:blank" partition={partition} style={{ width: "100%", height: "100%" }} />
    </div>}
    {!address && <div className="m-split-browser-empty"><Globe2 size={24} aria-hidden="true" /><p>Enter an address, or open a localhost link from this conversation.</p>{suggestions.length > 0 && <div className="m-split-suggestions">{suggestions.map(url => <button type="button" key={url} title={url} onClick={() => visit(url)}>{url}</button>)}</div>}</div>}
    {!native && address && <iframe key={frameKey} className="m-split-page" title="Browser preview" src={address} sandbox="allow-forms allow-scripts allow-popups" referrerPolicy="no-referrer" />}
  </div>;
}

type Entry = { name: string; kind: string };
type Listing = { folder: string; path: string; entries: Entry[] };
type Content = { kind: "markdown" | "json" | "code"; content: string };

function HighlightedCode({ content, filename }: { content: string; filename: string }) {
  const lang = filename.split(".").at(-1)?.toLowerCase() || "";
  const lines = content.split("\n");
  return <pre className="m-split-code" aria-label={filename}><code>{lines.map((line, index) => {
    const html = hljs.getLanguage(lang) ? hljs.highlight(line, { language: lang, ignoreIllegals: true }).value : hljs.highlightAuto(line, []).value;
    return <span className="m-split-code-line" key={index}><span className="m-split-line-number" aria-hidden="true">{index + 1}</span><span dangerouslySetInnerHTML={{ __html: html || " " }} /></span>;
  })}</code></pre>;
}

function FilesPane({ profile, session, requestedPath }: { profile: string; session: string; requestedPath: string }) {
  const [directory, setDirectory] = useState(() => requestedPath.slice(0, Math.max(0, requestedPath.lastIndexOf("/"))));
  const [file, setFile] = useState(requestedPath);
  const [listing, setListing] = useState<Listing | null>(null);
  const [content, setContent] = useState<Content | null>(null);
  const [binary, setBinary] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    void fetchJSON<Listing>(query(profile, session, directory, "list"))
      .then(result => { if (active) { setListing(result); setError(""); } })
      .catch((cause: unknown) => { if (active) { setListing(null); setError(message(cause)); } });
    return () => { active = false; };
  }, [profile, session, directory]);
  useEffect(() => {
    if (!file) return;
    let active = true;
    let url = "";
    const load = async () => {
      const response = await authedFetch(query(profile, session, file, "content"));
      if (!response.ok) { const body: unknown = await response.json(); throw new Error(typeof body === "object" && body && "detail" in body ? String(body.detail) : `Preview failed (${response.status})`); }
      const mime = response.headers.get("content-type") || "";
      if (mime.startsWith("image/") || mime.startsWith("application/pdf")) {
        url = URL.createObjectURL(await response.blob());
        if (active) { setBinary(url); setContent(null); setError(""); }
      } else {
        const result: Content = await response.json();
        if (active) { setContent(result); setBinary(""); setError(""); }
      }
    };
    void load().catch((cause: unknown) => { if (active) { setContent(null); setBinary(""); setError(message(cause)); } });
    return () => { active = false; if (url) URL.revokeObjectURL(url); };
  }, [profile, session, file]);
  const select = (path: string, kind: string) => {
    if (kind === "directory") { setDirectory(path); setFile(""); setContent(null); setBinary(""); }
    else { setFile(path); setContent(null); setBinary(""); }
  };
  const crumbs = directory ? directory.split("/") : [];
  let pretty = content?.content || "";
  if (content?.kind === "json") {
    try { pretty = JSON.stringify(JSON.parse(pretty), null, 2); } catch { /* Display the original invalid JSON. */ }
  }
  return <div className="m-split-files">
    <nav aria-label="File breadcrumb" className="m-split-crumbs"><button type="button" title={listing?.folder} onClick={() => { setDirectory(""); setFile(""); setContent(null); setBinary(""); }}>{listing?.folder.split("/").at(-1) || "Folder"}</button>{crumbs.map((part, index) => <span key={index}><ChevronRight size={13} /><button type="button" onClick={() => { setDirectory(crumbs.slice(0, index + 1).join("/")); setFile(""); setContent(null); setBinary(""); }}>{part}</button></span>)}{file && <span><ChevronRight size={13} />{file.split("/").at(-1)}</span>}</nav>
    {error && <p className="m-split-error" role="alert">{error}</p>}
    <div className="m-split-file-list" aria-label="Files in conversation folder">{listing?.entries.map(entry => <button type="button" key={entry.name} aria-current={file === [directory, entry.name].filter(Boolean).join("/") ? "true" : undefined} onClick={() => select([directory, entry.name].filter(Boolean).join("/"), entry.kind)}>{entry.kind === "directory" ? <Folder size={16} /> : <FileText size={16} />}<span>{entry.name}</span></button>)}</div>
    <div className="m-split-file-content" aria-label="File preview">{file && binary && (file.toLowerCase().endsWith(".pdf") ? <iframe title={file} src={binary} /> : <img src={binary} alt={file} />)}{content?.kind === "markdown" && <Markdown content={content.content} />}{content && content.kind !== "markdown" && <HighlightedCode content={pretty} filename={file} />}{!file && <p className="m-split-empty">Choose a file to preview. Files are read-only.</p>}</div>
  </div>;
}

export function RightSplit({ open, width, onWidth, onClose, tab, onTab, browserUrl, onBrowserUrl, suggestions, filePath, profile, session, screen, navigation }: {
  open: boolean; width: number; onWidth: (width: number) => void; onClose: () => void; tab: SplitTab; onTab: (tab: SplitTab) => void;
  browserUrl: string; onBrowserUrl: (url: string, replace?: boolean) => void; suggestions: string[]; filePath: string; profile: string; session: string; screen?: ReactNode; navigation?: HistoryNavigation;
}) {
  const initial = useRef<{ x: number; width: number } | null>(null);
  const clamp = (value: number) => Math.max(320, Math.min(value, Math.min(900, window.innerWidth - 620)));
  return <aside id="m-right-sidebar" className="m-right-split" data-open={open} aria-hidden={!open} inert={!open} style={{ "--m-split-width": `${width}px` } as React.CSSProperties} aria-label="Right split">
    <div className="m-split-resize" role="separator" tabIndex={0} aria-label="Resize right split" aria-orientation="vertical" aria-valuenow={width} onPointerDown={event => { initial.current = { x: event.clientX, width }; event.currentTarget.setPointerCapture(event.pointerId); }} onPointerMove={event => { if (initial.current) onWidth(clamp(initial.current.width + initial.current.x - event.clientX)); }} onPointerUp={() => { initial.current = null; }} onPointerCancel={() => { initial.current = null; }} onKeyDown={event => { if (event.key === "ArrowLeft" || event.key === "ArrowRight") { event.preventDefault(); onWidth(clamp(width + (event.key === "ArrowLeft" ? 24 : -24))); } }} />
    <div className="m-split-header"><div role="tablist" aria-label="Right split views">{(["browser", "files", ...(screen ? ["screen"] : [])] as SplitTab[]).map(item => <button type="button" role="tab" aria-selected={tab === item} key={item} onClick={() => onTab(item)}>{item === "browser" ? <Globe2 size={16} /> : item === "files" ? <FileText size={16} /> : <Monitor size={16} />}{item[0].toUpperCase() + item.slice(1)}</button>)}</div>{open && <button type="button" className="m-icon-button" aria-label="Close right split" aria-expanded={open} aria-controls="m-right-sidebar" title="Toggle right sidebar (⌘⌥B / Ctrl+Alt+B)" onClick={onClose}><PanelRight size={20} aria-hidden="true" /></button>}</div>
    <div className="m-split-body" role="tabpanel" aria-label={tab}>
      <div className="m-split-tab-pane" hidden={tab !== "browser"}><BrowserPane address={browserUrl} onAddress={onBrowserUrl} suggestions={suggestions} navigation={navigation} /></div>
      {open && tab === "files" && <FilesPane key={`${profile}/${session}/${filePath}`} profile={profile} session={session} requestedPath={filePath} />}
      {open && tab === "screen" && screen}
    </div>
  </aside>;
}
