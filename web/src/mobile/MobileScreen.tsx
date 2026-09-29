import { useCallback, useEffect, useRef, useState } from "react";
import { Keyboard, MonitorPlay, MousePointer2, RotateCcw, SquareMousePointer, Undo2 } from "lucide-react";
import RFB from "@novnc/novnc";
import { advanceCursor, keyPacket, pointerPacket, type Cursor } from "./trackpad";
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
  const keyboard = useRef<HTMLTextAreaElement>(null);
  const cursorElement = useRef<HTMLSpanElement>(null);
  const cursor = useRef<Cursor | null>(null);
  const gesture = useRef<{ count: number; x: number; y: number; moved: boolean; scroll: number } | null>(null);
  const lastMove = useRef(0);
  const [pointer, setPointer] = useState<Cursor | null>(null);
  const [keyboardOpen, setKeyboardOpen] = useState(false);
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
        client.viewOnly = window.matchMedia("(pointer: coarse)").matches || observed.lease.holder !== "human" || observed.lease.viewer_hash !== ownHash;
        client.addEventListener("connect", () => { retries.current = 0; setState("live"); setError(""); });
        client.addEventListener("disconnect", () => disconnected("Connection lost. Reconnecting…"));
      }
    } catch (e) {
      if (current !== generation.current) return;
      detach(); setState("retrying"); setError(`Couldn’t connect: ${message(e)}. Retrying…`);
      void refresh();
    }
  }, [gateway, profile, refresh, detach]);

  useEffect(() => { if (gateway?.connectionState === "open") void attach(); }, [gateway, attach]);
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
  useEffect(() => { if (rfb.current) rfb.current.viewOnly = window.matchMedia("(pointer: coarse)").matches || !held; }, [held]);
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
  const dimensions = () => {
    if (status?.transport === "jpeg") return frameSize;
    const canvas = target.current?.querySelector("canvas");
    return { width: canvas?.width || 0, height: canvas?.height || 0 };
  };
  const sendPointer = (point: Cursor, mask = 0) => {
    if (!held || socket.current?.readyState !== WebSocket.OPEN) return;
    if (status?.transport === "jpeg") {
      if (mask) socket.current.send(JSON.stringify({ type: "click", button: mask === 4 ? "right" : "left", ...point }));
      else socket.current.send(JSON.stringify({ type: "move", ...point }));
    } else socket.current.send(pointerPacket(point.x, point.y, mask));
  };
  const sendScroll = (direction: "up" | "down", amount: number) => {
    if (!cursor.current || !held || socket.current?.readyState !== WebSocket.OPEN) return;
    if (status?.transport === "jpeg") socket.current.send(JSON.stringify({ type: "scroll", direction, amount, ...cursor.current }));
    else for (let i = 0; i < amount; i++) {
      socket.current.send(pointerPacket(cursor.current.x, cursor.current.y, direction === "down" ? 16 : 8));
      socket.current.send(pointerPacket(cursor.current.x, cursor.current.y, 0));
    }
  };
  const sendKey = (keysym: number, macKey: string) => {
    if (!held || socket.current?.readyState !== WebSocket.OPEN) return;
    if (status?.transport === "jpeg") socket.current.send(JSON.stringify({ type: "key", key: macKey, modifiers: [] }));
    else { socket.current.send(keyPacket(keysym, true)); socket.current.send(keyPacket(keysym, false)); }
  };
  const sendText = (text: string) => {
    if (!held || socket.current?.readyState !== WebSocket.OPEN || !text) return;
    if (status?.transport === "jpeg") {
      for (let offset = 0; offset < text.length; offset += 512)
        socket.current.send(JSON.stringify({ type: "text", text: text.slice(offset, offset + 512) }));
    } else for (const char of text) {
      const cp = char.codePointAt(0)!;
      const symbol = cp <= 255 ? cp : 0x01000000 | cp;
      socket.current.send(keyPacket(symbol, true)); socket.current.send(keyPacket(symbol, false));
    }
  };
  const onTouchStart = (event: React.TouchEvent) => {
    if (!held || state !== "live") return;
    event.preventDefault();
    const touches = Array.from(event.touches);
    const x = touches.reduce((sum, touch) => sum + touch.clientX, 0) / touches.length;
    const y = touches.reduce((sum, touch) => sum + touch.clientY, 0) / touches.length;
    if (!cursor.current) { const size = dimensions(); cursor.current = { x: Math.floor(size.width / 2), y: Math.floor(size.height / 2) }; setPointer(cursor.current); }
    gesture.current = { count: touches.length, x, y, moved: false, scroll: 0 };
  };
  const onTouchMove = (event: React.TouchEvent) => {
    const active = gesture.current;
    if (!active || !held) return;
    event.preventDefault();
    const touches = Array.from(event.touches);
    if (touches.length !== active.count) { gesture.current = null; return; }
    const x = touches.reduce((sum, touch) => sum + touch.clientX, 0) / touches.length;
    const y = touches.reduce((sum, touch) => sum + touch.clientY, 0) / touches.length;
    const dx = x - active.x, dy = y - active.y;
    if (Math.hypot(dx, dy) > 2) active.moved = true;
    active.x = x; active.y = y;
    if (active.count === 2) {
      active.scroll += dy;
      if (Math.abs(active.scroll) >= 18) {
        const steps = Math.min(8, Math.floor(Math.abs(active.scroll) / 18));
        sendScroll(active.scroll < 0 ? "down" : "up", steps);
        active.scroll -= Math.sign(active.scroll) * steps * 18;
      }
      return;
    }
    const size = dimensions();
    const visual = target.current?.querySelector("img, canvas")?.getBoundingClientRect();
    if (!cursor.current || !size.width || !size.height || !visual?.width) return;
    const next = advanceCursor(cursor.current, dx * size.width / visual.width, dy * size.height / visual.height, size.width, size.height);
    cursor.current = next; setPointer(next);
    const now = performance.now();
    if (now - lastMove.current > (status?.transport === "jpeg" ? 80 : 16)) { sendPointer(next); lastMove.current = now; }
  };
  const onTouchEnd = (event: React.TouchEvent) => {
    const active = gesture.current;
    if (!active || event.touches.length) return;
    event.preventDefault(); gesture.current = null;
    if (!active.moved && cursor.current) {
      sendPointer(cursor.current, active.count === 2 ? 4 : 1);
      if (status?.transport !== "jpeg") sendPointer(cursor.current, 0);
      if (active.count === 1) keyboard.current?.focus({ preventScroll: true });
    } else if (cursor.current && active.count === 1) sendPointer(cursor.current);
  };
  useEffect(() => {
    const size = status?.transport === "jpeg" ? frameSize : {
      width: target.current?.querySelector("canvas")?.width || 0,
      height: target.current?.querySelector("canvas")?.height || 0,
    };
    const visual = target.current?.querySelector("img, canvas")?.getBoundingClientRect();
    const frame = target.current?.getBoundingClientRect();
    if (!pointer || !size.width || !size.height || !visual || !frame || !cursorElement.current) return;
    cursorElement.current.style.left = `${visual.left - frame.left + pointer.x / size.width * visual.width}px`;
    cursorElement.current.style.top = `${visual.top - frame.top + pointer.y / size.height * visual.height}px`;
  }, [pointer, frameSize, status?.transport]);
  return <section className="m-screen" aria-label={`${name} live screen`}>
    <div className="m-screen-toolbar"><span className="m-screen-mode" role="status" aria-live="polite">{held ? `You control ${name}’s computer` : "View only"}</span></div>
    {error && <p role="alert" className="m-error">{error} <button type="button" onClick={retry}>Retry</button></p>}
    {(!status || status.running) ? <div className={`m-screen-frame${held ? " m-screen-controlled" : ""}`} ref={target} tabIndex={status?.transport === "jpeg" && held ? 0 : -1} onKeyDown={key}
      onTouchStartCapture={onTouchStart} onTouchMoveCapture={onTouchMove} onTouchEndCapture={onTouchEnd} onTouchCancelCapture={() => { gesture.current = null; }} aria-label={`${name} desktop`}>
      {status?.transport === "jpeg" && <button type="button" className="m-screen-image-button" aria-label={`Click ${name} desktop`} disabled={!held} onClick={click}><img alt={`${name} desktop, live`} width={frameSize.width || 1512} height={frameSize.height || 982} /></button>}
      {held && pointer && <span ref={cursorElement} className="m-screen-cursor" aria-hidden="true"><MousePointer2 size={21} fill="white" /></span>}
      {state !== "live" && <div className="m-screen-overlay" role="status">{state === "starting" ? "Starting screen…" : "Connecting to screen…"}</div>}
    </div> : <div className="m-screen-empty">
      <MonitorPlay size={30} strokeWidth={1.5} aria-hidden="true" />
      <strong>{state === "starting" ? "Starting screen…" : status ? "Screen unavailable" : "Checking screen…"}</strong>
      {state === "error" && <Button variant="primary" type="button" disabled={!gateway} onClick={retry}>Retry Screen</Button>}
    </div>}
    {status?.running && <div className="m-screen-actions">
      {state !== "live" && <Button variant="outline" type="button" onClick={retry}><RotateCcw size={17} aria-hidden="true" />Reconnect</Button>}
      {held ? <>
        <Button variant="secondary" type="button" aria-label={keyboardOpen ? "Close remote keyboard" : "Open remote keyboard"} onClick={() => keyboardOpen ? keyboard.current?.blur() : keyboard.current?.focus({ preventScroll: true })}><Keyboard size={18} aria-hidden="true" />{keyboardOpen ? "Done" : "Keyboard"}</Button>
        <Button variant="outline" type="button" disabled={busy} onClick={() => void handBack()}><Undo2 size={18} aria-hidden="true" />Hand Back</Button>
      </> : <Button variant="primary" type="button" disabled={busy || state !== "live"} onClick={() => void takeOver()}><SquareMousePointer size={18} aria-hidden="true" />Take Control</Button>}
      {continueReady && !held && onContinue && <Button variant="secondary" type="button" disabled={busy} onClick={() => void onContinue().then(() => setContinueReady(false)).catch(e => setError(message(e)))}>Continue Chat</Button>}
    </div>}
    <textarea ref={keyboard} className="m-screen-keyboard" aria-label={`Type on ${name} computer`} name="remote-keyboard" autoComplete="off" autoCapitalize="off" spellCheck={false}
      onFocus={() => setKeyboardOpen(true)} onBlur={() => setKeyboardOpen(false)}
      onKeyDown={event => {
        const keys: Record<string, [number, string]> = { Backspace: [0xff08, "delete"], Enter: [0xff0d, "return"], Tab: [0xff09, "tab"], Escape: [0xff1b, "escape"] };
        if (keys[event.key]) { event.preventDefault(); sendKey(...keys[event.key]); }
      }}
      onInput={event => { if (event.nativeEvent.isComposing) return; sendText(event.currentTarget.value); event.currentTarget.value = ""; }}
      onCompositionEnd={event => { sendText(event.currentTarget.value); event.currentTarget.value = ""; }} />
  </section>;
}
