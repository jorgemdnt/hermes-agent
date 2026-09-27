import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import type { ServerRequest } from "@hermes/shared";
import { api, HERMES_BASE_PATH, type ProfileInfo } from "@/lib/api";
import { GatewayClient } from "@/lib/gatewayClient";
import PromptCard from "./PromptCard";
import MobileKanban from "./MobileKanban";
import MobileScreen from "./MobileScreen";
import { applyChatEvent, PROMPT_METHODS, transcriptRows, type MobileChat, type PendingPrompt } from "./mobile-state";
import { pushAvailable, registerMobileWorker, signOutMobile, subscribePush, unsubscribePush } from "./mobile-push";
import "./mobile.css";

interface SessionRow { id: string; title: string; preview: string }
interface SessionSnapshot {
  session_id: string;
  stored_session_id?: string;
  messages: Array<{ role: string; text?: string | null; display_kind?: string | null }>;
  running?: boolean;
  inflight?: { assistant?: string; user?: string; streaming?: boolean } | null;
}
const errorText = (error: unknown) => error instanceof Error ? error.message : String(error);
const profileFromUrl = () => new URLSearchParams(window.location.search).get("profile") || "";

export default function MobileApp() {
  const [profiles, setProfiles] = useState<ProfileInfo[]>([]);
  const [profile, setProfile] = useState("");
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [selected, setSelected] = useState("");
  const [chat, setChat] = useState<MobileChat | null>(null);
  const [prompts, setPrompts] = useState<Record<string, PendingPrompt>>({});
  const [connection, setConnection] = useState("connecting");
  const [view, setView] = useState<"chat" | "board" | "screen" | "settings">("chat");
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [pushEnabled, setPushEnabled] = useState(false);
  const client = useRef<GatewayClient | null>(null);
  const [screenGateway, setScreenGateway] = useState<GatewayClient | null>(null);
  const skipResume = useRef("");
  const selectedRef = useRef("");
  const end = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    void api.getProfiles().then(data => {
      setProfiles(data.profiles);
      const wanted = profileFromUrl();
      setProfile(data.profiles.find(p => p.name === wanted)?.name ?? data.profiles.find(p => p.is_default)?.name ?? data.profiles[0]?.name ?? "");
    }).catch(e => setError(errorText(e)));
    if ("serviceWorker" in navigator) void registerMobileWorker().catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!profile) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const gw = new GatewayClient();
    const retry = () => {
      clearTimeout(timer);
      if (alive) timer = setTimeout(() => void connect(), 2000);
    };
    client.current = gw;
    const connect = async () => {
      if (!alive || gw.connectionState === "connecting" || gw.connectionState === "open") return;
      let connected = false;
      try {
        await gw.connect();
        connected = true;
        if (!alive) return;
        const listed = await gw.request<{ sessions: SessionRow[] }>("session.list", { profile, limit: 40 });
        if (alive) setSessions(listed.sessions);
        if (!selectedRef.current) {
          const active = await gw.request<{ sessions: Array<{ id: string; status: string; session_key?: string }> }>("session.active_list", { profile });
          const waiting = active.sessions.find(s => s.status === "waiting" && s.session_key);
          const recent = waiting ? null : await gw.request<{ session_id?: string | null }>("session.most_recent", { profile });
          if (alive && !selectedRef.current) setSelected(waiting?.session_key || recent?.session_id || "");
        }
      } catch (e) { if (alive) { setError(errorText(e)); if (!connected) retry(); } }
    };
    const offState = gw.onState(state => {
      if (!alive) return;
      setConnection(state);
      if (state === "open") setScreenGateway(gw);
      if (state === "closed" || state === "error") {
        setPrompts({});
        retry();
      }
    });
    const offEvents = gw.onEvent(ev => {
      if (ev.type === "request.cancel") {
        const id = (ev.payload as { id?: string } | undefined)?.id;
        if (id) setPrompts(prev => { const next = { ...prev }; delete next[id]; return next; });
      }
      setChat(prev => prev ? applyChatEvent(prev, ev) : prev);
      if (ev.type === "message.complete" || ev.type === "sessions.changed") {
        void gw.request<{ sessions: SessionRow[] }>("session.list", { profile, limit: 40 }).then(data => { if (alive) setSessions(data.sessions); }).catch(() => undefined);
      }
    });
    const offRequest = gw.onRequest((request: ServerRequest) => {
      if (!PROMPT_METHODS.has(request.method)) return false;
      setPrompts(prev => ({ ...prev, [request.id]: { request, profile } }));
      return true;
    });
    const onWake = () => { if (document.visibilityState === "visible") void connect(); };
    document.addEventListener("visibilitychange", onWake);
    window.addEventListener("online", onWake);
    void connect();
    return () => {
      alive = false;
      clearTimeout(timer);
      offState(); offEvents(); offRequest();
      document.removeEventListener("visibilitychange", onWake);
      window.removeEventListener("online", onWake);
      gw.close();
      if (client.current === gw) client.current = null;
      setScreenGateway(null);
    };
  }, [profile]);

  useEffect(() => { selectedRef.current = selected; }, [selected]);

  useEffect(() => {
    if (!profile || !selected || connection !== "open") return;
    if (skipResume.current === selected) { skipResume.current = ""; return; }
    let alive = true;
    setChat(null); setError("");
    void client.current?.request<SessionSnapshot>("session.resume", { profile, session_id: selected }).then(snapshot => {
      if (!alive) return;
      setChat({ runtimeId: snapshot.session_id, storedId: snapshot.stored_session_id || selected,
        rows: transcriptRows(snapshot.messages), draft: snapshot.inflight?.assistant || "", running: !!snapshot.running || !!snapshot.inflight?.streaming });
    }).catch(e => { if (alive) setError(errorText(e)); });
    return () => { alive = false; };
  }, [profile, selected, connection]);

  useEffect(() => { end.current?.scrollIntoView({ block: "end" }); }, [chat?.rows, chat?.draft]);

  const selectProfile = (name: string) => {
    if (!profiles.some(p => p.name === name)) return;
    selectedRef.current = "";
    setSessions([]); setSelected(""); setChat(null); setPrompts({}); setError("");
    const url = new URL(window.location.href);
    url.searchParams.set("profile", name);
    window.history.replaceState({}, "", url);
    setProfile(name);
  };

  const send = async (event: FormEvent) => {
    event.preventDefault();
    const message = text.trim();
    const gw = client.current;
    if (!message || !gw || connection !== "open" || busy || chat?.running) return;
    setBusy(true); setError("");
    let target = chat;
    try {
      if (!target) {
        const created = await gw.request<SessionSnapshot>("session.create", { profile, source: "mobile", close_on_disconnect: false });
        target = { runtimeId: created.session_id, storedId: created.stored_session_id || created.session_id, rows: [], draft: "", running: false };
        skipResume.current = target.storedId;
        setSelected(target.storedId);
        setChat(target);
        setSessions(prev => [{ id: target!.storedId, title: "New chat", preview: message }, ...prev]);
      }
      const runtimeId = target.runtimeId;
      setChat(prev => prev?.runtimeId === runtimeId ? { ...prev, running: true, rows: [...prev.rows, { role: "user", text: message }] } : prev);
      await gw.request("prompt.submit", { session_id: runtimeId, profile, text: message });
      setText("");
    } catch (e) { setError(errorText(e)); }
    finally { setBusy(false); }
  };

  const answer = useCallback((id: string, result: Record<string, unknown>) => {
    const prompt = prompts[id];
    if (!prompt || prompt.profile !== profile || connection !== "open") return;
    prompt.request.respond(result);
    setPrompts(prev => { const next = { ...prev }; delete next[id]; return next; });
  }, [prompts, profile, connection]);
  const received = useCallback((id: string) => {
    const prompt = Object.values(prompts).find(p => p.request.params.request_id === id);
    if (prompt && client.current) void client.current.request("approval.received", { profile, session_id: prompt.request.params.session_id, request_id: id }).catch(e => setError(errorText(e)));
  }, [prompts, profile]);
  const activePrompts = Object.values(prompts).filter(p => p.profile === profile);
  const currentPrompt = activePrompts[0];

  const togglePush = async () => {
    setBusy(true); setError("");
    try { if (pushEnabled) await unsubscribePush(); else await subscribePush(); setPushEnabled(!pushEnabled); }
    catch (e) { setError(errorText(e)); }
    finally { setBusy(false); }
  };
  useEffect(() => {
    if (!pushAvailable()) return;
    void navigator.serviceWorker.getRegistration(`${HERMES_BASE_PATH}/`).then(async reg => setPushEnabled(!!await reg?.pushManager.getSubscription())).catch(() => undefined);
  }, []);
  const logout = async () => {
    setBusy(true); setError("");
    try { await signOutMobile(); }
    catch (e) { setError(errorText(e)); setBusy(false); }
  };

  return <div className="m-shell">
    <header className="m-header"><strong>Hermes</strong><label>Bot<select aria-label="Bot profile" value={profile} onChange={e => selectProfile(e.target.value)}>{profiles.map(p => <option key={p.name} value={p.name}>{p.display_name || p.name}</option>)}</select></label><span role="status" className={connection === "open" ? "m-connected" : ""}>{connection}</span></header>
    {error && <div role="alert" className="m-error">{error}</div>}
    <main className="m-main">
      {view === "chat" && <>
        <div className="m-sessions"><label>Session<select aria-label="Session" value={selected} onChange={e => setSelected(e.target.value)}><option value="">New chat</option>{sessions.map(s => <option key={s.id} value={s.id}>{s.title || s.preview || s.id}</option>)}</select></label><button type="button" onClick={() => { setSelected(""); setChat(null); }}>New</button></div>
        <div className="m-messages" role="log" aria-live="polite">{!chat && <p className="m-muted">Choose a session or start a chat.</p>}{chat?.rows.map((row, index) => <article key={index} className={`m-message m-${row.role}`}><small>{row.role === "user" ? "You" : profile}</small><div className="m-preserve">{row.text}</div></article>)}{chat?.draft && <article className="m-message m-assistant"><small>{profile} · writing</small><div className="m-preserve">{chat.draft}</div></article>}{chat?.running && !chat.draft && <p role="status">Thinking…</p>}<div ref={end} /></div>
        <form className="m-composer" onSubmit={e => void send(e)}><textarea aria-label="Message" value={text} onChange={e => setText(e.target.value)} placeholder={`Message ${profile || "Hermes"}`} rows={2} /><div className="m-actions">{chat?.running && <button type="button" onClick={() => { void client.current?.request("session.interrupt", { profile, session_id: chat.runtimeId }).catch(e => setError(errorText(e))); }}>Stop</button>}<button type="submit" disabled={!text.trim() || busy || connection !== "open" || !!chat?.running}>Send</button></div></form>
      </>}
      {view === "board" && <MobileKanban />}
      {view === "screen" && <MobileScreen gateway={screenGateway} onContinue={async () => {
        const gw = client.current;
        if (!gw || !chat?.runtimeId || profile !== "samwise") throw new Error("Open Samwise's chat before continuing");
        const text = "I cleared the check; continue";
        if (chat.running) {
          const result = await gw.request<{ status: string }>("session.steer", { session_id: chat.runtimeId, profile, text });
          if (result.status === "rejected") await gw.request("prompt.submit", { session_id: chat.runtimeId, profile, text });
        } else await gw.request("prompt.submit", { session_id: chat.runtimeId, profile, text });
        setView("chat");
      }} />}
      {view === "settings" && <section className="m-settings"><h2>Phone settings</h2><p>Web Push works on an installed home-screen app over HTTPS. Notifications show generic text.</p><button type="button" disabled={!pushAvailable() || busy} onClick={() => void togglePush()}>{pushAvailable() ? (pushEnabled ? "Disable notifications" : "Enable notifications") : "Push unavailable in this browser"}</button><button type="button" disabled={busy} onClick={() => void logout()}>Sign out on this phone</button><p className="m-muted">Sign out ends only this browser session; it does not revoke other dashboard sessions.</p></section>}
    </main>
    <nav className="m-nav" aria-label="Mobile navigation"><button type="button" aria-current={view === "chat" ? "page" : undefined} onClick={() => setView("chat")}>Chat{activePrompts.length ? ` · ${activePrompts.length}` : ""}</button><button type="button" aria-current={view === "board" ? "page" : undefined} onClick={() => setView("board")}>Board</button>{profiles.some(p => p.name === "samwise") && <button type="button" aria-current={view === "screen" ? "page" : undefined} onClick={() => { if (profile !== "samwise") selectProfile("samwise"); setView("screen"); }}>Screen</button>}<button type="button" aria-current={view === "settings" ? "page" : undefined} onClick={() => setView("settings")}>Settings</button></nav>
    {currentPrompt && <div className="m-prompt-overlay" role="dialog" aria-modal="true" aria-label="Hermes needs input"><div className="m-prompt-meta">{currentPrompt.profile} · session {String(currentPrompt.request.params.session_id || "app")} · {activePrompts.length} pending</div><PromptCard key={currentPrompt.request.id} pending={currentPrompt} onAnswer={answer} onReceived={received} /></div>}
  </div>;
}
