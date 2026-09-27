import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { ArrowLeft, ArrowUp, Bell, BellOff, ChevronRight, LayoutGrid, LockKeyhole, Moon, Plus, Settings2, Square, Sun, Monitor, X } from "lucide-react";
import { toast, Toaster } from "sonner";
import type { ServerRequest } from "@hermes/shared";
import { api, HERMES_BASE_PATH, type ProfileInfo } from "@/lib/api";
import { GatewayClient } from "@/lib/gatewayClient";
import PromptCard from "./PromptCard";
import { Avatar, Badge, Button, Sheet, Skeleton, Textarea, Tooltip } from "./ui";
import MobileKanban from "./MobileKanban";
import MobileScreen from "./MobileScreen";
import { applyChatEvent, PROMPT_METHODS, transcriptRows, type MobileChat, type PendingPrompt } from "./mobile-state";
import { pushAvailable, registerMobileWorker, signOutMobile, subscribePush, unsubscribePush } from "./mobile-push";
import "./mobile-theme.css";
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
  const [view, setView] = useState<"bots" | "chat" | "board" | "screen" | "settings">(() => profileFromUrl() ? "chat" : "bots");
  const [activityOpen, setActivityOpen] = useState(false);
  const [theme, setTheme] = useState<"system" | "light" | "dark">(() => {
    const saved = window.localStorage?.getItem("hermes-mobile-theme");
    return saved === "light" || saved === "dark" ? saved : "system";
  });
  const [avatars, setAvatars] = useState<Record<string, string>>({});
  const [activity, setActivity] = useState<string[]>([]);
  const [working, setWorking] = useState("");
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [pushEnabled, setPushEnabled] = useState(false);
  const client = useRef<GatewayClient | null>(null);
  const [screenGateway, setScreenGateway] = useState<GatewayClient | null>(null);
  const skipResume = useRef("");
  const selectedRef = useRef("");
  const chatRef = useRef<MobileChat | null>(null);
  const end = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    window.localStorage?.setItem("hermes-mobile-theme", theme);
    const surface = document.querySelector<HTMLElement>(".m-shell");
    const background = surface && getComputedStyle(surface).getPropertyValue("--background").trim();
    if (background) document.querySelector('meta[name="theme-color"]')?.setAttribute("content", background);
  }, [theme]);

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
      if (ev.session_id === chatRef.current?.runtimeId) {
        if (ev.type === "tool.start") {
          const name = (ev.payload as { name?: unknown } | undefined)?.name;
          if (typeof name === "string" && /^[\w.-]{1,64}$/.test(name)) {
            const label = name.replaceAll("_", " ").replaceAll(".", " ");
            setWorking(`Using ${label}`);
            setActivity(prev => [`Used ${label}`, ...prev].slice(0, 12));
          }
        }
        if (ev.type === "message.complete") { setWorking(""); setActivity(prev => ["Finished a reply", ...prev].slice(0, 12)); }
        setChat(prev => prev ? applyChatEvent(prev, ev) : prev);
      }
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
  useEffect(() => { chatRef.current = chat; }, [chat]);
  useEffect(() => {
    if (connection !== "open" || !profiles.length) return;
    let alive = true;
    const gw = client.current;
    for (const p of profiles) {
      if (avatars[p.name]) continue;
      void gw?.request<{ found: boolean; data?: string }>("profiles.get_asset", { name: p.name, asset: "avatar" })
        .then(result => { if (alive && result.found && result.data?.startsWith("data:image/")) setAvatars(prev => ({ ...prev, [p.name]: result.data! })); })
        .catch(() => undefined);
    }
    return () => { alive = false; };
  }, [connection, profiles]);

  useEffect(() => {
    if (!profile || !selected || connection !== "open") return;
    if (skipResume.current === selected) { skipResume.current = ""; return; }
    let alive = true;
    setChat(null); setError("");
    void client.current?.request<SessionSnapshot>("session.resume", { profile, session_id: selected, source: "mobile", close_on_disconnect: false }).then(snapshot => {
      if (!alive) return;
      setChat({ runtimeId: snapshot.session_id, storedId: snapshot.stored_session_id || selected,
        rows: transcriptRows(snapshot.messages), draft: snapshot.inflight?.assistant || "", running: !!snapshot.running || !!snapshot.inflight?.streaming });
    }).catch(e => { if (alive) setError(errorText(e)); });
    return () => { alive = false; };
  }, [profile, selected, connection]);

  useEffect(() => { end.current?.scrollIntoView({ block: "end" }); }, [chat?.rows, chat?.draft, prompts]);

  const selectProfile = (name: string) => {
    if (!profiles.some(p => p.name === name)) return;
    if (name === profile) { setView("chat"); return; }
    selectedRef.current = "";
    chatRef.current = null;
    setSessions([]); setSelected(""); setChat(null); setPrompts({}); setError(""); setWorking(""); setActivity([]);
    const url = new URL(window.location.href);
    url.searchParams.set("profile", name);
    window.history.replaceState({}, "", url);
    setProfile(name);
    setView("chat");
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
        chatRef.current = target;
        setSelected(target.storedId);
        setChat(target);
        setSessions(prev => [{ id: target!.storedId, title: "New chat", preview: message }, ...prev]);
      }
      const runtimeId = target.runtimeId;
      setChat(prev => prev?.runtimeId === runtimeId ? { ...prev, running: true, rows: [...prev.rows, { role: "user", text: message }] } : prev);
      await gw.request("prompt.submit", { session_id: runtimeId, profile, text: message });
      setText("");
    } catch (e) { setError(errorText(e)); toast.error(errorText(e)); }
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
  const botName = (p: ProfileInfo) => p.display_name || (p.is_default ? "Frodo" : p.name[0].toUpperCase() + p.name.slice(1));
  const currentBot = profiles.find(p => p.name === profile);
  const name = currentBot ? botName(currentBot) : "Hermes";
  const avatar = (p: ProfileInfo) => <Avatar src={avatars[p.name]} name={botName(p)} />;
  const status = connection !== "open" ? "Reconnecting…" : activePrompts.length ? "Needs your input" : working || (chat?.running ? "Thinking…" : "Ready to talk");

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

  return <div key={theme} className="m-shell" data-theme={theme}>
    <Toaster theme={theme} position="top-center" richColors toastOptions={{ style: { background: "var(--card)", color: "var(--foreground)", borderColor: "var(--border)" } }} />
    {view === "bots" ? <>
      <header className="m-list-header"><span className="m-overline">HERMES</span><h1>Your bots</h1><p>A conversation with each of them.</p></header>
      {error && <p role="alert" className="m-error">{error}</p>}
      <main className="m-bot-list">
        <div className="m-section-title"><span>Conversations</span><span role="status" className={connection === "open" ? "m-online" : ""}>{connection === "open" ? "Connected" : "Reconnecting"}</span></div>
        {profiles.map(p => <button className="m-bot-row" type="button" key={p.name} onClick={() => selectProfile(p.name)}>
          {avatar(p)}<span className="m-bot-copy"><strong>{botName(p)}</strong><small>{p.name === profile && activePrompts.length ? `${activePrompts.length} request${activePrompts.length === 1 ? "" : "s"} waiting` : p.name === profile && sessions[0]?.preview ? sessions[0].preview : `Talk to ${botName(p)}`}</small></span><ChevronRight size={18} aria-hidden="true" />
        </button>)}
        {!profiles.length && <div className="m-loading" role="status" aria-label="Finding your bots"><Skeleton /><Skeleton /><Skeleton /></div>}
        <div className="m-section-title m-destinations-title">Explore</div>
        <button type="button" className="m-destination" onClick={() => setView("board")}><LayoutGrid size={20} aria-hidden="true" />Board<ChevronRight size={18} aria-hidden="true" /></button>
        {profiles.some(p => p.name === "samwise") && <button type="button" className="m-destination" onClick={() => { if (profile !== "samwise") selectProfile("samwise"); setView("screen"); }}><Monitor size={20} aria-hidden="true" />Screen<ChevronRight size={18} aria-hidden="true" /></button>}
        <button type="button" className="m-destination" onClick={() => setView("settings")}><Settings2 size={20} aria-hidden="true" />Settings<ChevronRight size={18} aria-hidden="true" /></button>
        {!!sessions.length && <section className="m-recent"><h2>Recent with {name}</h2>{sessions.map(s => <button type="button" key={s.id} onClick={() => { setSelected(s.id); setView("chat"); }}>{s.title || s.preview || "Conversation"}<ChevronRight size={16} aria-hidden="true" /></button>)}<button type="button" onClick={() => { setSelected(""); setChat(null); setView("chat"); }}><Plus size={17} aria-hidden="true" />New conversation</button></section>}
      </main>
    </> : <>
      <header className="m-header"><button type="button" className="m-icon-button" aria-label="Back to bots" onClick={() => setView("bots")}><ArrowLeft size={22} /></button>
        {view === "chat" && currentBot ? <><button type="button" className="m-avatar-button" aria-label={`Open ${name} activity`} onClick={() => setActivityOpen(true)}>{avatar(currentBot)}</button><div className="m-identity"><strong>{name}</strong><span role="status"><i className="m-status-dot" />{status}</span></div></> : <strong className="m-page-title">{{ board: "Board", screen: "Screen", settings: "Settings", bots: "Bots", chat: name }[view]}</strong>}
      </header>
      {error && <p role="alert" className="m-error">{error}</p>}
      <main className="m-main">
        {view === "chat" && <>
          <div className="m-messages" role="log" aria-live="polite">
            {!chat && !activePrompts.length && <div className="m-empty"><span className="m-empty-avatar">{currentBot && avatar(currentBot)}</span><p>Start a conversation with {name}.</p></div>}
            {chat?.rows.map((row, index) => <article key={index} className={`m-message m-${row.role}`}><div className="m-preserve">{row.text}</div></article>)}
            {chat?.draft && <article className="m-message m-assistant"><div className="m-preserve">{chat.draft}</div></article>}
            {activePrompts.map(p => <div className="m-inline-request" key={p.request.id}><Badge className="m-request-label">{name} needs your input</Badge><PromptCard pending={p} onAnswer={answer} onReceived={received} /></div>)}
            {chat?.running && !chat.draft && !activePrompts.length && <p role="status" className="m-thinking"><i className="m-status-dot" />{status}</p>}
            <div ref={end} />
          </div>
          <form className="m-composer" onSubmit={e => void send(e)}><Textarea aria-label="Message" value={text} onChange={e => setText(e.target.value)} placeholder={`Message ${name}…`} rows={1} />
            {chat?.running ? <Button type="button" variant="secondary" size="icon" className="m-stop" aria-label="Stop" onClick={() => { void client.current?.request("session.interrupt", { profile, session_id: chat.runtimeId }).catch(e => setError(errorText(e))); }}><Square size={16} fill="currentColor" /></Button>
              : <Button type="submit" variant="primary" size="icon" className="m-send" aria-label="Send" disabled={!text.trim() || busy || connection !== "open"}><ArrowUp size={20} /></Button>}
          </form>
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
        {view === "settings" && <section className="m-settings"><h2>Make it yours</h2><p>Only what you need, when you need it.</p>
          <div className="m-settings-group"><h3>Appearance</h3><div className="m-theme-choices" role="group" aria-label="Appearance">{(["system", "light", "dark"] as const).map(choice => <Button key={choice} type="button" variant={theme === choice ? "outline" : "secondary"} aria-pressed={theme === choice} onClick={() => setTheme(choice)}>{choice === "system" ? <Monitor size={17} /> : choice === "light" ? <Sun size={17} /> : <Moon size={17} />}{choice[0].toUpperCase() + choice.slice(1)}</Button>)}</div></div>
          <div className="m-settings-group"><h3>Notifications</h3><p>When a bot needs you, notifications keep the details private.</p><button className="m-setting-action" type="button" disabled={!pushAvailable() || busy} onClick={() => void togglePush()}>{pushEnabled ? <BellOff size={19} /> : <Bell size={19} />}{pushAvailable() ? (pushEnabled ? "Turn off notifications" : "Turn on notifications") : "Unavailable in this browser"}<ChevronRight size={17} /></button></div>
          <div className="m-settings-group"><h3>Account</h3><button className="m-setting-action" type="button" disabled={busy} onClick={() => void logout()}><LockKeyhole size={19} />Sign out on this phone<ChevronRight size={17} /></button><p className="m-muted">Other devices stay signed in.</p></div>
        </section>}
      </main>
    </>}
    {activityOpen && <Sheet open={activityOpen} onClose={() => setActivityOpen(false)} label={`${name} activity`}>
      <div className="m-activity-head"><h2>{name}'s activity</h2><Tooltip label="Close activity"><Button type="button" variant="ghost" size="icon" aria-label="Close activity" onClick={() => setActivityOpen(false)}><X size={21} /></Button></Tooltip></div>
      <p className="m-activity-now"><i className="m-status-dot" />{status}</p>
      {activity.length ? <ul>{activity.map((item, index) => <li key={index}>{item}</li>)}</ul> : <p className="m-muted">New activity will appear here while this chat is open.</p>}
    </Sheet>}
  </div>;
}
