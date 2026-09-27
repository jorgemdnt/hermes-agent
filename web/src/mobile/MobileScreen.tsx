import { useCallback, useEffect, useRef, useState } from "react";
import { MonitorPlay } from "lucide-react";
import RFB from "@novnc/novnc";
import { GatewayClient } from "@/lib/gatewayClient";
import { HERMES_BASE_PATH } from "@/lib/api";
import { Button } from "./ui";

interface Lease { holder: "human" | "agent"; viewer_hash: string | null }
interface ScreenStatus { running: boolean; supported: boolean; installed: boolean; lease: Lease }
interface Observation extends ScreenStatus { ticket: string; viewer_id: string; path: string }

const profile = "samwise";
const message = (e: unknown) => e instanceof Error ? e.message : String(e);
const viewerHash = async (id: string) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(id)))).map(b => b.toString(16).padStart(2, "0")).join("").slice(0, 12);

export default function MobileScreen({ gateway, onContinue }: { gateway: GatewayClient | null; onContinue: () => Promise<void> }) {
  const target = useRef<HTMLDivElement>(null);
  const socket = useRef<WebSocket | null>(null);
  const rfb = useRef<RFB | null>(null);
  const viewer = useRef("");
  const attachedOnce = useRef(false);
  const generation = useRef(0);
  const [digest, setDigest] = useState("");
  const [status, setStatus] = useState<ScreenStatus | null>(null);
  const [state, setState] = useState<"idle" | "connecting" | "live">("idle");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [continueReady, setContinueReady] = useState(false);
  const held = status?.lease.holder === "human" && status.lease.viewer_hash === digest;

  const refresh = useCallback(async () => {
    if (!gateway) return;
    try { setStatus(await gateway.request<ScreenStatus>("display.status", { profile })); setError(""); }
    catch (e) { setError(message(e)); }
  }, [gateway]);

  const detach = useCallback(() => {
    generation.current += 1;
    socket.current?.close(1000);
    rfb.current?.disconnect();
    socket.current = null;
    rfb.current = null;
  }, []);

  const attach = useCallback(async () => {
    if (!gateway || !target.current || socket.current) return;
    const current = ++generation.current;
    setState("connecting"); setError("");
    try {
      const observed = await gateway.request<Observation>("display.observe", { profile, viewer_id: viewer.current || undefined });
      if (current !== generation.current || !target.current) return;
      viewer.current = observed.viewer_id;
      const ownHash = await viewerHash(observed.viewer_id);
      if (current !== generation.current || !target.current) return;
      setDigest(ownHash);
      setStatus(observed);
      const wsUrl = new URL(`${HERMES_BASE_PATH}${observed.path}`, window.location.href);
      wsUrl.protocol = wsUrl.protocol === "https:" ? "wss:" : "ws:";
      wsUrl.searchParams.set("display_ticket", observed.ticket);
      const ws = new WebSocket(wsUrl);
      ws.binaryType = "arraybuffer";
      socket.current = ws;
      const client = new RFB(target.current, ws, { shared: true });
      rfb.current = client;
      client.scaleViewport = true;
      client.resizeSession = false;
      client.focusOnClick = true;
      client.qualityLevel = 7;
      client.viewOnly = observed.lease.holder !== "human" || observed.lease.viewer_hash !== ownHash;
      client.addEventListener("connect", () => setState("live"));
      client.addEventListener("disconnect", () => {
        if (socket.current === ws) {
          socket.current = null;
          rfb.current = null;
          setState("idle");
          void refresh();
        }
      });
    } catch (e) {
      if (current !== generation.current) return;
      detach();
      setState("idle"); setError(message(e));
    }
  }, [gateway, refresh, detach]);

  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => { if (status?.running && state === "idle" && !attachedOnce.current) { attachedOnce.current = true; void attach(); } }, [status?.running, state, attach]);
  useEffect(() => {
    if (!gateway) return;
    return gateway.onEvent(ev => {
      if (ev.type !== "display.lease") return;
      const payload = ev.payload as { profile_key?: string; lease?: Lease };
      if (payload.profile_key?.endsWith("/profiles/samwise") && payload.lease) setStatus(prev => prev && { ...prev, lease: payload.lease! });
    });
  }, [gateway]);
  useEffect(() => { if (rfb.current) rfb.current.viewOnly = !held; }, [held]);
  useEffect(() => () => { detach(); }, [detach]);

  const start = async () => {
    if (!gateway) return;
    setBusy(true);
    try { setStatus(await gateway.request<ScreenStatus>("display.start", { profile })); }
    catch (e) { setError(message(e)); }
    finally { setBusy(false); }
  };
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
  return <section className="m-screen" aria-label="Samwise live screen">
    {status?.running && <p className="m-muted">{held ? "You control the browser. Samwise's browser tools are paused." : "Watch only. Take over to handle a check or login."}</p>}
    {error && <p role="alert" className="m-error">{error}</p>}
    {status?.running ? <div className="m-screen-frame" ref={target} aria-label="Live VPS desktop" />
      : <div className="m-screen-empty">
        <MonitorPlay size={30} strokeWidth={1.5} aria-hidden="true" />
        <strong>Screen is off</strong>
        <Button variant="primary" type="button" disabled={busy || !gateway} onClick={() => void start()}>{busy ? "Starting…" : "Start screen"}</Button>
      </div>}
    {status?.running && <div className="m-screen-actions">
      {state !== "live" && <button type="button" disabled={state === "connecting"} onClick={() => void attach()}>{state === "connecting" ? "Connecting…" : "Reconnect"}</button>}
      {held ? <button type="button" disabled={busy} onClick={() => void handBack()}>Hand back</button> : <button type="button" disabled={busy || state !== "live"} onClick={() => void takeOver()}>Take over</button>}
      {continueReady && !held && <button type="button" disabled={busy} onClick={() => void onContinue().then(() => setContinueReady(false)).catch(e => setError(message(e)))}>Continue</button>}
    </div>}
  </section>;
}
