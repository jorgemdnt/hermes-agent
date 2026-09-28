import { useCallback, useEffect, useRef, useState } from "react";
import { MonitorPlay } from "lucide-react";
import RFB from "@novnc/novnc";
import { GatewayClient } from "@/lib/gatewayClient";
import { HERMES_BASE_PATH } from "@/lib/api";
import { Button } from "./ui";

interface Lease { holder: "human" | "agent"; viewer_hash: string | null }
interface ScreenStatus { running: boolean; supported: boolean; installed: boolean; blocker?: string | null; transport?: "rfb" | "jpeg"; lease: Lease }
interface Observation extends ScreenStatus { ticket: string; viewer_id: string; path: string }

const message = (e: unknown) => e instanceof Error ? e.message : String(e);
const viewerHash = async (id: string) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(id)))).map(b => b.toString(16).padStart(2, "0")).join("").slice(0, 12);

export default function MobileScreen({ gateway, profile, name, onContinue, onStateChange }: { gateway: GatewayClient | null; profile: string; name: string; onContinue?: () => Promise<void>; onStateChange: (state: string) => void }) {
  const target = useRef<HTMLDivElement>(null);
  const socket = useRef<WebSocket | null>(null);
  const rfb = useRef<RFB | null>(null);
  const viewer = useRef("");
  const generation = useRef(0);
  const retries = useRef(0);
  const starting = useRef(false);
  const imageUrl = useRef("");
  const [digest, setDigest] = useState("");
  const [status, setStatus] = useState<ScreenStatus | null>(null);
  const [state, setState] = useState<"checking" | "starting" | "connecting" | "live" | "retrying" | "error">("checking");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [continueReady, setContinueReady] = useState(false);
  const [frameSize, setFrameSize] = useState({ width: 0, height: 0 });
  const held = status?.lease.holder === "human" && status.lease.viewer_hash === digest;
  useEffect(() => { onStateChange(({ live: "Live", starting: "Starting…", connecting: "Connecting…", retrying: "Reconnecting…", checking: "Checking…", error: "Unavailable" })[state]); }, [state, onStateChange]);

  const detach = useCallback(() => {
    generation.current += 1;
    socket.current?.close(1000);
    rfb.current?.disconnect();
    socket.current = null;
    rfb.current = null;
    if (imageUrl.current) URL.revokeObjectURL(imageUrl.current);
    imageUrl.current = "";
  }, []);

  const start = useCallback(async (gw: GatewayClient) => {
    if (starting.current) return;
    starting.current = true;
    setState("starting"); setError("");
    try { setStatus(await gw.request<ScreenStatus>("display.start", { profile })); setState("connecting"); }
    catch (e) { setError(`Couldn’t start the screen: ${message(e)}`); setState("error"); }
    finally { starting.current = false; }
  }, [profile]);

  const refresh = useCallback(async () => {
    if (!gateway || gateway.connectionState !== "open") return;
    try {
      const next = await gateway.request<ScreenStatus>("display.status", { profile });
      setStatus(next);
      if (!next.running && next.supported && next.installed) void start(gateway);
      else if (!next.running) { setError(next.blocker || (next.supported ? "Screen software is not installed." : "This bot has no screen on this host.")); setState("error"); }
    } catch (e) { setError(`Couldn’t check the screen: ${message(e)}`); setState("error"); }
  }, [gateway, profile, start]);

  const attach = useCallback(async () => {
    if (!gateway || gateway.connectionState !== "open" || !target.current || socket.current) return;
    const current = ++generation.current;
    setState("connecting"); setError("");
    try {
      const observed = await gateway.request<Observation>("display.observe", { profile, viewer_id: viewer.current || undefined });
      if (current !== generation.current || !target.current) return;
      viewer.current = observed.viewer_id;
      const ownHash = await viewerHash(observed.viewer_id);
      if (current !== generation.current || !target.current) return;
      setDigest(ownHash); setStatus(observed);
      const url = new URL(`${HERMES_BASE_PATH}${observed.path}`, window.location.href);
      url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
      url.searchParams.set("display_ticket", observed.ticket);
      const ws = new WebSocket(url);
      ws.binaryType = "arraybuffer";
      socket.current = ws;
      const disconnected = (reason: string) => {
        if (current !== generation.current || socket.current !== ws) return;
        socket.current = null; rfb.current = null;
        setError(reason);
        setState(reason ? "retrying" : "checking");
        void refresh();
      };
      ws.addEventListener("close", event => disconnected(event.code === 4000 ? "Control changed hands. Reconnecting…" : "Connection lost. Reconnecting…"));
      ws.addEventListener("error", () => disconnected("Stream interrupted. Reconnecting…"));
      if (observed.transport === "jpeg") {
        ws.addEventListener("message", event => {
          if (current !== generation.current) return;
          if (typeof event.data === "string") {
            const info = JSON.parse(event.data) as { width?: number; height?: number; error?: string };
            if (info.error) { setError(info.error); setState("error"); ws.close(); }
            if (info.width && info.height) setFrameSize({ width: info.width, height: info.height });
            return;
          }
          const image = target.current?.querySelector("img");
          if (!image) return;
          const next = URL.createObjectURL(new Blob([event.data], { type: "image/jpeg" }));
          const previous = imageUrl.current;
          imageUrl.current = next; image.src = next;
          if (previous) URL.revokeObjectURL(previous);
          retries.current = 0; setState("live"); setError("");
        });
      } else {
        const client = new RFB(target.current, ws, { shared: true });
        rfb.current = client;
        client.scaleViewport = true;
        client.resizeSession = false;
        client.focusOnClick = true;
        client.qualityLevel = 7;
        client.viewOnly = observed.lease.holder !== "human" || observed.lease.viewer_hash !== ownHash;
        client.addEventListener("connect", () => { retries.current = 0; setState("live"); setError(""); });
        client.addEventListener("disconnect", () => disconnected("Connection lost. Reconnecting…"));
      }
    } catch (e) {
      if (current !== generation.current) return;
      detach(); setState("retrying"); setError(`Couldn’t connect: ${message(e)}. Retrying…`);
    }
  }, [gateway, profile, refresh, detach]);

  useEffect(() => { setState("checking"); if (gateway?.connectionState === "open") void refresh(); }, [gateway, refresh]);
  useEffect(() => {
    if (!status?.running || (state !== "connecting" && state !== "retrying" && state !== "checking") || socket.current || document.visibilityState === "hidden" || !gateway || gateway.connectionState !== "open") return;
    const delay = state === "retrying" ? Math.min(1000 * 2 ** Math.min(retries.current++, 4), 16000) : 0;
    const timer = window.setTimeout(() => void attach(), delay);
    return () => clearTimeout(timer);
  }, [status?.running, state, attach, gateway]);
  useEffect(() => {
    const wake = () => {
      detach();
      setState("checking");
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", wake);
    window.addEventListener("online", wake);
    return () => { document.removeEventListener("visibilitychange", wake); window.removeEventListener("online", wake); };
  }, [detach, refresh]);
  useEffect(() => {
    if (!gateway) return;
    return gateway.onEvent(ev => {
      if (ev.type !== "display.lease") return;
      const payload = ev.payload as { profile_key?: string; lease?: Lease };
      if ((profile === "default" ? payload.profile_key?.endsWith("/.hermes") : payload.profile_key?.endsWith(`/profiles/${profile}`)) && payload.lease)
        setStatus(prev => prev && { ...prev, lease: payload.lease! });
    });
  }, [gateway, profile]);
  useEffect(() => { if (rfb.current) rfb.current.viewOnly = !held; }, [held]);
  useEffect(() => () => { detach(); }, [detach]);

  const retry = () => { detach(); retries.current = 0; setError(""); setState("checking"); void refresh(); };
  const takeOver = async () => {
    if (!gateway || !viewer.current) return;
    setBusy(true);
    try {
      const result = await gateway.request<{ lease: Lease }>("display.lease.acquire", { profile, viewer_id: viewer.current });
      setStatus(prev => prev && { ...prev, lease: result.lease });
    } catch (e) { setError(message(e)); }
    finally { setBusy(false); }
  };
  const handBack = async () => {
    if (!gateway || !viewer.current) return;
    setBusy(true);
    try {
      const result = await gateway.request<{ lease: Lease }>("display.lease.release", { profile, viewer_id: viewer.current });
      setStatus(prev => prev && { ...prev, lease: result.lease });
      setContinueReady(true);
    } catch (e) { setError(message(e)); }
    finally { setBusy(false); }
  };
  const click = (event: React.MouseEvent<HTMLButtonElement>) => {
    if (!held || !frameSize.width || !frameSize.height || socket.current?.readyState !== WebSocket.OPEN) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const scale = Math.min(rect.width / frameSize.width, rect.height / frameSize.height);
    const x = (event.clientX - rect.left - (rect.width - frameSize.width * scale) / 2) / scale;
    const y = (event.clientY - rect.top - (rect.height - frameSize.height * scale) / 2) / scale;
    socket.current.send(JSON.stringify({ type: "click", x, y }));
    target.current?.focus();
  };
  const key = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!held || status?.transport !== "jpeg" || socket.current?.readyState !== WebSocket.OPEN || event.key === "Tab") return;
    const value = event.key === "Enter" ? "return" : event.key === "Backspace" ? "delete" : event.key === " " ? "space" : event.key.toLowerCase();
    if (value.length !== 1 && !["return", "escape", "up", "down", "left", "right", "space", "delete", "home", "end"].includes(value)) return;
    event.preventDefault();
    socket.current.send(JSON.stringify({ type: "key", key: value, modifiers: [event.metaKey && "cmd", event.ctrlKey && "ctrl", event.altKey && "alt", event.shiftKey && "shift"].filter(Boolean) }));
  };
  return <section className="m-screen" aria-label={`${name} live screen`}>
    <div className="m-screen-toolbar"><span className="m-screen-mode" role="status" aria-live="polite">{held ? `You control ${name}’s computer` : "View only"}</span></div>
    {error && <p role="alert" className="m-error">{error} <button type="button" onClick={retry}>Retry</button></p>}
    {status?.running ? <div className={`m-screen-frame${held ? " m-screen-controlled" : ""}`} ref={target} tabIndex={status.transport === "jpeg" && held ? 0 : -1} onKeyDown={key} aria-label={`${name} desktop`}>
      {status.transport === "jpeg" && <button type="button" className="m-screen-image-button" aria-label={`Click ${name} desktop`} disabled={!held} onClick={click}><img alt={`${name} desktop, live`} width={frameSize.width || 1512} height={frameSize.height || 982} /></button>}
      {state !== "live" && <div className="m-screen-overlay" role="status">{state === "starting" ? "Starting screen…" : "Connecting to screen…"}</div>}
    </div> : <div className="m-screen-empty">
      <MonitorPlay size={30} strokeWidth={1.5} aria-hidden="true" />
      <strong>{state === "starting" ? "Starting screen…" : status ? "Screen unavailable" : "Checking screen…"}</strong>
      {state === "error" && <Button variant="primary" type="button" disabled={!gateway} onClick={retry}>Retry Screen</Button>}
    </div>}
    {status?.running && <div className="m-screen-actions">
      {state !== "live" && <button type="button" onClick={retry}>Reconnect</button>}
      {held ? <button type="button" disabled={busy} onClick={() => void handBack()}>Hand Back to {name}</button> : <button type="button" disabled={busy || state !== "live"} onClick={() => void takeOver()}>Take Control</button>}
      {continueReady && !held && onContinue && <button type="button" disabled={busy} onClick={() => void onContinue().then(() => setContinueReady(false)).catch(e => setError(message(e)))}>Continue Chat</button>}
    </div>}
  </section>;
}
