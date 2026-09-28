import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type FormEvent, type ReactNode } from "react";
import { useLocation, useNavigate } from "react-router";
import { AnimatePresence, motion, motionValue, useReducedMotion } from "motion/react";
import { Markdown } from "@/components/Markdown";
import { useChatScroll } from "./useChatScroll";
import { useMobileDictation } from "./useMobileDictation";
import { isIOSDevice, useStandaloneSwipeBack } from "./useStandaloneSwipeBack";
import { ArrowDown, ArrowLeft, ArrowUp, Bell, BellOff, ChevronRight, Copy, FileUp, ImagePlus, LoaderCircle, LockKeyhole, MessageSquare, Mic, Moon, MoreHorizontal, Pin, Plus, Search, Square, Sun, Monitor, ThumbsUp, X } from "lucide-react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { ProfileDropdown } from "./ProfileDropdown";
import { useComposerSuggestions } from "./ComposerSuggestions";
import { toast, Toaster } from "sonner";
import type { ServerRequest } from "@hermes/shared";
import { api, HERMES_BASE_PATH, type AuthMeResponse, type ProfileInfo, type SessionMessage } from "@/lib/api";
import { sideConversations, type Conversation } from "./conversations";
import { GatewayClient } from "@/lib/gatewayClient";
import PromptCard from "./PromptCard";
import { Avatar, Badge, Button, Sheet, Skeleton, Textarea, Tooltip } from "./ui";
import MobileKanban from "./MobileKanban";
import MobileScreen from "./MobileScreen";
import MobileMessage from "./MobileMessage";
import { groupNoticeRows } from "./message-kind";
import { uploadChatImage } from "@/lib/chatImagePaste";
import { applyChatEvent, PROMPT_METHODS, transcriptRows, type ChatRow, type MobileChat, type PendingPrompt } from "./mobile-state";
import { pushAvailable, registerMobileWorker, signOutMobile, subscribePush, unsubscribePush } from "./mobile-push";
import { appendLive, HISTORY_PAGE_SIZE, historyPage, prependOlder } from "./history";
import { chatPath, mobileRoute, taskPath, type MobileView } from "./mobile-routes";
import { activityTime, orderedBots, PIN_STORAGE_KEY, savedPins, type BotActivity } from "./home-data";
import "./mobile-theme.css";
import "./mobile.css";

interface CanonicalChat { id: string; resolved_id: string; preview: string; last_active: number }
interface Roster { profiles: Array<{ name: string; canonical_session?: CanonicalChat | null }> }
interface LiveSession { id: string; session_key: string; title: string; preview?: string; status: string; last_active?: number }
interface SessionSnapshot {
  session_id: string;
  stored_session_id?: string;
  messages: Array<{ role: string; text?: string | null; display_kind?: string | null; timestamp?: number }>;
  running?: boolean;
  inflight?: { assistant?: string; user?: string; streaming?: boolean } | null;
}
const errorText = (error: unknown) => error instanceof Error ? error.message : String(error);
const profileFromUrl = () => new URLSearchParams(window.location.search).get("profile") || "";
const chatKey = (profile: string, session: string) => `${profile}/${session}`;
const displayRows = (messages: SessionMessage[]) => transcriptRows(messages.map(m => ({
  role: m.role, text: (m as SessionMessage & { display_content?: string }).display_content ?? m.content, timestamp: m.timestamp,
})));
const previewText = (text: string) => {
  const plain = text.replace(/>>>|<<</g, "").replace(/^\s{0,3}(?:#{1,6}\s+|[-*]\s+)/gm, "").replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/\bt_?[a-f\d]{8,}\b/gi, "").replace(/[*_`]/g, "").replace(/\s+/g, " ").replace(/\s+([.,;:!?])/g, "$1").trim();
  return plain.length > 42 ? `${plain.slice(0, 42).replace(/\s+\S*$/, "").trimEnd()}…` : plain;
};
const humanPreview = (text: string) => !!previewText(text) && !/^\s*(?:work kanban task\s+t_?[a-f\d]{6,}|window:\s*\d{4}-\d{2}-\d{2})/i.test(text);
const latestPreview = (rows: MobileChat["rows"]) => previewText([...rows].reverse().find(row => humanPreview(row.text))?.text || "");

function MobileListRow({ leading, title, preview, onClick, className = "", onWarm, current = false }: {
  leading: ReactNode; title: string; preview?: string; onClick: () => void; className?: string; onWarm?: () => void; current?: boolean;
}) {
  return <button type="button" className={`m-list-row ${className}`} aria-current={current ? "page" : undefined} onClick={onClick} onTouchStart={onWarm} onMouseEnter={onWarm}>
    <span className="m-list-leading">{leading}</span>
    <span className="m-list-copy"><strong>{title}</strong>{preview && <small>{preview}</small>}</span>
    <ChevronRight size={18} aria-hidden="true" />
  </button>;
}

export default function MobileApp() {
  const location = useLocation();
  const routerNavigate = useNavigate();
  const route = mobileRoute(location.pathname);
  const view = route.view;
  const [desktop, setDesktop] = useState(() => window.matchMedia("(min-width: 900px)").matches);
  useEffect(() => {
    const media = window.matchMedia("(min-width: 900px)");
    const update = () => setDesktop(media.matches);
    media.addEventListener("change", update);
    update();
    return () => media.removeEventListener("change", update);
  }, []);
  const [profiles, setProfiles] = useState<ProfileInfo[]>([]);
  const [profile, setProfile] = useState(() => route.profile || "");
  const [sessions, setSessions] = useState<Conversation[]>([]);
  const [liveSessions, setLiveSessions] = useState<LiveSession[]>([]);
  const [selected, setSelected] = useState(() => route.session === "new" ? "" : route.session || "");
  const [chat, setChat] = useState<MobileChat | null>(null);
  const [photos, setPhotos] = useState<Array<{ file: File; preview: string }>>([]);
  const [files, setFiles] = useState<File[]>([]);
  const photoInput = useRef<HTMLInputElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const composerInput = useRef<HTMLTextAreaElement>(null);
  const [cursor, setCursor] = useState(0);
  const photosRef = useRef(photos);
  useEffect(() => { photosRef.current = photos; }, [photos]);
  useEffect(() => () => { for (const photo of photosRef.current) URL.revokeObjectURL(photo.preview); }, []);
  const clearPhotos = () => { for (const photo of photosRef.current) URL.revokeObjectURL(photo.preview); setPhotos([]); };
  const cache = useRef(new Map<string, MobileChat>());
  const pages = useRef(new Map<string, { offset: number; hasOlder: boolean }>());
  const [paging, setPaging] = useState({ key: "", offset: 0, hasOlder: false, loading: false, error: "" });
  const latest = useRef(new Map<string, BotActivity>());
  const canonical = useRef(new Map<string, CanonicalChat>());
  const warming = useRef(new Map<string, Promise<void>>());
  const [activityByBot, setActivityByBot] = useState<Record<string, BotActivity>>({});
  const [waitingByBot, setWaitingByBot] = useState<Record<string, LiveSession>>({});
  const [pins, setPins] = useState(() => savedPins(window.localStorage));
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const [newChatOpen, setNewChatOpen] = useState(false);
  const [messageAction, setMessageAction] = useState<{ text: string; key: string } | null>(null);
  const [reactions, setReactions] = useState<Record<string, boolean>>(() => {
    try { return JSON.parse(window.localStorage.getItem("hermes-mobile-reactions") || "{}"); } catch { return {}; }
  });
  const reactionKey = (role: string, timestamp: number | undefined, text: string) => JSON.stringify([profile, selected, role, timestamp, text.slice(0, 120)]);
  const toggleReaction = (key: string) => setReactions(current => {
    const next = { ...current }; if (next[key]) delete next[key]; else next[key] = true;
    window.localStorage.setItem("hermes-mobile-reactions", JSON.stringify(next));
    return next;
  });
  const [pinMenu, setPinMenu] = useState("");
  const pinTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pinTriggered = useRef(false);
  const startPinPress = (name: string) => {
    clearTimeout(pinTimer.current ?? undefined);
    pinTriggered.current = false;
    pinTimer.current = setTimeout(() => { pinTriggered.current = true; setPinMenu(name); }, 550);
  };
  const stopPinPress = () => { clearTimeout(pinTimer.current ?? undefined); pinTimer.current = null; };
  const pinClick = (name: string) => {
    if (pinTriggered.current) { pinTriggered.current = false; return; }
    void selectProfile(name);
  };
  const pinKey = (event: React.KeyboardEvent, name: string) => {
    if (event.key === "ContextMenu" || event.key === "F10" && event.shiftKey) {
      event.preventDefault(); setPinMenu(name);
    }
  };
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<Array<{ profile: string; session: string; title: string; preview: string; pinned: boolean }>>([]);
  const [searchError, setSearchError] = useState("");
  const listScroll = useRef(0);
  const listRef = useRef<HTMLElement>(null);
  const boardScroll = useRef(0);
  const getBoardScroll = useCallback(() => boardScroll.current, []);
  const setBoardScroll = useCallback((top: number) => { boardScroll.current = top; }, []);
  const [prompts, setPrompts] = useState<Record<string, PendingPrompt>>({});
  const [connection, setConnection] = useState("connecting");
  const skipBackAnimation = useRef(false);
  const swipeSource = useRef<Exclude<MobileView, "bots">>("chat");
  const [offsets] = useState(() => ({
    chat: motionValue<number | string>(0), board: motionValue<number | string>(0),
    screen: motionValue<number | string>(0), settings: motionValue<number | string>(0),
  }));
  const panX = view === "bots" ? offsets.chat : offsets[view];
  const reducedMotion = useReducedMotion();
  const navigate = (next: MobileView, targetProfile = profile, targetSession = selected) => {
    const path = next === "chat" ? chatPath(targetProfile, targetSession) : next === "bots" ? "/m" : `/m/${next}`;
    routerNavigate(path);
  };
  const shellRef = useRef<HTMLDivElement>(null);
  const goBack = useCallback(() => {
    if (window.history.state?.idx > 0) window.history.back();
    else routerNavigate(view === "board" && route.task ? "/m/board" : "/m");
  }, [routerNavigate, view, route.task]);
  const [activityOpen, setActivityOpen] = useState(false);
  const [conversationsOpen, setConversationsOpen] = useState(false);
  const [archivedOpen, setArchivedOpen] = useState(false);
  const [archivedSessions, setArchivedSessions] = useState<Conversation[]>([]);
  const [conversationAction, setConversationAction] = useState<Conversation | null>(null);
  const [conversationTitle, setConversationTitle] = useState("");
  const [conversationBusy, setConversationBusy] = useState(false);
  const [conversationError, setConversationError] = useState("");
  const { swiping, preview: swipePreview, finish: finishSwipe } = useStandaloneSwipeBack(shellRef, view, goBack, !desktop && !activityOpen && !conversationsOpen && !profileMenuOpen && !newChatOpen && !pinMenu, panX, () => { skipBackAnimation.current = true; if (view !== "bots") swipeSource.current = view; });
  useEffect(() => {
    let edge: { x: number; y: number } | null = null;
    let lastEdgeSwipe = 0;
    const start = (event: TouchEvent) => {
      const touch = event.touches[0];
      edge = touch && event.touches.length === 1 && touch.clientX < 24 ? { x: touch.clientX, y: touch.clientY } : null;
      lastEdgeSwipe = 0;
    };
    const move = (event: TouchEvent) => {
      const touch = event.touches[0];
      if (edge && touch && touch.clientX - edge.x > 40 && Math.abs(touch.clientY - edge.y) < touch.clientX - edge.x) lastEdgeSwipe = performance.now();
    };
    const end = () => { edge = null; };
    const pop = (event: PopStateEvent) => {
      // Safari already slid its history snapshot. Older WebKit may omit the marker.
      const uaTransition = (event as PopStateEvent & { hasUAVisualTransition?: boolean }).hasUAVisualTransition;
      if (uaTransition === true || (uaTransition === undefined && isIOSDevice() && lastEdgeSwipe > 0 && performance.now() - lastEdgeSwipe < 700)) {
        skipBackAnimation.current = true;
        if (view !== "bots") swipeSource.current = view;
      }
      lastEdgeSwipe = 0;
    };
    window.addEventListener("touchstart", start, { capture: true, passive: true });
    window.addEventListener("touchmove", move, { capture: true, passive: true });
    window.addEventListener("touchend", end, true);
    window.addEventListener("touchcancel", end, true);
    window.addEventListener("popstate", pop, true); // Before React Router renders the destination.
    return () => {
      window.removeEventListener("touchstart", start, true);
      window.removeEventListener("touchmove", move, true);
      window.removeEventListener("touchend", end, true);
      window.removeEventListener("touchcancel", end, true);
      window.removeEventListener("popstate", pop, true);
    };
  }, [view]);
  useLayoutEffect(() => {
    if (swiping) {
      const list = swipePreview.current?.querySelector<HTMLElement>(".m-bot-list");
      if (list) list.scrollTop = listScroll.current;
    }
  }, [swiping, swipePreview]);
  useLayoutEffect(() => {
    if ((view === "bots" || desktop) && listRef.current) listRef.current.scrollTop = listScroll.current;
  }, [view, desktop]);
  useEffect(() => {
    if (route.view !== "chat" || !route.profile) return;
    const sid = route.session === "new" ? "" : route.session || "";
    if (route.profile !== profile) { setProfile(route.profile); setConnection("connecting"); }
    if (sid !== selected) setSelected(sid);
    setChat(cache.current.get(chatKey(route.profile, sid)) ?? null);
    const page = pages.current.get(chatKey(route.profile, sid));
    setPaging({ key: chatKey(route.profile, sid), offset: page?.offset ?? 0, hasOlder: page?.hasOlder ?? false, loading: false, error: "" });
  }, [location.pathname]);
  useEffect(() => {
    if (view !== "screen") return;
    const target = route.profile || "samwise";
    if (profile !== target && profiles.some(p => p.name === target)) {
      setProfile(target); setSelected(latest.current.get(target)?.session || "");
      setConnection("connecting");
    } else if (!selected) {
      const id = canonical.current.get(profile)?.resolved_id || canonical.current.get(profile)?.id;
      if (id) setSelected(id);
    }
  }, [view, route.profile, profile, profiles, selected]);
  const [theme, setTheme] = useState<"system" | "light" | "dark">(() => {
    const saved = window.localStorage?.getItem("hermes-mobile-theme");
    return saved === "light" || saved === "dark" ? saved : "system";
  });
  const [avatars, setAvatars] = useState<Record<string, string>>({});
  const [account, setAccount] = useState<AuthMeResponse | null>(null);
  useEffect(() => {
    if (!window.__HERMES_AUTH_REQUIRED__) return;
    let active = true;
    void api.getAuthMe().then(me => { if (active) setAccount(me); }).catch(() => {});
    return () => { active = false; };
  }, []);
  const [activity, setActivity] = useState<string[]>([]);
  const [working, setWorking] = useState("");
  const runningTools = useRef(new Map<string, string>());
  const toolTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [text, setText] = useState("");
  const voice = useMobileDictation(profile, `${view}/${selected}`, transcript => setText(previous => `${previous.trimEnd()}${previous.trim() ? " " : ""}${transcript}`));
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [pushEnabled, setPushEnabled] = useState(false);
  const client = useRef<GatewayClient | null>(null);
  const [screenGateway, setScreenGateway] = useState<GatewayClient | null>(null);
  const skipResume = useRef("");
  const selectedRef = useRef(route.session && route.session !== "new" ? route.session : "");
  const chatRef = useRef<MobileChat | null>(null);

  useEffect(() => {
    window.localStorage?.setItem("hermes-mobile-theme", theme);
    const metas = document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]');
    const sync = () => {
      const colors = theme === "system" ? ["#ffffff", "#0a0a0a"] : [theme === "dark" ? "#0a0a0a" : "#ffffff"];
      metas.forEach((meta, index) => meta.content = colors[index] ?? colors[0]);
    };
    sync();
  }, [theme]);

  const warmProfile = (name: string) => {
    const inFlight = warming.current.get(name);
    if (inFlight) return inFlight;
    const session = canonical.current.get(name);
    if (!session) return Promise.resolve();
    const id = session.resolved_id || session.id;
    if (cache.current.has(chatKey(name, id))) return Promise.resolve();
    const work = (async () => {
      const result = await api.getSessionMessages(id, name, historyPage());
      const rows = displayRows(result.messages);
      const entry = { session: id, preview: latestPreview(rows) || previewText(session.preview || ""), lastActive: session.last_active || 0 };
      latest.current.set(name, entry);
      const key = chatKey(name, id);
      if (!cache.current.get(key)?.runtimeId) {
        cache.current.set(key, { runtimeId: "", storedId: id, rows, draft: "", running: false });
        pages.current.set(key, { offset: result.messages.length, hasOlder: !!result.pagination && result.messages.length === HISTORY_PAGE_SIZE });
      }
      setActivityByBot(prev => ({ ...prev, [name]: entry }));
    })().finally(() => warming.current.delete(name));
    warming.current.set(name, work);
    return work;
  };
  const refreshConversations = async () => {
    const data = await api.getAllProfileSessions();
    setSessions(sideConversations(data.sessions, 200));
  };
  const refreshArchived = async () => {
    const data = await api.getAllProfileSessions(200, "only");
    setArchivedSessions(sideConversations(data.sessions, 200));
  };
  useEffect(() => {
    if (conversationsOpen && archivedOpen) void refreshArchived().catch(e => setConversationError(errorText(e)));
  }, [conversationsOpen, archivedOpen]);
  const changeConversation = async (action: "rename" | "archive" | "pin") => {
    if (!conversationAction || conversationBusy) return;
    const target = conversationAction;
    const title = conversationTitle.trim();
    if (action === "rename" && (!title || title === target.title)) return;
    setConversationBusy(true); setConversationError("");
    try {
      if (action === "rename") await api.renameSession(target.id, title, target.profile);
      else if (action === "archive") await api.setSessionArchived(target.id, !archivedOpen, target.profile);
      else await api.setSessionPinned(target.id, !target.pinned, target.profile);
      await Promise.all([refreshConversations(), refreshArchived()]);
      setConversationAction(null);
      if (action === "archive" && !archivedOpen && profile === target.profile && selected === target.id) {
        setConversationsOpen(false); navigate("bots");
      }
      const feedback = { rename: "Conversation renamed", pin: target.pinned ? "Conversation unpinned" : "Conversation pinned", archive: archivedOpen ? "Conversation restored" : "Conversation archived" };
      toast.success(feedback[action]);
    } catch (e) { setConversationError(errorText(e)); }
    finally { setConversationBusy(false); }
  };
  const refreshRoster = async (gw: GatewayClient) => {
    const roster = await gw.request<Roster>("profiles.list", { include_sessions: true });
    for (const bot of roster.profiles) {
      if (!bot.canonical_session) {
        canonical.current.delete(bot.name); latest.current.delete(bot.name);
        setActivityByBot(prev => { const next = { ...prev }; delete next[bot.name]; return next; });
        continue;
      }
      const session = bot.canonical_session;
      canonical.current.set(bot.name, session);
      const entry = { session: session.resolved_id || session.id, preview: previewText(session.preview || ""), lastActive: session.last_active || 0 };
      latest.current.set(bot.name, entry);
      setActivityByBot(prev => ({ ...prev, [bot.name]: entry }));
      const open = mobileRoute(window.location.pathname);
      if (!(open.view === "chat" && open.profile === bot.name && open.session === entry.session)) void warmProfile(bot.name).catch(() => undefined);
    }
    return roster;
  };

  useEffect(() => {
    let alive = true;
    void api.getProfiles().then(data => {
      if (!alive) return;
      setProfiles(data.profiles);
      const wanted = route.profile || profileFromUrl();
      const initial = data.profiles.find(p => p.name === wanted)?.name ?? data.profiles.find(p => p.is_default)?.name ?? data.profiles[0]?.name ?? "";
      setProfile(initial);
    }).catch(e => { if (alive) setError(errorText(e)); });
    if ("serviceWorker" in navigator) void registerMobileWorker().catch(() => undefined);
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    if (!searchOpen || !searchQuery.trim()) return;
    let alive = true;
    const timer = window.setTimeout(async () => {
      try {
        const query = searchQuery.trim().toLowerCase();
        const visible = new Map(sessions.map(row => [`${row.profile}/${row.id}`, row]));
        const found = new Map<string, { profile: string; session: string; title: string; preview: string; time: number; pinned: boolean }>();
        for (const row of sessions) {
          if (`${row.title} ${row.preview}`.toLowerCase().includes(query)) found.set(`${row.profile}/${row.id}`, {
            profile: row.profile, session: row.id, title: row.title, preview: previewText(row.preview), time: row.lastActive, pinned: row.pinned,
          });
        }
        let cursor = 0;
        const worker = async () => {
          while (cursor < profiles.length) {
            const bot = profiles[cursor++];
            const response = await api.searchSessions(searchQuery.trim(), bot.name);
            for (const row of response.results) {
              const stored = visible.get(`${bot.name}/${row.session_id}`);
              if (stored) found.set(`${bot.name}/${stored.id}`, { profile: bot.name, session: stored.id,
                title: stored.title, preview: previewText(row.snippet || stored.preview), time: stored.lastActive, pinned: stored.pinned });
            }
          }
        };
        await Promise.all(Array.from({ length: Math.min(3, profiles.length) }, () => worker()));
        if (alive) { setSearchResults([...found.values()].sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.time - a.time)); setSearchError(""); }
      } catch (e) { if (alive) setSearchError(errorText(e)); }
    }, 250);
    return () => { alive = false; clearTimeout(timer); };
  }, [searchOpen, searchQuery, profiles, sessions]);

  useEffect(() => {
    window.localStorage?.setItem(PIN_STORAGE_KEY, JSON.stringify(pins));
  }, [pins]);

  useEffect(() => {
    if (!profiles.length) return;
    void refreshConversations().catch(e => setError(errorText(e)));
  }, [profiles]);

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
    const refreshLiveSessions = () => void gw.request<{ sessions: LiveSession[] }>("session.active_list", { profile })
      .then(data => { if (alive) setLiveSessions(data.sessions); }).catch(() => undefined);
    const connect = async () => {
      if (!alive || gw.connectionState === "connecting" || gw.connectionState === "open") return;
      let connected = false;
      try {
        await gw.connect();
        connected = true;
        if (!alive) return;
        await refreshRoster(gw);
        if (view === "screen" && !selectedRef.current) {
          const id = canonical.current.get(profile)?.resolved_id || canonical.current.get(profile)?.id;
          if (id && alive) setSelected(id);
        }
        if (profileFromUrl() && !route.profile) {
          const id = canonical.current.get(profile)?.resolved_id || canonical.current.get(profile)?.id || "new";
          if (alive) routerNavigate(chatPath(profile, id), { replace: true });
        }
        const active = await gw.request<{ sessions: LiveSession[] }>("session.active_list", { profile });
        if (alive) setLiveSessions(active.sessions);
      } catch (e) { if (alive) { setError(errorText(e)); if (!connected) retry(); } }
    };
    const offState = gw.onState(state => {
      if (!alive) return;
      setConnection(state);
      if (state === "open") setScreenGateway(gw);
      if (state === "closed" || state === "error") {
        for (const [key, value] of cache.current) if (key.startsWith(`${profile}/`)) cache.current.set(key, { ...value, runtimeId: "" });
        setPrompts({});
        setLiveSessions([]);
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
          const { name, tool_id } = (ev.payload || {}) as { name?: unknown; tool_id?: unknown };
          if (typeof name === "string" && /^[\w.-]{1,64}$/.test(name) && typeof tool_id === "string") {
            if (toolTimer.current) clearTimeout(toolTimer.current);
            const label = name.replaceAll("_", " ").replaceAll(".", " ");
            runningTools.current.set(tool_id, `Using ${label}`);
            setWorking(`Using ${label}`);
            setActivity(prev => [`Used ${label}`, ...prev].slice(0, 12));
          }
        }
        if (ev.type === "tool.complete") {
          const id = (ev.payload as { tool_id?: unknown } | undefined)?.tool_id;
          if (typeof id === "string" && runningTools.current.delete(id)) {
            const active = [...runningTools.current.values()].at(-1);
            if (active) setWorking(active);
            else toolTimer.current = setTimeout(() => { toolTimer.current = null; setWorking(""); }, 450);
          }
        }
        if (ev.type === "message.start" || ev.type === "message.complete") {
          if (toolTimer.current) clearTimeout(toolTimer.current);
          runningTools.current.clear(); setWorking("");
        }
        if (ev.type === "message.complete") setActivity(prev => ["Finished a reply", ...prev].slice(0, 12));
        setChat(prev => {
          if (!prev) return prev;
          const next = applyChatEvent(prev, ev);
          if (next !== prev) cache.current.set(chatKey(profile, next.storedId), next);
          return next;
        });
      }
      if (ev.type === "message.complete" || ev.type === "sessions.changed") {
        void refreshRoster(gw).catch(() => undefined);
        void refreshConversations().catch(() => undefined);
        refreshLiveSessions();
      }
    });
    const offRequest = gw.onRequest((request: ServerRequest) => {
      if (!PROMPT_METHODS.has(request.method)) return false;
      setPrompts(prev => ({ ...prev, [request.id]: { request, profile } }));
      refreshLiveSessions();
      return true;
    });
    const onWake = () => { if (document.visibilityState === "visible") void connect(); };
    document.addEventListener("visibilitychange", onWake);
    window.addEventListener("online", onWake);
    void connect();
    return () => {
      alive = false;
      clearTimeout(timer);
      if (toolTimer.current) clearTimeout(toolTimer.current);
      runningTools.current.clear();
      offState(); offEvents(); offRequest();
      document.removeEventListener("visibilitychange", onWake);
      window.removeEventListener("online", onWake);
      gw.close();
      if (client.current === gw) client.current = null;
      setScreenGateway(null);
    };
  }, [profile]);

  useEffect(() => {
    if (connection !== "open" || !profiles.length || !client.current) return;
    let alive = true;
    const gateway = client.current;
    const refresh = async () => {
      if (document.visibilityState !== "visible") return;
      void refreshRoster(gateway).catch(() => undefined);
      void refreshConversations().catch(() => undefined);
      const next: Record<string, LiveSession> = {};
      await Promise.all(profiles.map(async bot => {
        try {
          const result = await gateway.request<{ sessions: LiveSession[] }>("session.active_list", { profile: bot.name });
          const waiting = result.sessions.filter(s => s.status === "waiting" && s.session_key).sort((a, b) => (b.last_active || 0) - (a.last_active || 0))[0];
          if (waiting) next[bot.name] = waiting;
        } catch { /* A disconnected bot has no authoritative pending state. */ }
      }));
      if (alive) setWaitingByBot(next);
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 15000);
    document.addEventListener("visibilitychange", refresh);
    return () => { alive = false; clearInterval(timer); document.removeEventListener("visibilitychange", refresh); };
  }, [connection, profile, profiles]);

  useEffect(() => { selectedRef.current = selected; }, [selected]);
  useEffect(() => {
    if (toolTimer.current) clearTimeout(toolTimer.current);
    runningTools.current.clear();
    setWorking("");
  }, [selected]);
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
    if (!profile || !selected || connection !== "open" || (view !== "chat" && view !== "screen") || (route.profile && route.profile !== profile)) return;
    if (skipResume.current === selected) { skipResume.current = ""; return; }
    const key = chatKey(profile, selected);
    const cached = cache.current.get(key);
    if (cached?.runtimeId && cached.runtimeId === chat?.runtimeId) return;
    let alive = true;
    if (cached) setChat(cached);
    else setChat(null);
    setError("");
    const prior = pages.current.get(key);
    setPaging({ key, offset: prior?.offset ?? 0, hasOlder: prior?.hasOlder ?? false, loading: true, error: "" });
    void client.current?.request<SessionSnapshot>("session.resume", { profile, session_id: selected, source: "mobile", close_on_disconnect: false, omit_messages: true, defer_history: true }).then(async snapshot => {
      if (!alive) return;
      const baseRows = cached?.rows ?? [];
      const next: MobileChat = { runtimeId: snapshot.session_id, storedId: snapshot.stored_session_id || selected,
        rows: baseRows, draft: snapshot.inflight?.assistant || "", running: !!snapshot.running || !!snapshot.inflight?.streaming };
      cache.current.set(key, next);
      setChat(next);
      try {
        const page = await api.getSessionMessages(selected, profile, historyPage());
        if (!alive) return;
        const tail = displayRows(page.messages);
        const info = { offset: page.messages.length, hasOlder: !!page.pagination && page.messages.length === HISTORY_PAGE_SIZE };
        pages.current.set(key, info);
        setPaging({ key, ...info, loading: false, error: "" });
        setChat(prev => {
          if (prev?.runtimeId !== snapshot.session_id) return prev;
          const rows = appendLive(tail, prev.rows.slice(baseRows.length));
          const updated = { ...prev, rows };
          cache.current.set(key, updated);
          return updated;
        });
      } catch (e) {
        if (alive) setPaging(prev => ({ ...prev, loading: false, error: errorText(e) }));
      }
    }).catch(e => { if (alive) { setPaging(prev => ({ ...prev, loading: false, error: "" })); setError(errorText(e)); } });
    return () => { alive = false; };
  }, [profile, selected, connection, view, route.profile]);

  const { container: messagesRef, atBottom, onScroll, scrollToLatest, preserveOnPrepend, userScrolled } = useChatScroll(`${profile}/${selected}`, `${chat?.rows.length || 0}:${chat?.draft || ""}:${Object.keys(prompts).join(",")}`, view === "chat");
  const loadOlder = async () => {
    const key = chatKey(profile, selected);
    if (paging.key !== key || !paging.hasOlder || paging.loading || !chat) return;
    const offset = paging.offset;
    setPaging(prev => ({ ...prev, loading: true, error: "" }));
    try {
      const page = await api.getSessionMessages(selected, profile, historyPage(offset));
      if (chatKey(profile, selectedRef.current) !== key) return;
      const older = displayRows(page.messages);
      const current = chatRef.current;
      if (current?.storedId === chat.storedId && prependOlder(older, current.rows).length > current.rows.length) preserveOnPrepend();
      setChat(prev => {
        if (!prev || prev.storedId !== chat.storedId) return prev;
        const next = { ...prev, rows: prependOlder(older, prev.rows) };
        cache.current.set(key, next);
        return next;
      });
      const info = { offset: offset + page.messages.length, hasOlder: !!page.pagination && page.messages.length === HISTORY_PAGE_SIZE };
      pages.current.set(key, info);
      setPaging({ key, ...info, loading: false, error: "" });
    } catch (e) {
      setPaging(prev => ({ ...prev, loading: false, error: errorText(e) }));
    }
  };

  useEffect(() => {
    const shell = document.querySelector<HTMLElement>(".m-shell");
    const viewport = window.visualViewport;
    if (!shell || !viewport) return;
    // iOS Safari ignores interactive-widget and pans the page to reveal a focused
    // field. The shell is pinned at top 0 and sized to the visual viewport; any
    // pan is undone so layout and the keyboard never move the shell twice.
    const unpan = () => { if (window.scrollY !== 0 || viewport.offsetTop !== 0) window.scrollTo(0, 0); };
    const resize = () => {
      unpan();
      shell.style.setProperty("--visual-height", `${viewport.height}px`);
      const keyboardOpen = window.innerHeight - viewport.height >= 80;
      shell.dataset.keyboard = keyboardOpen ? "true" : "false";
    };
    const onFocusIn = () => { unpan(); requestAnimationFrame(unpan); };
    viewport.addEventListener("resize", resize);
    viewport.addEventListener("scroll", unpan);
    window.addEventListener("scroll", unpan, { passive: true });
    document.addEventListener("focusin", onFocusIn);
    resize();
    return () => {
      viewport.removeEventListener("resize", resize);
      viewport.removeEventListener("scroll", unpan);
      window.removeEventListener("scroll", unpan);
      document.removeEventListener("focusin", onFocusIn);
    };
  }, []);

  const selectProfile = async (name: string, targetSession?: string) => {
    if (!profiles.some(p => p.name === name)) return;
    if (targetSession === undefined) {
      const gw = client.current;
      if (!gw || connection !== "open") { setError("Still connecting. Try again."); return; }
      try {
        const roster = await refreshRoster(gw);
        const entry = roster.profiles.find(p => p.name === name)?.canonical_session;
        if (entry) targetSession = entry.resolved_id || entry.id;
        else {
          const existing = await gw.request<{ sessions: Array<{ id: string; resolved_id?: string }> }>("session.list", { profile: name, title: "Bot Chat", include_hidden: true });
          targetSession = existing.sessions[0]?.resolved_id || existing.sessions[0]?.id;
          if (!targetSession) {
            const created = await gw.request<SessionSnapshot>("session.create", { profile: name, source: "mobile", title: "Bot Chat", hidden: true, follow_profile_config: true, close_on_disconnect: false });
            try {
              await gw.request("session.title", { session_id: created.session_id, title: "Bot Chat" });
              targetSession = created.stored_session_id || created.session_id;
            } catch (e) {
              const winner = await gw.request<{ sessions: Array<{ id: string; resolved_id?: string }> }>("session.list", { profile: name, title: "Bot Chat", include_hidden: true });
              targetSession = winner.sessions[0]?.resolved_id || winner.sessions[0]?.id;
              if (!targetSession) throw e;
            }
          }
        }
      } catch (e) { setError(errorText(e)); return; }
    }
    const session = targetSession;
    if (name !== profile || session !== selected) { clearPhotos(); setFiles([]); }
    if (name !== profile) {
      selectedRef.current = session;
      chatRef.current = null;
      setLiveSessions([]); setPrompts({}); setError(""); setWorking(""); setActivity([]);
      if (toolTimer.current) clearTimeout(toolTimer.current);
      runningTools.current.clear();
      setConnection("connecting");
      setProfile(name);
    }
    setSelected(session);
    setChat(cache.current.get(chatKey(name, session)) ?? null);
    navigate("chat", name, session);
  };

  const choosePhotos = (files: FileList | null) => {
    const added = Array.from(files || []).slice(0, Math.max(0, 4 - photos.length));
    const valid = added.filter(file => {
      if (!/^image\/(png|jpeg|gif|webp|bmp)$/.test(file.type) || !file.size || file.size > 25 * 1024 * 1024) {
        toast.error("Choose a PNG, JPEG, GIF, WebP or BMP under 25 MB"); return false;
      }
      return true;
    });
    setPhotos([...photos, ...valid.map(file => ({ file, preview: URL.createObjectURL(file) }))]);
  };
  const send = async (event: FormEvent) => {
    event.preventDefault();
    const message = text.trim() || (photos.length ? "What do you see in this photo?" : files.length ? "Please read the attached file." : "");
    const gw = client.current;
    if (!message || !gw || connection !== "open" || busy || chat?.running || voice.phase !== "idle") return;
    setBusy(true); setError("");
    let target = chat;
    const staged: string[] = [];
    let optimistic = false;
    let optimisticText = "";
    try {
      if (!target) {
        const created = await gw.request<SessionSnapshot>("session.create", { profile, source: "mobile", close_on_disconnect: false });
        target = { runtimeId: created.session_id, storedId: created.stored_session_id || created.session_id, rows: [], draft: "", running: false };
        skipResume.current = target.storedId;
        chatRef.current = target;
        cache.current.set(chatKey(profile, target.storedId), target);
        setSelected(target.storedId);
        setChat(target);
        routerNavigate(chatPath(profile, target.storedId), { replace: true });
      }
      const runtimeId = target.runtimeId;
      for (const photo of photos) {
        const uploaded = await uploadChatImage(photo.file, profile);
        await gw.request("image.attach", { session_id: runtimeId, profile, path: uploaded.path });
        staged.push(uploaded.path);
      }
      const refs: string[] = [];
      for (const file of files) {
        const data_url = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(reader.error); reader.readAsDataURL(file);
        });
        const result = await gw.request<{ attached: boolean; ref_text: string }>("file.attach", { session_id: runtimeId, profile, name: file.name, data_url });
        if (!result.attached || !result.ref_text) throw new Error(`Could not attach ${file.name}`);
        refs.push(result.ref_text);
      }
      const submitted = [message, ...refs].join("\n");
      const shown = staged.length ? `${submitted}\n${staged.map(path => `@image:${path}`).join("\n")}` : submitted;
      optimisticText = shown;
      optimistic = true;
      setChat(prev => {
        if (prev?.runtimeId !== runtimeId) return prev;
        const next = { ...prev, running: true, rows: [...prev.rows, { role: "user", text: shown }] };
        cache.current.set(chatKey(profile, next.storedId), next);
        return next;
      });
      await gw.request("prompt.submit", { session_id: runtimeId, profile, text: submitted });
      staged.length = 0;
      setText(""); clearPhotos(); setFiles([]);
    } catch (e) {
      if (staged.length && target) {
        const runtimeId = target.runtimeId;
        await Promise.allSettled(staged.map(path => gw.request("image.detach", { session_id: runtimeId, profile, path })));
      }
      if (optimistic && target) {
        const runtimeId = target.runtimeId;
        setChat(prev => {
          if (prev?.runtimeId !== runtimeId) return prev;
          const rows = prev.rows.at(-1)?.role === "user" && prev.rows.at(-1)?.text === optimisticText ? prev.rows.slice(0, -1) : prev.rows;
          const next = { ...prev, rows, running: false };
          cache.current.set(chatKey(profile, next.storedId), next);
          return next;
        });
      }
      setError(errorText(e)); toast.error(errorText(e));
    }
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
  const chatPrompts = activePrompts.filter(p => chat?.runtimeId && p.request.params.session_id === chat.runtimeId);
  const otherPrompts = activePrompts.filter(p => !chatPrompts.includes(p));
  const botName = (p: ProfileInfo) => p.display_name || (p.is_default ? "Frodo" : p.name[0].toUpperCase() + p.name.slice(1));
  const currentBot = profiles.find(p => p.name === profile);
  const name = currentBot ? botName(currentBot) : "Hermes";
  const avatar = (p: ProfileInfo) => <Avatar src={avatars[p.name]} name={botName(p)} />;
  const avatarForHandle = (handle: string) => {
    const p = profiles.find(x => x.name === handle || (x.is_default && handle === "hermes") || botName(x).toLowerCase() === handle);
    return p ? avatars[p.name] : undefined;
  };
  const status = connection !== "open" ? "Reconnecting…" : chatPrompts.length ? "Needs your input"
    : working || (chat?.running ? (chat.draft ? "Writing…" : "Thinking…") : "Ready to talk");

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

  const homeActivity = { ...activityByBot };
  for (const [bot, waiting] of Object.entries(waitingByBot)) {
    const previous = homeActivity[bot];
    homeActivity[bot] = { session: waiting.session_key, preview: previous?.preview || "", lastActive: Math.max(waiting.last_active || 0, previous?.lastActive || 0) };
  }
  const { pinned, others } = orderedBots(profiles, pins, homeActivity);
  const { suggestions, onKeyDown: onSuggestionKeyDown, open: suggestionsOpen } = useComposerSuggestions({ text, setText, cursor, gateway: screenGateway, sessionId: chat?.runtimeId, profiles, input: composerInput });
  // Browser tabs own ⌘1–9; Ctrl+1–9 also works here. Electron may capture ⌘.
  useEffect(() => {
    if (!desktop) return;
    const onShortcut = (event: KeyboardEvent) => {
      if ((!event.ctrlKey && !event.metaKey) || event.altKey || event.shiftKey || !/^[1-9]$/.test(event.key)) return;
      const target = [...pinned, ...others][Number(event.key) - 1];
      if (!target) return;
      event.preventDefault();
      void selectProfile(target.name);
    };
    window.addEventListener("keydown", onShortcut);
    return () => window.removeEventListener("keydown", onShortcut);
  }, [desktop, pinned, others]);
  const matching = (p: ProfileInfo) => !searchOpen || !searchQuery.trim() || `${botName(p)} ${botPreview(p)}`.toLowerCase().includes(searchQuery.trim().toLowerCase());
  const botPreview = (p: ProfileInfo) => {
    const pending = p.name === profile ? activePrompts[0] : undefined;
    if (pending) return `Needs your ${pending.request.method === "approval" ? "approval" : "input"}: ${previewText(String(pending.request.params.command || pending.request.params.question || "Open conversation"))}`;
    const waiting = waitingByBot[p.name];
    if (waiting) return `Needs your input: ${previewText(waiting.title || waiting.preview || "Open conversation")}`;
    return activityByBot[p.name]?.preview || "";
  };
  const botGesture = (name: string) => ({
    onTouchStart: () => { startPinPress(name); void warmProfile(name).catch(() => undefined); },
    onTouchMove: stopPinPress,
    onTouchEnd: stopPinPress,
    onTouchCancel: stopPinPress,
    onContextMenu: (event: React.MouseEvent) => { event.preventDefault(); stopPinPress(); setPinMenu(name); },
    onKeyDown: (event: React.KeyboardEvent) => pinKey(event, name),
    onMouseEnter: () => { void warmProfile(name).catch(() => undefined); },
    onClick: () => pinClick(name),
  });
  const renderMessage = (row: ChatRow, previous: ChatRow | undefined, key: string) => {
    const id = reactionKey(row.role, row.timestamp, row.text);
    return <MobileMessage key={key} row={row} previous={previous} onAction={text => setMessageAction({ text, key: id })}
      avatarFor={avatarForHandle} reacted={!!reactions[id]} onReact={() => toggleReaction(id)} />;
  };
  const accountMenu = <ProfileDropdown open={profileMenuOpen} onOpenChange={setProfileMenuOpen} showScreen={profiles.some(p => p.name === "samwise")} container={shellRef.current}
    name={account?.display_name || account?.email?.split("@")[0] || "Jorge"} picture={account?.picture || ""} onSignOut={() => void logout()} signingOut={busy} desktop={desktop} />;
  const HomeScroller = desktop ? "aside" : "main";
  const renderHome = () => <>
    <header className="m-list-header">
      <h1 className="sr-only">Bots</h1>
      {!desktop && accountMenu}
      <div className="m-top-actions">
        <button type="button" className="m-icon-button" aria-label="Search" onClick={() => setSearchOpen(open => !open)}><Search size={21} aria-hidden="true" /></button>
        <button type="button" className="m-icon-button" aria-label="New conversation" onClick={() => setNewChatOpen(true)}><Plus size={23} aria-hidden="true" /></button>
      </div>
    </header>
    {searchOpen && <div className="m-search"><Search size={19} aria-hidden="true" /><input aria-label="Search bots and conversations" name="mobile-search" autoComplete="off" type="search" placeholder="Search bots & conversations…" value={searchQuery} onChange={e => { setSearchQuery(e.target.value); setSearchResults([]); setSearchError(""); }} /><button type="button" aria-label="Close search" onClick={() => { setSearchOpen(false); setSearchQuery(""); setSearchResults([]); setSearchError(""); }}><X size={19} aria-hidden="true" /></button></div>}
    {error && <p role="alert" className="m-error">{error}</p>}
    <HomeScroller className="m-bot-list" ref={listRef} onScroll={e => { listScroll.current = e.currentTarget.scrollTop; }}>
      {!!pinned.filter(matching).length && <div className="m-pinned" aria-label="Pinned bots">{pinned.filter(matching).map(p => <div className="m-pinned-item" key={p.name}>
        <button type="button" className="m-pinned-bot" aria-label={`${botName(p)}${waitingByBot[p.name] || p.name === profile && !!activePrompts.length ? ", needs your input" : ""}`} {...botGesture(p.name)}>
          {avatar(p)}<span>{botName(p)}</span>
        </button>
      </div>)}</div>}
      <div className="m-bot-rows">{others.filter(matching).map(p => <div className="m-bot-row" key={p.name}>
        <button type="button" className="m-bot-main" {...botGesture(p.name)}>
          {avatar(p)}<span className="m-bot-copy"><span className="m-bot-heading"><strong>{botName(p)}</strong><time>{activityTime(activityByBot[p.name]?.lastActive || 0)}</time></span><small>{botPreview(p) || "Start a conversation"}</small></span>
        </button>
      </div>)}</div>
      {!profiles.length && <div className="m-loading" role="status" aria-label="Finding your bots"><Skeleton /><Skeleton /><Skeleton /></div>}
      {searchOpen && searchQuery.trim() && <section className="m-search-results" aria-label="Matching conversations">
        {searchError && <p role="alert" className="m-error">Search unavailable: {searchError}</p>}
        {searchResults.map(result => <button type="button" className="m-search-result" key={`${result.profile}/${result.session}`} onClick={() => { void selectProfile(result.profile, result.session); }}><MessageSquare size={19} aria-hidden="true" /><span><strong>{result.title}</strong><small>{profiles.find(p => p.name === result.profile)?.display_name || result.profile} · {result.preview}</small></span></button>)}
        {!searchResults.length && !searchError && <p className="m-muted">No matching conversations.</p>}
      </section>}
      {!!activePrompts.length && <section className="m-inbox" aria-label="Requests"><h2 className="sr-only">Requests</h2>{activePrompts.map(p => {
        const sid = p.request.params.session_id;
        const owner = liveSessions.find(s => s.id === sid);
        return <div className="m-inline-request" data-method={p.request.method} key={p.request.id}>
          <Badge className="m-request-label">{name} · {owner?.title || "Conversation"} · {sid || "Session unavailable"}</Badge>
          {owner?.session_key && <Button variant="outline" type="button" onClick={() => navigate("chat", profile, owner.session_key)}>Open conversation</Button>}
          <PromptCard pending={p} onAnswer={answer} onReceived={received} />
        </div>;
      })}</section>}
    </HomeScroller>
    {desktop && <footer className="m-sidebar-footer">{accountMenu}</footer>}
    </>;

  const skipExit = skipBackAnimation.current && (view === "bots" || view !== swipeSource.current);
  useLayoutEffect(() => {
    if (skipBackAnimation.current && (view !== swipeSource.current || (view === "board" && !route.task))) {
      const sourceOffset = offsets[swipeSource.current];
      sourceOffset.stop();
      sourceOffset.set(0);
      finishSwipe();
      const detail = shellRef.current?.querySelector<HTMLElement>(".m-detail");
      if (detail) detail.style.boxShadow = "";
    }
  }, [view, route.task, offsets, finishSwipe]);
  useEffect(() => { skipBackAnimation.current = false; }, [location.pathname]);

  return <div className={`m-shell${window.hermetic ? " m-native" : ""}`} data-theme={theme} ref={shellRef}
    style={window.hermetic ? { "--m-native-titlebar-inset": `${window.hermetic.titlebarInset}px` } as CSSProperties : undefined}>
    <Toaster theme={theme} position="top-center" toastOptions={{ style: { background: "var(--card)", color: "var(--foreground)", borderColor: "var(--border)" } }} />
    <div className="m-stage">
      <div className={`m-view m-home${swiping && !(view === "board" && route.task) ? " m-swipe-preview" : ""}`} ref={view === "board" && route.task ? undefined : swipePreview} aria-hidden={!desktop && view !== "bots"} inert={!desktop && view !== "bots"}>
        {renderHome()}
      </div>
      {desktop && view === "bots" && <main className="m-desktop-empty"><MessageSquare size={30} aria-hidden="true" /><h2>Choose a bot</h2></main>}
      {swiping && view === "board" && route.task && <div className="m-view m-board-swipe-preview m-swipe-preview" ref={swipePreview} aria-hidden="true" inert>
        <header className="m-header"><h1 className="m-page-title">Board</h1></header>
        <main className="m-main"><MobileKanban onSelectTask={() => {}} getSavedScroll={getBoardScroll} onScroll={() => {}} /></main>
      </div>}
      <AnimatePresence initial={false} custom={skipExit}>
        {view !== "bots" && <motion.div key={view} className="m-view m-detail" custom={skipExit} style={{ x: panX }}
          variants={{ enter: { x: "100%" }, active: { x: 0 }, exit: (skip: boolean) => ({ x: "100%", transition: { duration: skip || reducedMotion ? 0 : 0.18 } }) }}
          initial="enter" animate="active" exit="exit" transition={{ duration: reducedMotion ? 0 : 0.18, ease: "easeOut" }}>
      <>
      <header className="m-header">{!desktop && <button type="button" className="m-icon-button" aria-label={route.task ? "Back to board" : "Back to bots"} onClick={goBack}><ArrowLeft size={22} aria-hidden="true" /></button>}
        {view === "chat" && currentBot ? <button type="button" className="m-chat-identity" aria-label={`Open ${name} activity`} onClick={() => setActivityOpen(true)}>{avatar(currentBot)}<span>{name}</span><span className="sr-only" role="status">{status}</span></button> : view === "chat" ? <div className="m-chat-identity" role="status" aria-label="Loading bot"><Skeleton className="m-avatar-skeleton" /><Skeleton className="m-name-skeleton" /></div> : <h1 className="m-page-title">{{ board: route.task ? "Task" : "Board", screen: profile === "samwise" ? "Screen" : `${name} computer`, settings: "Settings", bots: "Bots", chat: name }[view]}</h1>}
        {view === "chat" && <button type="button" className="m-icon-button" aria-label={`Open ${name} computer`} onClick={() => routerNavigate(`/m/screen/${encodeURIComponent(profile)}`)}><Monitor size={20} aria-hidden="true" /></button>}
      </header>
      {error && <p role="alert" className="m-error">{error}</p>}
      <main className="m-main">
        {view === "chat" && <>
          <div className="m-messages" ref={messagesRef} onScroll={event => { onScroll(event); if (userScrolled() && event.currentTarget.scrollTop < 96) void loadOlder(); }} role="log" aria-live="polite">
            <div className="m-message-content">
              {paging.key === chatKey(profile, selected) && paging.hasOlder && <button type="button" className="m-older" disabled={paging.loading} onClick={() => void loadOlder()}>{paging.loading ? "Loading earlier…" : "Earlier messages"}</button>}
              {paging.key === chatKey(profile, selected) && paging.error && <p role="alert" className="m-error">History unavailable: {paging.error}</p>}
              {selected && !error && (!chat || !chat.rows.length && paging.loading) && <div className="m-loading" role="status" aria-label="Loading conversation"><Skeleton /><Skeleton /><Skeleton /></div>}
              {!chat && !selected && <div className="m-empty"><span className="m-empty-avatar">{currentBot && avatar(currentBot)}</span><p>Start a conversation with {name}.</p></div>}
              {chat && groupNoticeRows(chat.rows).map((group, index, groups) => {
                const previous = groups[index - 1]?.at(-1);
                if (group.length > 1) return <details className="m-notice-group" key={index}>
                  <summary>{group.length} updates</summary>
                  <div>{group.map((row, item) => renderMessage(row, item ? group[item - 1] : previous, `${index}-${item}`))}</div>
                </details>;
                return renderMessage(group[0], previous, String(index));
              })}
              {chat?.draft && <article className="m-message m-assistant m-streaming"><Markdown content={chat.draft} streaming /></article>}
              <AnimatePresence initial={false}>{chatPrompts.map(p => <motion.div className="m-inline-request" data-method={p.request.method} key={p.request.id}
                exit={{ opacity: 0, height: 0 }} transition={{ duration: reducedMotion ? 0 : 0.18 }}><Badge className="m-request-label">{name} needs your input</Badge><PromptCard pending={p} onAnswer={answer} onReceived={received} /></motion.div>)}</AnimatePresence>
              {!!otherPrompts.length && <Button className="m-other-requests" variant="outline" type="button" onClick={() => navigate("bots")}>{otherPrompts.length} request{otherPrompts.length === 1 ? "" : "s"} in other conversations · View requests</Button>}
              {chat?.running && !chatPrompts.length && <p role="status" aria-live="polite" className="m-thinking"><i className="m-status-dot" aria-hidden="true" />{status}</p>}
            </div>
          </div>
          {!atBottom && <div className="m-jump-row"><button className="m-jump-latest" type="button" onClick={scrollToLatest} aria-label="Jump to latest message"><ArrowDown size={19} aria-hidden="true" /></button></div>}
          <form className="m-composer" onSubmit={e => void send(e)}>
            {voice.phase !== "idle" && <p className="m-voice-status" role="status" aria-live="polite">{voice.phase === "recording" ? "Recording · tap to stop" : voice.phase === "starting" ? "Starting microphone…" : "Transcribing…"}</p>}
            {!!photos.length && <div className="m-photo-previews" aria-label="Selected photos">{photos.map((photo, index) => <div className="m-photo-preview" key={photo.preview}>
              <img src={photo.preview} alt={photo.file.name} /><button type="button" aria-label={`Remove ${photo.file.name}`} onClick={() => { URL.revokeObjectURL(photo.preview); setPhotos(current => current.filter((_, i) => i !== index)); }}><X size={15} aria-hidden="true" /></button>
            </div>)}</div>}
            {!!files.length && <div className="m-file-previews" aria-label="Selected files">{files.map((file, index) => <span key={`${file.name}-${index}`}><FileUp size={15} aria-hidden="true" />{file.name}<button type="button" aria-label={`Remove ${file.name}`} onClick={() => setFiles(current => current.filter((_, i) => i !== index))}><X size={15} aria-hidden="true" /></button></span>)}</div>}
            {suggestions}
            <div className="m-composer-row"><input hidden ref={photoInput} type="file" accept="image/png,image/jpeg,image/gif,image/webp,image/bmp" multiple onChange={e => { choosePhotos(e.target.files); e.target.value = ""; }} />
              <input hidden ref={fileInput} type="file" multiple onChange={e => { const valid = Array.from(e.target.files || []).filter(file => { if (file.size > 10 * 1024 * 1024) { toast.error("Choose a file under 10 MB"); return false; } return true; }); setFiles(current => [...current, ...valid].slice(0, 4)); e.target.value = ""; }} />
              <DropdownMenu.Root><DropdownMenu.Trigger className="m-add-photo" aria-label="Attach photo or file" disabled={busy || connection !== "open"}><Plus size={20} aria-hidden="true" /></DropdownMenu.Trigger>
                <DropdownMenu.Portal container={shellRef.current}><DropdownMenu.Content align="start" side="top" sideOffset={8} className="m-dropdown m-attach-menu">
                  <DropdownMenu.Item onSelect={() => photoInput.current?.click()}><ImagePlus size={17} aria-hidden="true" />Photo</DropdownMenu.Item>
                  <DropdownMenu.Item onSelect={() => fileInput.current?.click()}><FileUp size={17} aria-hidden="true" />File</DropdownMenu.Item>
                </DropdownMenu.Content></DropdownMenu.Portal>
              </DropdownMenu.Root>
              <Textarea ref={composerInput} aria-label="Message" name="message" autoComplete="off" value={text} onChange={e => { setText(e.target.value); setCursor(e.target.selectionStart); }} onSelect={e => setCursor(e.currentTarget.selectionStart)} onKeyDown={e => {
                if (onSuggestionKeyDown(e)) return;
                if (desktop && e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing && !suggestionsOpen) {
                  e.preventDefault();
                  e.currentTarget.form?.requestSubmit();
                }
              }} placeholder={`Message ${name}…`} rows={1} />
              {chat?.running ? <Button type="button" variant="secondary" size="icon" className="m-stop" aria-label="Stop" onClick={() => { void client.current?.request("session.interrupt", { profile, session_id: chat.runtimeId }).catch(e => setError(errorText(e))); }}><Square size={16} fill="currentColor" /></Button>
                : voice.phase === "recording" ? <button type="button" className="m-voice-stop" aria-label="Stop recording" onClick={voice.stop}><Square size={16} fill="currentColor" aria-hidden="true" /></button>
                : voice.phase !== "idle" ? <button type="button" className="m-voice-loading" aria-label={voice.phase === "starting" ? "Starting microphone" : "Transcribing audio"} disabled><LoaderCircle size={20} aria-hidden="true" /></button>
                : !text.trim() && !photos.length && !files.length ? <button type="button" className="m-voice-start" aria-label="Dictate message" disabled={busy || connection !== "open"} onClick={() => void voice.start()}><Mic size={20} aria-hidden="true" /></button>
                : <Button type="submit" variant="primary" size="icon" className="m-send" aria-label="Send" disabled={busy || connection !== "open"}><ArrowUp size={20} /></Button>}
            </div>
          </form>
        </>}
        {view === "board" && <MobileKanban taskId={route.task} onSelectTask={id => routerNavigate(taskPath(id))} getSavedScroll={getBoardScroll} onScroll={setBoardScroll} avatars={avatars} />}
        {view === "screen" && (profile === "samwise" ? <MobileScreen gateway={screenGateway} onContinue={async () => {
          const gw = client.current;
          if (!gw || !chat?.runtimeId) throw new Error("Open Samwise's chat before continuing");
          const text = "I handed back the screen; continue from the current state.";
          if (chat.running) {
            const result = await gw.request<{ status: string }>("session.steer", { session_id: chat.runtimeId, profile, text });
            if (result.status === "rejected") await gw.request("prompt.submit", { session_id: chat.runtimeId, profile, text });
          } else await gw.request("prompt.submit", { session_id: chat.runtimeId, profile, text });
          navigate("chat");
        }} /> : <section className="m-screen m-computer-activity" aria-label={`${name} computer activity`}>
          <p className="m-activity-now" role="status"><i className="m-status-dot" aria-hidden="true" />{status}</p>
          {liveSessions.filter(session => session.status === "running" || session.status === "waiting").map(session => <p key={session.id}>{session.title || "Conversation"} · {session.status}</p>)}
          <ul>{activity.map((item, index) => <li key={index}>{item}</li>)}</ul>
          {!activity.length && <p className="m-muted">{activityByBot[profile]?.preview || "Waiting for the next activity."}</p>}
        </section>)}
        {view === "settings" && <section className="m-settings">
          <div className="m-settings-group"><h3>Appearance</h3><div className="m-theme-choices" role="group" aria-label="Appearance">{(["system", "light", "dark"] as const).map(choice => <Button key={choice} type="button" variant={theme === choice ? "outline" : "secondary"} aria-pressed={theme === choice} onClick={() => setTheme(choice)}>{choice === "system" ? <Monitor size={17} /> : choice === "light" ? <Sun size={17} /> : <Moon size={17} />}{choice[0].toUpperCase() + choice.slice(1)}</Button>)}</div></div>
          <div className="m-settings-group"><h3>Notifications</h3><button className="m-setting-action" type="button" disabled={!pushAvailable() || busy} onClick={() => void togglePush()}>{pushEnabled ? <BellOff size={19} /> : <Bell size={19} />}{pushAvailable() ? (pushEnabled ? "Turn off notifications" : "Turn on notifications") : "Unavailable in this browser"}<ChevronRight size={17} /></button></div>
          <div className="m-settings-group"><h3>Account</h3><button className="m-setting-action" type="button" disabled={busy} onClick={() => void logout()}><LockKeyhole size={19} />Sign out<ChevronRight size={17} /></button><p className="m-muted">Other devices stay signed in.</p></div>
        </section>}
      </main>
    </>
      </motion.div>}
    </AnimatePresence>
    </div>
    {newChatOpen && <Sheet open={newChatOpen} onClose={() => setNewChatOpen(false)} label="Choose a bot">
      <div className="m-activity-head"><h2>New conversation</h2><button type="button" className="m-icon-button" aria-label="Close bot picker" onClick={() => setNewChatOpen(false)}><X size={20} aria-hidden="true" /></button></div>
      <div className="m-bot-picker">{[...pinned, ...others].map(p => <button type="button" key={p.name} onClick={() => { setNewChatOpen(false); setText(""); void selectProfile(p.name, ""); }}>{avatar(p)}{botName(p)}</button>)}</div>
    </Sheet>}
    {!!pinMenu && <Sheet open={!!pinMenu} onClose={() => setPinMenu("")} label="Bot options">
      <div className="m-activity-head"><h2>{profiles.find(p => p.name === pinMenu)?.display_name || pinMenu}</h2><button type="button" className="m-icon-button" aria-label="Close bot options" onClick={() => setPinMenu("")}><X size={20} aria-hidden="true" /></button></div>
      <button type="button" className="m-pin-choice" onClick={() => { setPins(current => pinned.some(p => p.name === pinMenu)
        ? current.filter(p => p !== pinMenu && !(p === "default" && pinMenu === profiles.find(bot => bot.is_default)?.name))
        : [...current, pinMenu]); setPinMenu(""); }}>{pinned.some(p => p.name === pinMenu) ? "Unpin bot" : "Pin bot"}</button>
    </Sheet>}
    {!!messageAction && <Sheet open onClose={() => setMessageAction(null)} label="Message actions">
      <div className="m-activity-head"><h2>Message</h2><button type="button" className="m-icon-button" aria-label="Close message actions" onClick={() => setMessageAction(null)}><X size={20} aria-hidden="true" /></button></div>
      <button type="button" className="m-pin-choice" onClick={() => { void navigator.clipboard.writeText(messageAction.text).then(() => { setMessageAction(null); toast.success("Copied message"); }).catch(() => toast.error("Could not copy message")); }}><Copy size={18} aria-hidden="true" />Copy text</button>
      <button type="button" className="m-pin-choice" onClick={() => { toggleReaction(messageAction.key); setMessageAction(null); }}><ThumbsUp size={18} aria-hidden="true" />{reactions[messageAction.key] ? "Remove thumbs up" : "React thumbs up"}</button>
    </Sheet>}
    {conversationsOpen && <Sheet open={conversationsOpen} onClose={() => { setConversationsOpen(false); setConversationAction(null); }} label="Conversations">
      <div className="m-activity-head"><h2>{conversationAction ? "Manage conversation" : "Conversations"}</h2><Button type="button" variant="ghost" size="icon" aria-label={conversationAction ? "Back to conversations" : "Close conversations"} onClick={() => { if (conversationAction) setConversationAction(null); else setConversationsOpen(false); }}><X size={21} aria-hidden="true" /></Button></div>
      {conversationError && <p role="alert" className="m-error">{conversationError}</p>}
      {conversationAction ? <div className="m-conversation-manage">
        <p>{profiles.find(p => p.name === conversationAction.profile)?.display_name || conversationAction.profile}</p>
        <form onSubmit={e => { e.preventDefault(); void changeConversation("rename"); }}>
          <label htmlFor="m-conversation-title">Conversation name</label>
          <input id="m-conversation-title" value={conversationTitle} maxLength={200} onChange={e => setConversationTitle(e.target.value)} />
          <Button type="submit" disabled={conversationBusy || !conversationTitle.trim() || conversationTitle.trim() === conversationAction.title}>Save name</Button>
        </form>
        <button className="m-pin-choice" type="button" disabled={conversationBusy} onClick={() => void changeConversation("pin")}>{conversationAction.pinned ? "Unpin conversation" : "Pin conversation"}</button>
        <button className="m-pin-choice" type="button" disabled={conversationBusy} onClick={() => void changeConversation("archive")}>{archivedOpen ? "Restore conversation" : "Archive conversation"}</button>
      </div> : <>
        <div className="m-conversation-tabs" role="group" aria-label="Conversation view"><button type="button" aria-pressed={!archivedOpen} onClick={() => { setArchivedOpen(false); setConversationError(""); }}>Recent</button><button type="button" aria-pressed={archivedOpen} onClick={() => { setArchivedOpen(true); setConversationError(""); }}>Archived</button></div>
        <div className="m-conversation-list">{(archivedOpen ? archivedSessions : sessions).length ? (archivedOpen ? archivedSessions : sessions).map(session => <div className="m-conversation-row" key={`${session.profile}/${session.id}`}><MobileListRow leading={session.pinned ? <Pin size={20} aria-hidden="true" /> : <MessageSquare size={20} aria-hidden="true" />}
          title={session.title} preview={`${profiles.find(p => p.name === session.profile)?.display_name || session.profile} · ${previewText(session.preview)}`}
          onClick={() => { setConversationsOpen(false); void selectProfile(session.profile, session.id); }} /><button type="button" className="m-conversation-more" aria-label={`Options for ${session.title}`} onClick={() => { setConversationAction(session); setConversationTitle(session.title); setConversationError(""); }}><MoreHorizontal size={21} aria-hidden="true" /></button></div>) : <p className="m-muted">{archivedOpen ? "No archived conversations." : "No conversations yet."}</p>}</div>
      </>}
    </Sheet>}
    {activityOpen && <Sheet open={activityOpen} onClose={() => setActivityOpen(false)} label={`${name} activity`}>
      <div className="m-activity-head"><h2>Activity</h2><Tooltip label="Close activity"><Button type="button" variant="ghost" size="icon" aria-label="Close activity" onClick={() => setActivityOpen(false)}><X size={21} /></Button></Tooltip></div>
      <p className="m-activity-now"><i className="m-status-dot" />{status}</p>
      <button type="button" className="m-pin-choice" onClick={() => { setActivityOpen(false); setConversationsOpen(true); }}><MessageSquare size={18} aria-hidden="true" />Conversations</button>
      {activity.length ? <ul>{activity.map((item, index) => <li key={index}>{item}</li>)}</ul> : <p className="m-muted">No activity yet.</p>}
    </Sheet>}
  </div>;
}
