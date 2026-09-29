import { useEffect, useRef, useState, type CSSProperties, type PointerEvent } from "react";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { Plus, X } from "lucide-react";
import { api } from "@/lib/api";

const clampHeight = (height: number) => Math.max(180, Math.min(Math.round(height), Math.floor(window.innerHeight * 0.75)));

function Shell({ profile, visible }: { profile: string; visible: boolean }) {
  const host = useRef<HTMLDivElement>(null);
  const terminal = useRef<Terminal | null>(null);
  const fit = useRef<FitAddon | null>(null);
  const socket = useRef<WebSocket | null>(null);
  const [status, setStatus] = useState("Connecting…");

  useEffect(() => {
    const container = host.current;
    if (!container) return;
    const term = new Terminal({ cursorBlink: true, fontSize: 13, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", scrollback: 5000, theme: { background: "#15171b", foreground: "#e8e9eb" } });
    const addon = new FitAddon();
    terminal.current = term;
    fit.current = addon;
    term.loadAddon(addon);
    term.open(container);
    let disposed = false;
    const resize = () => {
      if (!visible || disposed || !host.current?.clientWidth || !host.current.clientHeight) return;
      addon.fit();
      if (socket.current?.readyState === WebSocket.OPEN) socket.current.send(`\x1b[RESIZE:${term.cols};${term.rows}]`);
    };
    const observer = new ResizeObserver(resize);
    observer.observe(container);
    const input = term.onData(data => { if (socket.current?.readyState === WebSocket.OPEN) socket.current.send(data); });
    let ws: WebSocket | undefined;
    let retryTimer: number | undefined;
    let retries = 0;
    const connect = () => {
      void api.buildWsUrl("/api/bot-terminal", { profile }).then(url => {
        if (disposed) return;
        ws = new WebSocket(url);
        ws.binaryType = "arraybuffer";
        socket.current = ws;
        ws.onopen = () => {
          if (retries) term.write("\r\n[Terminal reconnected — new shell]\r\n");
          retries = 0;
          setStatus("Connected");
          resize();
        };
        ws.onmessage = event => term.write(event.data instanceof ArrayBuffer ? new Uint8Array(event.data) : String(event.data));
        ws.onclose = event => {
          if (disposed) return;
          if (event.code !== 4401 && event.code !== 4403 && retries < 5) {
            setStatus("Reconnecting terminal…");
            retries += 1;
            retryTimer = window.setTimeout(connect, Math.min(1000 * retries, 5000));
          } else {
            setStatus(event.code === 4401 ? "Sign in again to use the terminal" : `Disconnected (${event.code}) — close this tab & open another`);
          }
        };
        ws.onerror = () => { if (!disposed) setStatus("Terminal connection lost"); };
      }).catch(() => {
        if (disposed) return;
        if (retries++ < 5) {
          setStatus("Reconnecting terminal…");
          retryTimer = window.setTimeout(connect, Math.min(1000 * retries, 5000));
        } else setStatus("Terminal unavailable — check your connection");
      });
    };
    connect();
    // A shell is a tab: hiding it does not close its PTY.
    return () => {
      disposed = true;
      observer.disconnect();
      window.clearTimeout(retryTimer);
      input.dispose();
      ws?.close();
      socket.current = null;
      terminal.current = null;
      fit.current = null;
      term.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile]);

  useEffect(() => {
    if (!visible) return;
    const frame = requestAnimationFrame(() => {
      fit.current?.fit();
      const term = terminal.current;
      if (term && socket.current?.readyState === WebSocket.OPEN) socket.current.send(`\x1b[RESIZE:${term.cols};${term.rows}]`);
      term?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [visible]);

  return <div className="m-terminal-shell" hidden={!visible}>
    <div className="m-terminal-surface" ref={host} aria-label={`${profile} terminal`} />
    {status !== "Connected" && <div className="m-terminal-status" role="status" aria-live="polite">{status}</div>}
  </div>;
}

export default function BotTerminalDock({ profile, open, fullScreen, onClose, height, onHeightChange }: {
  profile: string; open: boolean; fullScreen: boolean; onClose: () => void; height: number; onHeightChange: (height: number) => void;
}) {
  const [tabs, setTabs] = useState<Record<string, string[]>>({});
  const [active, setActive] = useState<Record<string, string>>({});
  const dragging = useRef<{ y: number; height: number } | null>(null);
  const ids = tabs[profile] || [];
  const current = active[profile] || ids[0];
  const addTab = (bot: string) => {
    const id = crypto.randomUUID();
    setTabs(previous => ({ ...previous, [bot]: [...(previous[bot] || []), id] }));
    setActive(previous => ({ ...previous, [bot]: id }));
  };
  useEffect(() => {
    if (!open || !profile || tabs[profile]?.length) return;
    const timer = window.setTimeout(() => addTab(profile), 0);
    return () => window.clearTimeout(timer);
  }, [open, profile, tabs]);
  const closeTab = (id: string) => {
    if (!window.confirm("Close this terminal and stop its running command?")) return;
    const remaining = ids.filter(tab => tab !== id);
    setTabs(previous => ({ ...previous, [profile]: remaining }));
    setActive(previous => ({ ...previous, [profile]: remaining[0] || "" }));
    if (!remaining.length) onClose();
  };
  const setSavedHeight = (value: number) => {
    const next = clampHeight(value);
    onHeightChange(next);
    localStorage.setItem("hermes:bot-terminal-height", String(next));
  };
  const pointerDown = (event: PointerEvent<HTMLDivElement>) => {
    dragging.current = { y: event.clientY, height };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const pointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (dragging.current) setSavedHeight(dragging.current.height + dragging.current.y - event.clientY);
  };
  const visible = open && !!profile;
  return <section className={`m-terminal-dock${fullScreen ? " m-terminal-full" : ""}`} data-open={visible}
    aria-label={`${profile} terminal`} aria-hidden={!visible} inert={!visible}
    style={{ "--m-terminal-height": `${height}px` } as CSSProperties}>
    {!fullScreen && <div className="m-terminal-resize" role="separator" aria-label="Resize terminal" aria-orientation="horizontal" tabIndex={visible ? 0 : -1}
      aria-valuemin={180} aria-valuemax={Math.floor(window.innerHeight * 0.75)} aria-valuenow={height}
      onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={() => { dragging.current = null; }} onPointerCancel={() => { dragging.current = null; }}
      onKeyDown={event => { if (event.key === "ArrowUp" || event.key === "ArrowDown") { event.preventDefault(); setSavedHeight(height + (event.key === "ArrowUp" ? 20 : -20)); } }} />}
    <div className="m-terminal-bar">
      <span className="m-terminal-title">{profile} · Terminal</span>
      <div className="m-terminal-tabs" aria-label="Terminal tabs">{ids.map((id, index) => <span className="m-terminal-tab" key={id}>
        <button type="button" aria-pressed={id === current} onClick={() => setActive(previous => ({ ...previous, [profile]: id }))}>Terminal {index + 1}</button>
        <button type="button" aria-label={`Close terminal ${index + 1}`} onClick={() => closeTab(id)}><X size={14} aria-hidden="true" /></button>
      </span>)}</div>
      <button type="button" className="m-terminal-action" aria-label="New terminal tab" onClick={() => addTab(profile)}><Plus size={18} aria-hidden="true" /></button>
      <button type="button" className="m-terminal-action" aria-label="Hide terminal" onClick={onClose}><X size={18} aria-hidden="true" /></button>
    </div>
    <div className="m-terminal-content">{Object.entries(tabs).flatMap(([bot, botTabs]) => botTabs.map(id =>
      <Shell key={id} profile={bot} visible={visible && bot === profile && id === current} />))}</div>
  </section>;
}
