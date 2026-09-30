import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type FormEvent, type ReactNode } from "react";
import { useLocation, useNavigate } from "react-router";
import { AnimatePresence, motion, motionValue, useReducedMotion } from "motion/react";
import { Markdown } from "@/components/Markdown";
import { useChatScroll } from "./useChatScroll";
import { useLatestBuild } from "./useLatestBuild";

const LAST_BOT_KEY = "hermes-mobile-last-bot";
const LAST_CHAT_KEY = "hermes-mobile-last-chat";
import { useMobileDictation } from "./useMobileDictation";
import { isIOSDevice, useStandaloneSwipeBack } from "./useStandaloneSwipeBack";
import { ArrowDown, ArrowLeft, ArrowUp, Bell, BellOff, ChevronRight, Copy, FileUp, ImagePlus, LoaderCircle, LockKeyhole, MessageSquare, Mic, Moon, MoreHorizontal, PanelRight, Pin, Plus, Search, Square, Sun, Monitor, ThumbsUp, X } from "lucide-react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { ProfileDropdown } from "./ProfileDropdown";
import { SkillEditor, type SkillEditorHandle } from "./SkillEditor";
import { queuedMessage, readQueues, writeQueue, type QueuedMessage } from "./mobile-queue";
import { useComposerSuggestions } from "./ComposerSuggestions";
import { toast, Toaster } from "sonner";
import { skillInvocationText, type ServerRequest } from "@hermes/shared";
import { api, fetchJSON, HERMES_BASE_PATH, type AuthMeResponse, type ProfileInfo, type SessionMessage } from "@/lib/api";
import { copyTextToClipboard } from "@/lib/clipboard";
import { sideConversations, type Conversation } from "./conversations";
import { GatewayClient } from "@/lib/gatewayClient";
import PromptCard from "./PromptCard";
import { Avatar, Badge, Button, Sheet, Skeleton, Tooltip } from "./ui";
import MobileKanban from "./MobileKanban";
import MobileScreen from "./MobileScreen";
import MobileMessage from "./MobileMessage";
import { loadComposerAttachments, saveComposerAttachments } from "./composer-attachments";
import { groupNoticeRows } from "./message-kind";
import { uploadChatImage } from "@/lib/chatImagePaste";
import { applyChatEvent, PROMPT_METHODS, transcriptRows, type ChatRow, type MobileChat, type PendingPrompt } from "./mobile-state";
import { pushAvailable, registerMobileWorker, signOutMobile, subscribePush, unsubscribePush } from "./mobile-push";
import { appendLive, HISTORY_PAGE_SIZE, historyPage, prependOlder } from "./history";
import MobileSubscriptions from "./MobileSubscriptions";
import BotTerminalDock from "./BotTerminalDock";
import { showBotScreen, type BotTerminalCapabilities } from "./bot-terminal-rule";
import { chatPath, mobileRoute, taskPath, type MobileView } from "./mobile-routes";
import { HomeSwitch, type HomeTab } from "./HomeSwitch";
import { ChatsPanel, ChatsToolbar } from "./ChatsPanel";
import { CreationStatus, NewChatHero, NewChatToolbar, type CreationProgress, type ProjectChoice, type WorkspaceMode } from "./NewChatSetup";
import { ShortcutHelp } from "./ShortcutHelp";
import { adjacentChat, chatKeyOf, chatLayout, filterChats, loadStringSet, unreadCount, type ChatSort } from "./chat-list";
import { parseShortcut, type ShortcutAction } from "./shortcuts";
import { RightSplit, type SplitTab } from "./RightSplit";
import { conversationLocalLinks, fileLinkPath, localPreviewLink } from "./preview-links";
import { activityTime, movePin, orderedBots, PIN_STORAGE_KEY, savedPins, type BotActivity } from "./home-data";
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
const branchForMessage = (message: string) => `feat/${message.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 42) || "chat"}`;
const profileFromUrl = () => new URLSearchParams(window.location.search).get("profile") || "";
const chatKey = (profile: string, session: string) => `${profile}/${session}`;
const HOME_TAB_KEY = "hermes-mobile-home-tab";
const CHAT_SORT_KEY = "hermes-mobile-chat-sort";
const CHAT_GROUP_KEY = "hermes-mobile-chat-group";
const CHAT_COLLAPSED_KEY = "hermes-mobile-chat-collapsed";
type ComposerDraft = { text: string; cursor: number; skills: string[]; photos: Array<{ file: File; preview: string }>; files: File[] };
const emptyDraft = (): ComposerDraft => ({ text: "", cursor: 0, skills: [], photos: [], files: [] });
const draftStorageKey = (key: string) => `hermes-mobile-draft:${key}`;
const draftSkills = (key: string): string[] => { try { const result: unknown = JSON.parse(localStorage.getItem(`${draftStorageKey(key)}:skills`) || "[]"); return Array.isArray(result) ? result.filter((item): item is string => typeof item === "string" && /^\/[\w.-]+$/.test(item)) : []; } catch { return []; } };
const displayRows = (messages: SessionMessage[]) => transcriptRows(messages.map(m => ({
  role: m.role, text: (m as SessionMessage & { display_content?: string }).display_content ?? (m.role === "user" ? skillInvocationText(m.content || "") : null) ?? m.content, timestamp: m.timestamp,
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
  const [desktop, setDesktop] = useState(() => window.matchMedia("(min-width: 768px)").matches);
  useEffect(() => {
    const media = window.matchMedia("(min-width: 768px)");
    const update = () => setDesktop(media.matches);
    media.addEventListener("change", update);
    update();
    return () => media.removeEventListener("change", update);
  }, []);
  const [profiles, setProfiles] = useState<ProfileInfo[]>([]);
  const [profile, setProfile] = useState(() => route.profile || "");
  const [terminalCapabilities, setTerminalCapabilities] = useState<BotTerminalCapabilities | null>(null);
  const [terminalOpenByChat, setTerminalOpenByChat] = useState<Record<string, boolean>>({});
  const [terminalHeight, setTerminalHeight] = useState(() => Number(localStorage.getItem("hermes:bot-terminal-height")) || 310);
  const [splitOpen, setSplitOpen] = useState(false);
  const [splitWidth, setSplitWidth] = useState(() => Number(localStorage.getItem("hermes:right-split-width")) || 520);
  const [splitTab, setSplitTab] = useState<SplitTab>("browser");
  const [browserUrl, setBrowserUrl] = useState("");
  const [filePath, setFilePath] = useState("");
  const resizeSplit = (value: number) => { setSplitWidth(value); localStorage.setItem("hermes:right-split-width", String(value)); };
  useEffect(() => {
    if (view !== "chat") return;
    const toggle = (event: KeyboardEvent) => {
      if (event.key !== "\\" || event.altKey || event.shiftKey || !(event.metaKey || event.ctrlKey)) return;
      event.preventDefault();
      setSplitOpen(previous => !previous);
    };
    window.addEventListener("keydown", toggle);
    return () => window.removeEventListener("keydown", toggle);
  }, [view]);
  const [selected, setSelected] = useState(() => route.session === "new" ? "" : route.session || "");
  const [conversationFolder, setConversationFolder] = useState("");
  useEffect(() => {
    if (view !== "chat" || !profile) return;
    let active = true;
    setConversationFolder("");
    void fetchJSON<{ folder: string }>(`/api/bot-terminal/folder?${new URLSearchParams({ profile, session: selected })}`)
      .then(result => { if (active) setConversationFolder(result.folder); })
      .catch(() => {});
    return () => { active = false; };
  }, [view, profile, selected]);
  useEffect(() => {
    let active = true;
    void fetchJSON<BotTerminalCapabilities>("/api/bot-terminal/capabilities")
      .then(capabilities => { if (active) setTerminalCapabilities(capabilities); })
      .catch(() => {});
    return () => { active = false; };
  }, []);
  useEffect(() => {
    if (!desktop || view !== "chat" || !profile) return;
    const toggle = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== "j" || event.shiftKey || event.altKey ||
          !(navigator.platform.includes("Mac") ? event.metaKey : event.ctrlKey)) return;
      event.preventDefault();
      setTerminalOpenByChat(previous => ({ ...previous, [chatKey(profile, selected)]: !previous[chatKey(profile, selected)] }));
    };
    window.addEventListener("keydown", toggle);
    return () => window.removeEventListener("keydown", toggle);
  }, [desktop, view, profile, selected]);
  const terminalProfile = view === "terminal" ? route.profile || "" : profile;
  const terminalSession = view === "terminal" ? route.session || "" : selected;
  const terminalVisible = view === "terminal" || (view === "chat" && desktop && !!terminalOpenByChat[chatKey(profile, selected)]);
  const screenVisible = showBotScreen(terminalCapabilities, profile, !desktop, window.hermetic?.hostName);
  const [sessions, setSessions] = useState<Conversation[]>([]);
  const [projectNames, setProjectNames] = useState<Record<string, string>>({});
  const projectProfiles = [...new Set(sessions.map(row => row.profile))].sort().join(",");
  useEffect(() => {
    if (!projectProfiles) return;
    let active = true;
    void Promise.all(projectProfiles.split(",").map(async bot => {
      try {
        const data = await fetchJSON<{ projects: ProjectChoice[] }>(`/api/mobile/projects?profile=${encodeURIComponent(bot)}`);
        return data.projects;
      } catch { return []; }
    })).then(groups => {
      if (active) setProjectNames(Object.fromEntries(groups.flat().map(project => [project.path, project.label])));
    });
    return () => { active = false; };
  }, [projectProfiles]);
  const [liveSessions, setLiveSessions] = useState<LiveSession[]>([]);
  const [chat, setChat] = useState<MobileChat | null>(null);
  const composerKey = chatKey(profile, selected);
  const [composerDrafts, setComposerDrafts] = useState<Record<string, ComposerDraft>>({});
  const [uploadStatus, setUploadStatus] = useState<Record<string, Record<string, string>>>({});
  const markUpload = (key: string, file: string, status: string) => setUploadStatus(current => ({ ...current, [key]: { ...current[key], [file]: status } }));
  const draft = composerDrafts[composerKey];
  const text = draft?.text ?? window.localStorage.getItem(draftStorageKey(composerKey)) ?? "";
  const pickedSkills = draft?.skills ?? draftSkills(composerKey);
  const [queues, setQueues] = useState(readQueues);
  const queued = queues[composerKey] || [];
  const setQueue = (key: string, entries: QueuedMessage[]) => setQueues(writeQueue(key, entries));
  const photos = draft?.photos ?? [];
  const files = draft?.files ?? [];
  const cursor = draft?.cursor ?? 0;
  const updateDraft = (key: string, update: (draft: ComposerDraft) => ComposerDraft) => setComposerDrafts(current => {
    const previous = current[key] ?? { ...emptyDraft(), text: window.localStorage.getItem(draftStorageKey(key)) ?? "", skills: draftSkills(key) };
    const next = update(previous);
    if (next.text) window.localStorage.setItem(draftStorageKey(key), next.text);
    else window.localStorage.removeItem(draftStorageKey(key));
    if (next.skills.length) window.localStorage.setItem(`${draftStorageKey(key)}:skills`, JSON.stringify(next.skills));
    else window.localStorage.removeItem(`${draftStorageKey(key)}:skills`);
    return { ...current, [key]: next };
  });
  const setText = (value: string | ((previous: string) => string)) => updateDraft(composerKey, previous => ({ ...previous, text: typeof value === "function" ? value(previous.text) : value }));
  const setPhotos = (value: ComposerDraft["photos"] | ((previous: ComposerDraft["photos"]) => ComposerDraft["photos"])) => updateDraft(composerKey, previous => ({ ...previous, photos: typeof value === "function" ? value(previous.photos) : value }));
  const setFiles = (value: File[] | ((previous: File[]) => File[])) => updateDraft(composerKey, previous => ({ ...previous, files: typeof value === "function" ? value(previous.files) : value }));
  const photoInput = useRef<HTMLInputElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const composerInput = useRef<SkillEditorHandle>(null);
  const composerForm = useRef<HTMLFormElement>(null);
  useEffect(() => () => { for (const entry of Object.values(composerDraftsRef.current)) for (const photo of entry.photos) URL.revokeObjectURL(photo.preview); }, []);
  const composerDraftsRef = useRef(composerDrafts);
  composerDraftsRef.current = composerDrafts;
  const persistedAttachments = useRef(new Map<string, { photos: ComposerDraft["photos"]; files: File[] }>());
  useEffect(() => {
    let alive = true;
    void loadComposerAttachments(composerKey).then(saved => {
      if (!alive || (!saved.photos.length && !saved.files.length)) return;
      setComposerDrafts(current => {
        if (persistedAttachments.current.has(composerKey) || current[composerKey]?.photos.length || current[composerKey]?.files.length) return current;
        const photos = saved.photos.map(file => ({ file, preview: URL.createObjectURL(file) }));
        return { ...current, [composerKey]: { ...emptyDraft(), ...current[composerKey], text: current[composerKey]?.text ?? window.localStorage.getItem(draftStorageKey(composerKey)) ?? "", photos, files: saved.files } };
      });
    }).catch(() => {});
    return () => { alive = false; };
  }, [composerKey]);
  useEffect(() => {
    for (const [key, current] of Object.entries(composerDrafts)) {
      const previous = persistedAttachments.current.get(key);
      if (previous?.photos === current.photos && previous.files === current.files) continue;
      if (!previous && !current.photos.length && !current.files.length) continue;
      persistedAttachments.current.set(key, current);
      void saveComposerAttachments(key, current.photos.map(photo => photo.file), current.files).catch(() => toast.error("Could not save staged attachments"));
    }
  }, [composerDrafts]);
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
  const [homeTab, setHomeTab] = useState<HomeTab>(() => localStorage.getItem(HOME_TAB_KEY) === "chats" ? "chats" : "bots");
  const homeTabRef = useRef(homeTab);
  homeTabRef.current = homeTab;
  const [chatSort, setChatSort] = useState<ChatSort>(() => localStorage.getItem(CHAT_SORT_KEY) === "created" ? "created" : "recent");
  const [chatsGrouped, setChatsGrouped] = useState(() => localStorage.getItem(CHAT_GROUP_KEY) === "1");
  const [collapsedGroups, setCollapsedGroups] = useState(() => loadStringSet(localStorage, CHAT_COLLAPSED_KEY));
  const [helpOpen, setHelpOpen] = useState(false);
  const forcedUnread = useRef("");
  const [newChatOpen, setNewChatOpen] = useState(false);
  const [projects, setProjects] = useState<ProjectChoice[]>([]);
  const [projectSupported, setProjectSupported] = useState(true);
  const [projectReason, setProjectReason] = useState("");
  const [projectId, setProjectId] = useState("");
  const [workspaceMode, setWorkspaceMode] = useState<WorkspaceMode>("local");
  const [branchName, setBranchName] = useState("");
  const [branchCheck, setBranchCheck] = useState<{ name: string; error: string } | null>(null);
  const [creation, setCreation] = useState<CreationProgress | null>(null);
  const effectiveBranch = branchName || branchForMessage(text.trim() || (photos.length ? "What do you see in this photo?" : files.length ? "Please read the attached file." : "chat"));
  const needsBranchCheck = view === "chat" && !selected && !!projectId && workspaceMode === "worktree";
  useEffect(() => {
    if (!needsBranchCheck) return;
    let active = true;
    const timer = window.setTimeout(() => {
      void fetchJSON<{ valid: boolean }>("/api/mobile/branch-check", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ branch: effectiveBranch }),
      }).then(() => { if (active) setBranchCheck({ name: effectiveBranch, error: "" }); })
        .catch(cause => { if (active) setBranchCheck({ name: effectiveBranch, error: errorText(cause) }); });
    }, 180);
    return () => { active = false; window.clearTimeout(timer); };
  }, [effectiveBranch, needsBranchCheck]);
  const branchReady = !needsBranchCheck || branchCheck?.name === effectiveBranch && !branchCheck.error;
  const branchError = needsBranchCheck && branchCheck?.name === effectiveBranch ? branchCheck.error : "";
  const preparedWorkspace = useRef("");
  const desiredProjectPath = useRef("");
  useEffect(() => {
    if (view !== "chat" || selected || !profile) return;
    let active = true;
    setProjects([]);
    void fetchJSON<{ projects: ProjectChoice[]; supported: boolean; reason?: string }>(`/api/mobile/projects?profile=${encodeURIComponent(profile)}`)
      .then(result => {
        if (!active) return;
        setProjects(result.projects); setProjectSupported(result.supported); setProjectReason(result.reason || "");
        setProjectId(result.projects.find(project => project.path === desiredProjectPath.current)?.id || result.projects[0]?.id || "");
        desiredProjectPath.current = "";
      }).catch(e => { if (active) setProjectReason(`Projects unavailable: ${errorText(e)}`); });
    return () => { active = false; };
  }, [view, selected, profile]);
  const [messageAction, setMessageAction] = useState<{ text: string; key: string; scope: string } | null>(null);
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
  const [screenState, setScreenState] = useState("Checking…");
  const skipBackAnimation = useRef(false);
  const swipeSource = useRef<Exclude<MobileView, "bots">>("chat");
  const [offsets] = useState(() => ({
    chat: motionValue<number | string>(0), board: motionValue<number | string>(0),
    screen: motionValue<number | string>(0), terminal: motionValue<number | string>(0), settings: motionValue<number | string>(0), subscriptions: motionValue<number | string>(0),
  }));
  const panX = view === "bots" ? offsets.chat : offsets[view];
  const reducedMotion = useReducedMotion();
  const navigate = (next: MobileView, targetProfile = profile, targetSession = selected) => {
    const path = next === "chat" ? `${chatPath(targetProfile, targetSession)}?mode=${homeTabRef.current}` : next === "bots" ? "/m" : `/m/${next}`;
    routerNavigate(path);
  };
  const shellRef = useRef<HTMLDivElement>(null);
  const goBack = useCallback(() => {
    if (view === "board" && route.task) { routerNavigate("/m/board"); return; }
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
    const mode = new URLSearchParams(location.search).get("mode");
    const selectedMode = mode === "chats" || mode === "bots" ? mode : homeTabRef.current;
    if (mode === "chats" || mode === "bots") {
      homeTabRef.current = mode;
      setHomeTab(mode);
      localStorage.setItem(HOME_TAB_KEY, mode);
    }
    if (route.view !== "chat" || !route.profile) return;
    if (selectedMode === "bots") localStorage.setItem(LAST_BOT_KEY, route.profile);
    else if (route.session && route.session !== "new") localStorage.setItem(LAST_CHAT_KEY, chatKey(route.profile, route.session));
  }, [location.pathname, location.search]);
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
  const lastTurnSignal = useRef(Date.now());
  const checkingTurn = useRef(false);
  const runningTools = useRef(new Map<string, string>());
  const toolTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (view === "chat" && desktop && connection === "open") composerInput.current?.focus({ preventScroll: true });
  }, [view, desktop, profile, selected, connection]);
  const voice = useMobileDictation(profile, `${view}/${selected}`, transcript => setText(previous => `${previous.trimEnd()}${previous.trim() ? " " : ""}${transcript}`));
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [steerNext, setSteerNext] = useState(false);
  const [sending, setSending] = useState<Record<string, boolean>>({});
  const sendingHere = !!sending[composerKey];
  const idleRef = useRef({ text: "", busy: false, running: false, attachments: false, dictating: false });
  idleRef.current = { text, busy: busy || Object.values(sending).some(Boolean), running: !!chat?.running, attachments: !!photos.length || !!files.length, dictating: voice.phase !== "idle" };
  const isIdle = useCallback(() => !idleRef.current.text.trim() && !idleRef.current.busy && !idleRef.current.running && !idleRef.current.attachments && !idleRef.current.dictating, []);
  useLatestBuild(`${HERMES_BASE_PATH}/m`, isIdle);
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
    const cachedChats = cache.current;
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
          if (alive) routerNavigate(`${chatPath(profile, id)}?mode=${homeTabRef.current}`, { replace: true });
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
        setScreenGateway(null);
        for (const [key, value] of cache.current) if (key.startsWith(`${profile}/`)) cache.current.set(key, { ...value, runtimeId: "" });
        setPrompts({});
        setLiveSessions([]);
        retry();
      }
    });
    const offEvents = gw.onEvent(ev => {
      if (ev.session_id === chatRef.current?.runtimeId) {
        if (ev.type === "status.update" || ev.type.startsWith("message.") || ev.type.startsWith("tool.")) lastTurnSignal.current = Date.now();
        if (ev.type === "status.update") {
          const kind = (ev.payload as { kind?: string } | undefined)?.kind;
          if (kind === "compacting") setWorking("Compacting conversation…");
          else if (kind === "compacted") setWorking("");
        }
        if (ev.type === "message.complete") {
          setCreation(null);
          const outcome = ev.payload as { status?: string; error?: string; text?: string } | undefined;
          if (outcome?.status === "error" || outcome?.status === "interrupted") {
            const replyExplainsFailure = outcome.status === "error" && !!outcome.text?.trim() && outcome.text.trim() !== outcome.error?.trim();
            setError(replyExplainsFailure ? "" : outcome.error || (outcome.status === "interrupted" ? "The turn was interrupted." : "The turn failed."));
          } else setError("");
        }
      }
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
      if (client.current === gw) client.current = null;
      for (const [key, value] of cachedChats) if (key.startsWith(`${profile}/`)) cachedChats.set(key, { ...value, runtimeId: "" });
      gw.close();
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
    if (!chat?.running || !selected || connection !== "open") return;
    const key = chatKey(profile, selected);
    const check = async () => {
      if (checkingTurn.current || Date.now() - lastTurnSignal.current < 30000 || document.visibilityState === "hidden") return;
      const gw = client.current;
      if (!gw) return;
      checkingTurn.current = true;
      try {
        const active = await gw.request<{ sessions: LiveSession[] }>("session.active_list", { profile });
        if (chatKey(profile, selectedRef.current) !== key || !chatRef.current?.running) return;
        const live = active.sessions.find(s => s.id === chatRef.current?.runtimeId || s.session_key === selected);
        if (live && ["working", "waiting", "starting", "running"].includes(live.status)) return;
        const snapshot = await gw.request<SessionSnapshot>("session.resume", { profile, session_id: selected, source: "mobile", close_on_disconnect: false, omit_messages: true, defer_history: true });
        const page = await api.getSessionMessages(selected, profile, historyPage());
        if (chatKey(profile, selectedRef.current) !== key) return;
        const rows = displayRows(page.messages);
        const running = !!snapshot.running || !!snapshot.inflight?.streaming;
        setChat(prev => {
          if (!prev || prev.storedId !== selected) return prev;
          const next = { ...prev, runtimeId: snapshot.session_id, running, draft: snapshot.inflight?.assistant || "", rows: prependOlder(prev.rows, rows) };
          cache.current.set(key, next);
          return next;
        });
        if (!running) {
          setWorking("");
          if (rows.at(-1)?.role === "user") setError("The turn stopped without a reply. Edit and retry your message.");
        }
      } catch (e) { if (chatKey(profile, selectedRef.current) === key) setError(`Could not check this turn: ${errorText(e)}`); }
      finally { lastTurnSignal.current = Date.now(); checkingTurn.current = false; }
    };
    const timer = window.setInterval(() => void check(), 10000);
    return () => window.clearInterval(timer);
  }, [chat?.running, selected, profile, connection]);
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
      lastTurnSignal.current = Date.now();
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
        if (!next.running && tail.at(-1)?.role === "user") setError("The turn stopped without a reply. Edit and retry your message.");
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

  // Desktop/hermetic reopen the last focused item in the selected sidebar mode.
  const reopened = useRef(false);
  useEffect(() => {
    if (reopened.current || !desktop || view !== "bots" || connection !== "open" || !profiles.length) return;
    if (homeTab === "chats" && !sessions.length) return;
    reopened.current = true;
    if (homeTab === "chats") {
      const last = localStorage.getItem(LAST_CHAT_KEY);
      const target = sessions.find(row => chatKey(row.profile, row.id) === last) ?? sessions[0];
      if (target) void selectProfile(target.profile, target.id);
    } else {
      const last = localStorage.getItem(LAST_BOT_KEY);
      const target = profiles.find(p => p.name === last) ?? profiles[0];
      if (target) void selectProfile(target.name);
    }
  });

  const selectProfile = async (name: string, targetSession?: string) => {
    if (!profiles.some(p => p.name === name)) return;
    const botSelection = targetSession === undefined;
    if (botSelection) {
      const known = canonical.current.get(name);
      if (known) targetSession = known.resolved_id || known.id;
    }
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
    if (botSelection) localStorage.setItem(LAST_BOT_KEY, name);
    setCreation(null);
    preparedWorkspace.current = "";
    if (!session) { setWorkspaceMode("local"); setBranchName(""); }
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

  const choosePhotos = (incoming: FileList | File[] | null) => {
    const available = Math.max(0, 4 - photos.length);
    const candidates = Array.from(incoming || []);
    if (candidates.length > available) toast.error("Up to 4 photos per message");
    const valid = candidates.slice(0, available).filter(file => {
      if (!/^image\/(png|jpeg|gif|webp|bmp)$/.test(file.type) || !file.size || file.size > 25 * 1024 * 1024) {
        toast.error("Choose a PNG, JPEG, GIF, WebP or BMP under 25 MB"); return false;
      }
      return true;
    });
    setPhotos(current => [...current, ...valid.map(file => ({ file, preview: URL.createObjectURL(file) }))]);
  };
  const chooseFiles = (incoming: FileList | File[] | null) => {
    const candidates = Array.from(incoming || []);
    const available = Math.max(0, 4 - files.length);
    if (candidates.length > available) toast.error("Up to 4 files per message");
    const valid = candidates.slice(0, available).filter(file => {
      if (!file.size || file.size > 10 * 1024 * 1024) { toast.error("Choose a file under 10 MB"); return false; }
      return true;
    });
    setFiles(current => [...current, ...valid]);
  };
  const addAttachments = (incoming: FileList | File[]) => {
    const candidates = Array.from(incoming);
    choosePhotos(candidates.filter(file => file.type.startsWith("image/")));
    chooseFiles(candidates.filter(file => !file.type.startsWith("image/")));
  };
  const send = async (event: FormEvent | null, fromQueue?: QueuedMessage, steer = false) => {
    event?.preventDefault();
    const messagePhotos = fromQueue ? [] : photos;
    const messageFiles = fromQueue ? [] : files;
    const message = (fromQueue?.text ?? text).trim() || (messagePhotos.length ? "What do you see in this photo?" : messageFiles.length ? "Please read the attached file." : "");
    const gw = client.current;
    if (!message || !gw || connection !== "open" || busy || sendingHere || voice.phase !== "idle" || !branchReady) return;
    if ((chat?.running || queued.length) && !fromQueue) {
      if (steer && chat?.running && chat.runtimeId && !photos.length && !files.length && !/^\/[\w.-]+(?:\s|$)/.test(message)) {
        try {
          const result = await gw.request<{ status: string }>("session.steer", { session_id: chat.runtimeId, profile, text: message });
          if (result.status === "queued") {
            updateDraft(composerKey, previous => ({ ...previous, text: "", skills: [] }));
            return;
          }
        } catch (e) { setError(errorText(e)); return; }
      }
      if (photos.length || files.length) { setError("Wait for this turn to finish before sending attachments."); return; }
      setQueue(composerKey, [...(readQueues()[composerKey] || []), queuedMessage(message, pickedSkills)]);
      updateDraft(composerKey, previous => ({ ...previous, text: "", skills: [] }));
      return;
    }
    if (chat?.running) return;
    scrollToLatest();
    setSending(current => ({ ...current, [composerKey]: true })); setError("");
    let target = chat;
    const staged: string[] = [];
    let optimistic = false;
    let optimisticText = "";
    let uploadingFile = "";
    let creationStep: CreationProgress["step"] = "chat";
    try {
      if (!target) {
        let cwd = preparedWorkspace.current;
        if (projectId && !cwd) {
          creationStep = workspaceMode === "worktree" ? "worktree" : "chat";
          setCreation({ step: creationStep });
          const prepared = await fetchJSON<{ cwd: string; branch: string | null }>("/api/mobile/workspace", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ profile, project_id: projectId, mode: workspaceMode, branch: workspaceMode === "worktree" ? effectiveBranch : null }),
          });
          cwd = prepared.cwd;
          preparedWorkspace.current = cwd;
        }
        creationStep = "chat";
        setCreation({ step: "chat" });
        const created = await gw.request<SessionSnapshot>("session.create", { profile, source: "mobile", close_on_disconnect: false, ...(cwd ? { cwd } : {}) });
        target = { runtimeId: created.session_id, storedId: created.stored_session_id || created.session_id, rows: [], draft: "", running: false };
        skipResume.current = target.storedId;
        chatRef.current = target;
        cache.current.set(chatKey(profile, target.storedId), target);
        if (!selected) {
          const newKey = chatKey(profile, target.storedId);
          setComposerDrafts(current => ({ ...current, [newKey]: current[composerKey] ?? { ...emptyDraft(), text } }));
          if (text) window.localStorage.setItem(draftStorageKey(newKey), text);
        }
        setSelected(target.storedId);
        setChat(target);
        routerNavigate(`${chatPath(profile, target.storedId)}?mode=${homeTabRef.current}`, { replace: true });
      }
      const runtimeId = target.runtimeId;
      for (const [index, photo] of messagePhotos.entries()) {
        uploadingFile = `photo:${index}`;
        markUpload(composerKey, uploadingFile, `Uploading ${index + 1} of ${messagePhotos.length + messageFiles.length}…`);
        const uploaded = await uploadChatImage(photo.file, profile);
        await gw.request("image.attach", { session_id: runtimeId, profile, path: uploaded.path });
        staged.push(uploaded.path);
        markUpload(composerKey, uploadingFile, "Ready");
      }
      const refs: string[] = [];
      for (const [index, file] of messageFiles.entries()) {
        uploadingFile = `file:${index}`;
        markUpload(composerKey, uploadingFile, `Uploading ${messagePhotos.length + index + 1} of ${messagePhotos.length + messageFiles.length}…`);
        const data_url = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(reader.error); reader.readAsDataURL(file);
        });
        const result = await gw.request<{ attached: boolean; ref_text: string }>("file.attach", { session_id: runtimeId, profile, name: file.name, data_url });
        if (!result.attached || !result.ref_text) throw new Error(`Could not attach ${file.name}`);
        refs.push(result.ref_text);
        markUpload(composerKey, uploadingFile, "Ready");
      }
      uploadingFile = "";
      const activeSkills = (fromQueue?.skills ?? pickedSkills).filter(skill => message.includes(skill));
      let modelText = message;
      if (activeSkills.length) {
        const instruction = message.replace(/(^|\s)\/[\w.-]+(?=\s|$)/g, "$1").trim();
        const expanded: string[] = [];
        for (const skill of [...new Set(activeSkills)]) {
          const dispatch = await gw.request<{ type: string; message: string }>("command.dispatch", { session_id: runtimeId, profile, name: skill.slice(1), arg: instruction });
          if (!dispatch.message || !["skill", "send"].includes(dispatch.type)) throw new Error(`Could not load ${skill}`);
          expanded.push(dispatch.message);
        }
        modelText = expanded.join("\n\n");
      }
      const submitted = [modelText, ...refs].join("\n");
      const shown = [message, ...refs, ...staged.map(path => `@image:${path}`)].join("\n");
      optimisticText = shown;
      optimistic = true;
      lastTurnSignal.current = Date.now();
      const optimisticRow = { role: "user" as const, text: shown, timestamp: Date.now() / 1000 };
      const storedId = target.storedId;
      const targetKey = chatKey(profile, storedId);
      const base = cache.current.get(targetKey) ?? target;
      const submittedChat = { ...base, running: true, rows: [...base.rows, optimisticRow] };
      cache.current.set(targetKey, submittedChat);
      setChat(prev => prev?.runtimeId === runtimeId && prev.storedId === storedId && mobileRoute(window.location.pathname).profile === profile ? submittedChat : prev);
      try {
        await gw.request("prompt.submit", { session_id: runtimeId, profile, text: submitted });
      } catch (e) {
        // A dashboard restart or reconnect retires runtime ids; re-attach to the stored chat once.
        if (!/session not found/i.test(errorText(e))) throw e;
        const resumed = await gw.request<SessionSnapshot>("session.resume", { profile, session_id: target.storedId, source: "mobile", close_on_disconnect: false, omit_messages: true, defer_history: true });
        const fresh: MobileChat = { ...(cache.current.get(chatKey(profile, target.storedId)) ?? target), runtimeId: resumed.session_id };
        target = fresh;
        if (mobileRoute(window.location.pathname).profile === profile && selectedRef.current === fresh.storedId) chatRef.current = fresh;
        cache.current.set(chatKey(profile, fresh.storedId), fresh);
        setChat(prev => prev && prev.storedId === fresh.storedId && mobileRoute(window.location.pathname).profile === profile ? { ...prev, runtimeId: fresh.runtimeId } : prev);
        await gw.request("prompt.submit", { session_id: fresh.runtimeId, profile, text: submitted });
      }
      staged.length = 0;
      if (creation || creationStep === "chat" && !chat) { setCreation({ step: "working" }); preparedWorkspace.current = ""; }
      for (const photo of messagePhotos) URL.revokeObjectURL(photo.preview);
      const sentKey = chatKey(profile, target.storedId);
      if (fromQueue) {
        setQueue(composerKey, (readQueues()[composerKey] || []).filter(entry => entry.id !== fromQueue.id));
      } else {
        setComposerDrafts(current => ({ ...current, [composerKey]: emptyDraft(), [sentKey]: emptyDraft() }));
        window.localStorage.removeItem(draftStorageKey(composerKey));
        window.localStorage.removeItem(`${draftStorageKey(composerKey)}:skills`);
        window.localStorage.removeItem(draftStorageKey(sentKey));
        window.localStorage.removeItem(`${draftStorageKey(sentKey)}:skills`);
        setUploadStatus(current => ({ ...current, [composerKey]: {}, [sentKey]: {} }));
      }
    } catch (e) {
      if (!chat || creation) setCreation({ step: creationStep, error: errorText(e) });
      if (uploadingFile) markUpload(composerKey, uploadingFile, `Upload failed: ${errorText(e)}`);
      if (staged.length && target) {
        const runtimeId = target.runtimeId;
        await Promise.allSettled(staged.map(path => gw.request("image.detach", { session_id: runtimeId, profile, path })));
      }
      if (optimistic && target) {
        const runtimeId = target.runtimeId;
        const targetKey = chatKey(profile, target.storedId);
        const revert = (current: MobileChat): MobileChat => ({ ...current,
          rows: current.rows.at(-1)?.role === "user" && current.rows.at(-1)?.text === optimisticText ? current.rows.slice(0, -1) : current.rows,
          running: false });
        const cached = cache.current.get(targetKey);
        if (cached) cache.current.set(targetKey, revert(cached));
        setChat(prev => prev?.runtimeId === runtimeId && prev.storedId === target?.storedId && mobileRoute(window.location.pathname).profile === profile ? revert(prev) : prev);
      }
      if (mobileRoute(window.location.pathname).profile === profile && (chat || !creationStep)) setError(errorText(e));
      if (view !== "chat") toast.error(errorText(e));
    }
    finally { setSending(current => ({ ...current, [composerKey]: false })); }
  };

  const queueDraining = useRef(false);
  const failedQueue = useRef(new Set<string>());
  useEffect(() => {
    const entry = queued[0];
    if (!entry || failedQueue.current.has(entry.id) || queueDraining.current || !chat || chat.running || sendingHere || connection !== "open") return;
    queueDraining.current = true;
    void send(null, entry).then(() => {
      if ((readQueues()[composerKey] || []).some(item => item.id === entry.id)) failedQueue.current.add(entry.id);
    }).finally(() => { queueDraining.current = false; });
  }, [queued, chat?.running, chat?.runtimeId, sendingHere, connection, composerKey]);

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
  const pinRail = useRef<HTMLDivElement>(null);
  const [pinEdges, setPinEdges] = useState({ left: false, right: false });
  const measurePins = useCallback(() => {
    const rail = pinRail.current;
    if (!rail) return;
    const left = rail.scrollLeft > 1;
    const right = rail.scrollLeft + rail.clientWidth < rail.scrollWidth - 1;
    setPinEdges(previous => previous.left === left && previous.right === right ? previous : { left, right });
  }, []);
  useLayoutEffect(() => {
    const rail = pinRail.current;
    if (!rail) return;
    measurePins();
    window.addEventListener("resize", measurePins);
    return () => window.removeEventListener("resize", measurePins);
  }, [pinned.length, searchOpen, searchQuery, homeTab, measurePins]);
  const pinIndex = pinned.findIndex(p => p.name === pinMenu);
  const reorderPin = (direction: -1 | 1) => {
    const neighbour = pinned[pinIndex + direction];
    if (neighbour) setPins(current => movePin(current, pinMenu, neighbour.name, profiles.find(p => p.is_default)?.name || "default"));
  };
  const { suggestions, onKeyDown: onSuggestionKeyDown, open: suggestionsOpen } = useComposerSuggestions({ scope: composerKey, text, setText, cursor, gateway: screenGateway, sessionId: chat?.runtimeId, profile, profiles, input: composerInput, onPickSkill: (start, end, name) => composerInput.current?.insertSkill(start, end, name) });
  const chooseHomeTab = (tab: HomeTab) => {
    if (tab === homeTab) return;
    homeTabRef.current = tab;
    setHomeTab(tab);
    localStorage.setItem(HOME_TAB_KEY, tab);
    if (tab === "chats") {
      const last = localStorage.getItem(LAST_CHAT_KEY);
      const target = sessions.find(row => chatKey(row.profile, row.id) === last) ?? sessions[0];
      if (target) {
        localStorage.setItem(LAST_CHAT_KEY, chatKey(target.profile, target.id));
        void selectProfile(target.profile, target.id);
      } else navigate("bots");
    } else {
      const last = localStorage.getItem(LAST_BOT_KEY);
      const target = profiles.find(bot => bot.name === last) ?? profiles[0];
      if (target) void selectProfile(target.name);
      else navigate("bots");
    }
  };
  const chooseSort = (sort: ChatSort) => { setChatSort(sort); localStorage.setItem(CHAT_SORT_KEY, sort); };
  const chooseGrouped = (grouped: boolean) => { setChatsGrouped(grouped); localStorage.setItem(CHAT_GROUP_KEY, grouped ? "1" : "0"); };
  const toggleGroup = (key: string) => setCollapsedGroups(current => {
    const next = new Set(current);
    if (!next.delete(key)) next.add(key);
    localStorage.setItem(CHAT_COLLAPSED_KEY, JSON.stringify([...next]));
    return next;
  });
  const botLabelFor = (name: string) => { const bot = profiles.find(p => p.name === name); return bot ? botName(bot) : name; };
  const chatsShown = filterChats(sessions, homeTab === "chats" && searchOpen ? searchQuery : "", botLabelFor);
  const chatView = chatLayout(chatsShown, { sort: chatSort, grouped: chatsGrouped, collapsed: collapsedGroups, projectNames });
  const writeUnread = async (row: Conversation, unread: boolean) => {
    setSessions(current => current.map(item => item.profile === row.profile && item.id === row.id ? { ...item, unread } : item));
    try { await api.setSessionUnread(row.id, unread, row.profile); }
    catch (e) {
      setSessions(current => current.map(item => item.profile === row.profile && item.id === row.id ? { ...item, unread: row.unread } : item));
      toast.error(errorText(e));
    }
  };
  // Opening a conversation reads it; a reply that lands while it is open stays read.
  useEffect(() => {
    if (view !== "chat" || !selected) return;
    const key = chatKey(profile, selected);
    if (forcedUnread.current && forcedUnread.current !== key) forcedUnread.current = "";
    if (forcedUnread.current === key) return;
    const row = sessions.find(item => item.profile === profile && item.id === selected);
    if (row?.unread) void writeUnread(row, false);
  }, [view, profile, selected, sessions]);
  const openChat = (chat: Conversation) => {
    localStorage.setItem(LAST_CHAT_KEY, chatKey(chat.profile, chat.id));
    void selectProfile(chat.profile, chat.id);
  };
  const archiveOpenChat = async () => {
    const row = sessions.find(item => item.profile === profile && item.id === selected);
    if (view !== "chat" || !row) { toast.message("Only side conversations can be archived"); return; }
    const neighbour = adjacentChat(chatView.visible, chatKeyOf(row), 1) ?? adjacentChat(chatView.visible, chatKeyOf(row), -1);
    try {
      await api.setSessionArchived(row.id, true, row.profile);
      setSessions(current => current.filter(item => !(item.profile === row.profile && item.id === row.id)));
      if (neighbour) void selectProfile(neighbour.profile, neighbour.id); else navigate("bots");
      toast("Conversation archived", { action: { label: "Undo", onClick: () => {
        void api.setSessionArchived(row.id, false, row.profile).then(() => refreshConversations()).catch(e => toast.error(errorText(e)));
      } } });
    } catch (e) { toast.error(errorText(e)); }
  };
  const focusSearch = () => {
    setSearchOpen(true);
    requestAnimationFrame(() => document.querySelector<HTMLInputElement>(".m-search input")?.focus());
  };
  const runShortcut = (action: ShortcutAction) => {
    switch (action.kind) {
      case "tab": chooseHomeTab(action.tab); return;
      case "nth": {
        if (homeTab === "chats") { const target = chatView.visible[action.index]; if (target) openChat(target); }
        else { const target = [...pinned, ...others][action.index]; if (target) void selectProfile(target.name); }
        return;
      }
      case "previous": case "next": {
        const target = adjacentChat(chatView.visible, chatKey(profile, selected), action.kind === "next" ? 1 : -1);
        if (target) openChat(target);
        return;
      }
      case "new": if (profile) void selectProfile(profile, ""); else setNewChatOpen(true); return;
      case "search": focusSearch(); return;
      case "archive": void archiveOpenChat(); return;
      case "unread": {
        const row = sessions.find(item => item.profile === profile && item.id === selected);
        if (view !== "chat" || !row) return;
        forcedUnread.current = chatKey(profile, selected);
        void writeUnread(row, !row.unread);
        return;
      }
      case "help": setHelpOpen(open => !open);
    }
  };
  const runShortcutRef = useRef(runShortcut);
  runShortcutRef.current = runShortcut;
  // Browser tabs own some ⌘ chords; Ctrl works too. hermetic's menu forwards Ctrl.
  useEffect(() => {
    if (!desktop) return;
    const onShortcut = (event: KeyboardEvent) => {
      const action = parseShortcut(event);
      if (!action) return;
      event.preventDefault();
      runShortcutRef.current(action);
    };
    window.addEventListener("keydown", onShortcut);
    return () => window.removeEventListener("keydown", onShortcut);
  }, [desktop]);
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
    return <MobileMessage key={key} profile={profile} row={row} previous={previous} onAction={text => setMessageAction({ text, key: id, scope: composerKey })}
      onFileLink={href => {
        const path = fileLinkPath(href, conversationFolder);
        if (!path) return;
        setFilePath(path);
        setSplitTab("files");
        setSplitOpen(true);
      }} avatarFor={avatarForHandle} reacted={!!reactions[id]} onReact={() => toggleReaction(id)} />;
  };
  const accountMenu = <ProfileDropdown open={profileMenuOpen} onOpenChange={setProfileMenuOpen} showScreen={profiles.some(p => p.name === "samwise")} container={shellRef.current}
    name={account?.display_name || account?.email?.split("@")[0] || "Jorge"} picture={account?.picture || ""} onSignOut={() => void logout()} signingOut={busy} desktop={desktop} />;
  const newChatHero = <NewChatHero projects={projects} projectId={projectId} disabled={!!creation && !creation.error}
    onProject={id => { setProjectId(id); preparedWorkspace.current = ""; setCreation(null); }} />;
  const newChatToolbar = <NewChatToolbar projects={projects} supported={projectSupported} reason={projectReason}
    projectId={projectId} onProject={id => { setProjectId(id); preparedWorkspace.current = ""; setCreation(null); }}
    mode={workspaceMode} onMode={mode => { setWorkspaceMode(mode); preparedWorkspace.current = ""; setCreation(null); }}
    branch={effectiveBranch} onBranch={value => { setBranchName(value); preparedWorkspace.current = ""; setCreation(null); }}
    branchError={branchError} disabled={!!creation && !creation.error} />;
  const creationStatus = creation && <CreationStatus progress={creation} mode={workspaceMode} onRetry={() => composerForm.current?.requestSubmit()} />;
  const HomeScroller = desktop ? "aside" : "main";
  const renderHome = () => <>
    <header className="m-list-header">
      <h1 className="sr-only">{homeTab === "chats" ? "Chats" : "Bots"}</h1>
      {!desktop && <div className="m-list-header-left">{accountMenu}<HomeSwitch value={homeTab} onChange={chooseHomeTab} chatsUnread={unreadCount(sessions)} /></div>}
      <div className="m-top-actions">
        <button type="button" className="m-icon-button" aria-label="Search" onClick={() => setSearchOpen(open => !open)}><Search size={21} aria-hidden="true" /></button>
        <button type="button" className="m-icon-button" aria-label="New conversation" onClick={() => setNewChatOpen(true)}><Plus size={23} aria-hidden="true" /></button>
      </div>
    </header>
    {searchOpen && <div className="m-search"><Search size={19} aria-hidden="true" /><input aria-label="Search bots and conversations" name="mobile-search" autoComplete="off" type="search" placeholder={homeTab === "chats" ? "Search conversations…" : "Search bots & conversations…"} value={searchQuery} onChange={e => { setSearchQuery(e.target.value); setSearchResults([]); setSearchError(""); }} /><button type="button" aria-label="Close search" onClick={() => { setSearchOpen(false); setSearchQuery(""); setSearchResults([]); setSearchError(""); }}><X size={19} aria-hidden="true" /></button></div>}
    {error && view === "bots" && <p role="alert" className="m-error">{error}</p>}
    <HomeScroller className="m-bot-list" ref={listRef} onScroll={e => { listScroll.current = e.currentTarget.scrollTop; }}>
      {homeTab === "chats" ? <>
        <ChatsToolbar sort={chatSort} onSort={chooseSort} grouped={chatsGrouped} onGrouped={chooseGrouped} />
        <ChatsPanel groups={chatView.groups} grouped={chatsGrouped} collapsed={collapsedGroups} onToggleGroup={toggleGroup} currentKey={view === "chat" ? chatKey(profile, selected) : ""} onOpen={openChat}
          onNewInProject={group => { void (async () => {
            const bot = group.chats[0]?.profile;
            if (!bot) return;
            try {
              const choices = await fetchJSON<{ projects: ProjectChoice[]; supported: boolean; reason?: string }>(`/api/mobile/projects?profile=${encodeURIComponent(bot)}`);
              if (!choices.supported) { toast.error(choices.reason || "Project workspaces are unavailable for this bot."); return; }
              const project = choices.projects.find(item => item.path === group.key);
              if (!project) { toast.error("This folder is not a registered project."); return; }
              desiredProjectPath.current = project.path;
              await selectProfile(bot, "");
            } catch (e) { toast.error(`Could not open project: ${errorText(e)}`); }
          })(); }}
          bots={{ label: botLabelFor, avatar: name => avatars[name] }} empty={searchOpen && searchQuery.trim() ? "No matching conversations." : "No conversations yet."} />
      </> : <>
      {!!pinned.filter(matching).length && <div className="m-pinned-wrap">
        <div className="m-pinned" aria-label="Pinned bots" ref={pinRail} onScroll={measurePins}>{pinned.filter(matching).map(p => <div className="m-pinned-item" key={p.name}>
          <button type="button" className="m-pinned-bot" aria-current={view === "chat" && p.name === profile ? "page" : undefined} aria-label={`${botName(p)}${waitingByBot[p.name] || p.name === profile && !!activePrompts.length ? ", needs your input" : ""}`} {...botGesture(p.name)}>
            {avatar(p)}<span title={botName(p)}>{botName(p)}</span>
          </button>
          <button type="button" className="m-pinned-more" aria-label={`Options for ${botName(p)}`} onClick={() => setPinMenu(p.name)}><MoreHorizontal size={17} aria-hidden="true" /></button>
        </div>)}</div>
        {pinEdges.left && <button type="button" className="m-pinned-scroll m-pinned-scroll-left" aria-label="Scroll pinned bots left" onClick={() => pinRail.current?.scrollBy({ left: -184, behavior: "smooth" })}><ChevronRight size={18} aria-hidden="true" /></button>}
        {pinEdges.right && <button type="button" className="m-pinned-scroll m-pinned-scroll-right" aria-label="Scroll pinned bots right" onClick={() => pinRail.current?.scrollBy({ left: 184, behavior: "smooth" })}><ChevronRight size={18} aria-hidden="true" /></button>}
      </div>}
      <div className="m-bot-rows">{others.filter(matching).map(p => <div className="m-bot-row" key={p.name}>
        <button type="button" className="m-bot-main" aria-current={view === "chat" && p.name === profile ? "page" : undefined} {...botGesture(p.name)}>
          {avatar(p)}<span className="m-bot-copy"><span className="m-bot-heading"><strong>{botName(p)}</strong><time>{activityTime(activityByBot[p.name]?.lastActive || 0)}</time></span><small>{botPreview(p) || "Start a conversation"}</small></span>
        </button>
        <button type="button" className="m-bot-more" aria-label={`Options for ${botName(p)}`} onClick={() => setPinMenu(p.name)}><MoreHorizontal size={19} aria-hidden="true" /></button>
      </div>)}</div>
      {!profiles.length && <div className="m-loading" role="status" aria-label="Finding your bots"><Skeleton /><Skeleton /><Skeleton /></div>}
      {searchOpen && searchQuery.trim() && <section className="m-search-results" aria-label="Matching conversations">
        {searchError && <p role="alert" className="m-error">Search unavailable: {searchError}</p>}
        {searchResults.map(result => <button type="button" className="m-search-result" key={`${result.profile}/${result.session}`} onClick={() => { void selectProfile(result.profile, result.session); }}><MessageSquare size={19} aria-hidden="true" /><span><strong>{result.title}</strong><small>{profiles.find(p => p.name === result.profile)?.display_name || result.profile} · {result.preview}</small></span></button>)}
        {!searchResults.length && !searchError && <p className="m-muted">No matching conversations.</p>}
      </section>}
      </>}
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
    {desktop && <footer className="m-sidebar-footer">{accountMenu}<HomeSwitch value={homeTab} onChange={chooseHomeTab} chatsUnread={unreadCount(sessions)} /></footer>}
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
  const continueAfterScreen = async () => {
    const gw = client.current;
    if (!gw || !chat?.runtimeId) throw new Error("Open Samwise's chat before continuing");
    const text = "I handed back the screen; continue from the current state.";
    if (chat.running) {
      const result = await gw.request<{ status: string }>("session.steer", { session_id: chat.runtimeId, profile, text });
      if (result.status === "rejected") await gw.request("prompt.submit", { session_id: chat.runtimeId, profile, text });
    } else await gw.request("prompt.submit", { session_id: chat.runtimeId, profile, text });
    navigate("chat");
  };

  return <div className={`m-shell${window.hermetic ? " m-native" : ""}`} data-theme={theme} ref={shellRef}
    style={window.hermetic ? { "--m-native-titlebar-inset": `${window.hermetic.titlebarInset}px`, "--m-split-width": `${splitWidth}px` } as CSSProperties : { "--m-split-width": `${splitWidth}px` } as CSSProperties}>
    <Toaster theme={theme} position="top-center" toastOptions={{ style: { background: "var(--card)", color: "var(--foreground)", borderColor: "var(--border)" } }} />
    <div className="m-stage">
      <div className={`m-view m-home${swiping && !(view === "board" && route.task) ? " m-swipe-preview" : ""}`} ref={view === "board" && route.task ? undefined : swipePreview} aria-hidden={!desktop && view !== "bots"} inert={!desktop && view !== "bots"}>
        {renderHome()}
      </div>
      {desktop && view === "bots" && <main className="m-desktop-empty"><MessageSquare size={30} aria-hidden="true" /><h2>{homeTab === "chats" ? "Choose a conversation" : "Choose a bot"}</h2></main>}
      {swiping && view === "board" && route.task && <div className="m-view m-board-swipe-preview m-swipe-preview" ref={swipePreview} aria-hidden="true" inert>
        <header className="m-header"><h1 className="m-page-title">Board</h1></header>
        <main className="m-main"><MobileKanban onSelectTask={() => {}} getSavedScroll={getBoardScroll} onScroll={() => {}} /></main>
      </div>}
      <AnimatePresence initial={false} custom={skipExit}>
        {view !== "bots" && <motion.div key={view} className={`m-view m-detail${view === "chat" && splitOpen && desktop ? " m-with-split" : ""}`} custom={skipExit} style={{ x: panX, bottom: view === "chat" && terminalVisible ? terminalHeight : undefined }}
          variants={{ enter: { x: "100%" }, active: { x: 0 }, exit: (skip: boolean) => ({ x: "100%", transition: { duration: skip || reducedMotion ? 0 : 0.18 } }) }}
          initial="enter" animate="active" exit="exit" transition={{ duration: reducedMotion ? 0 : 0.18, ease: "easeOut" }}>
      <>
      <header className="m-header">{(!desktop || view === "board" && !!route.task) && <button type="button" className="m-icon-button" aria-label={route.task ? "Back to board" : "Back to bots"} onClick={() => route.task ? routerNavigate("/m/board") : goBack()}><ArrowLeft size={22} aria-hidden="true" /></button>}
        {view === "chat" && currentBot ? <button type="button" className="m-chat-identity" aria-label={`Open ${name} activity`} onClick={() => setActivityOpen(true)}>{avatar(currentBot)}<span>{name}</span><span className="sr-only" role="status">{status}</span></button> : view === "chat" ? <div className="m-chat-identity" role="status" aria-label="Loading bot"><Skeleton className="m-avatar-skeleton" /><Skeleton className="m-name-skeleton" /></div> : view === "screen" && (profile === "samwise" || profile === "default") ? <div className="m-chat-identity m-screen-identity">{currentBot && avatar(currentBot)}<span>{name}’s computer</span><small role="status" aria-live="polite">{screenState}</small></div> : <h1 className="m-page-title">{{ board: route.task ? "Task" : "Board", screen: `${name} computer`, settings: "Settings", terminal: `${name} terminal`, subscriptions: "Subscriptions", bots: "Bots", chat: name }[view]}</h1>}
        {view === "chat" && <button type="button" className="m-icon-button" aria-label={splitOpen ? "Close right split" : "Open right split"} aria-expanded={splitOpen} onClick={() => setSplitOpen(open => !open)}><PanelRight size={20} aria-hidden="true" /></button>}
      </header>
      {error && <div role="alert" className="m-error">{error}{view === "chat" && !chat?.running && chat?.rows.some(row => row.role === "user") && <button type="button" aria-label="Edit and retry message" onClick={() => {
        const last = [...chat.rows].reverse().find(row => row.role === "user");
        if (last) { setText(last.text); composerInput.current?.focus(); setError(""); }
      }}>Edit and retry</button>}</div>}
      <main className="m-main" onDragOver={view === "chat" ? event => { if (event.dataTransfer.types.includes("Files")) event.preventDefault(); } : undefined}
        onDrop={view === "chat" ? event => { if (event.dataTransfer.files.length) { event.preventDefault(); addAttachments(event.dataTransfer.files); } } : undefined}>
        {view === "chat" && <>
          <div className="m-messages" ref={messagesRef} onClickCapture={event => {
            const link = (event.target as HTMLElement).closest("a[href]");
            const url = link && localPreviewLink(link.getAttribute("href") || "");
            if (!url) return;
            event.preventDefault();
            setBrowserUrl(url);
            setSplitTab("browser");
            setSplitOpen(true);
          }} onScroll={event => { onScroll(event); if (userScrolled() && event.currentTarget.scrollTop < 96) void loadOlder(); }} role="log" aria-live="polite">
            <div className="m-message-content">
              {paging.key === chatKey(profile, selected) && paging.hasOlder && <button type="button" className="m-older" disabled={paging.loading} onClick={() => void loadOlder()}>{paging.loading ? "Loading earlier…" : "Earlier messages"}</button>}
              {paging.key === chatKey(profile, selected) && paging.error && <p role="alert" className="m-error">History unavailable: {paging.error}</p>}
              {selected && !error && (!chat || !chat.rows.length && paging.loading) && <div className="m-loading" role="status" aria-label="Loading conversation"><Skeleton /><Skeleton /><Skeleton /></div>}
              {!chat && !selected && <>{newChatHero}{creationStatus}</>}
              {!!selected && !!creation && creationStatus}
              {chat && groupNoticeRows(chat.rows).map((group, index, groups) => {
                const previous = groups[index - 1]?.at(-1);
                if (group.length > 1) return <details className="m-notice-group" key={index}>
                  <summary>{group.length} updates</summary>
                  <div>{group.map((row, item) => renderMessage(row, item ? group[item - 1] : previous, `${index}-${item}`))}</div>
                </details>;
                return renderMessage(group[0], previous, String(index));
              })}
              {chat?.draft && <article className="m-message m-assistant m-streaming"><div className="m-bubble"><Markdown content={chat.draft} streaming /></div></article>}
              {chat?.running && !chatPrompts.length && <div className="m-turn-status" role="status" aria-live="polite"><div className="m-typing" aria-label="Bot is typing"><span /><span /><span /></div><p className="m-thinking">{working || (chat.draft ? "Writing…" : "Thinking…")}</p></div>}
              <AnimatePresence initial={false}>{chatPrompts.map(p => <motion.div className="m-inline-request" data-method={p.request.method} key={p.request.id}
                exit={{ opacity: 0, height: 0 }} transition={{ duration: reducedMotion ? 0 : 0.18 }}><Badge className="m-request-label">{name} needs your input</Badge><PromptCard pending={p} onAnswer={answer} onReceived={received} /></motion.div>)}</AnimatePresence>
              {!!otherPrompts.length && <Button className="m-other-requests" variant="outline" type="button" onClick={() => navigate("bots")}>{otherPrompts.length} request{otherPrompts.length === 1 ? "" : "s"} in other conversations · View requests</Button>}
            </div>
          </div>
          {!atBottom && <div className="m-jump-row"><button className="m-jump-latest" type="button" onClick={scrollToLatest} aria-label="Jump to latest message"><ArrowDown size={19} aria-hidden="true" /></button></div>}
          {!!queued.length && <div className="m-queued" aria-label="Queued messages">{queued.map((entry, index) => <div key={entry.id} className="m-queued-entry"><span>Queued {index + 1}: {entry.text}</span><button type="button" onClick={() => { failedQueue.current.delete(entry.id); setText(entry.text); updateDraft(composerKey, previous => ({ ...previous, text: entry.text, skills: entry.skills || [] })); setQueue(composerKey, (readQueues()[composerKey] || []).filter(item => item.id !== entry.id)); composerInput.current?.focus(); }}>Edit</button><button type="button" aria-label={`Remove queued message ${index + 1}`} onClick={() => setQueue(composerKey, (readQueues()[composerKey] || []).filter(item => item.id !== entry.id))}>Remove</button></div>)}</div>}
          <form ref={composerForm} className="m-composer" onSubmit={e => { void send(e, undefined, steerNext); setSteerNext(false); }}>
            {voice.phase !== "idle" && <p className="m-voice-status" role="status" aria-live="polite">{voice.phase === "recording" ? "Recording · tap to stop" : voice.phase === "starting" ? "Starting microphone…" : "Transcribing…"}</p>}
            {!!photos.length && <div className="m-photo-previews" aria-label="Selected photos">{photos.map((photo, index) => <div className="m-photo-preview" key={photo.preview}>
              <img src={photo.preview} alt={photo.file.name} /><span className="m-photo-label">{photo.file.name} · {Math.ceil(photo.file.size / 1024)} KB{uploadStatus[composerKey]?.[`photo:${index}`] && <small role="status">{uploadStatus[composerKey][`photo:${index}`]}</small>}</span><button type="button" aria-label={`Remove ${photo.file.name}`} onClick={() => { URL.revokeObjectURL(photo.preview); setPhotos(current => current.filter((_, i) => i !== index)); }}><X size={15} aria-hidden="true" /></button>
            </div>)}</div>}
            {!!files.length && <div className="m-file-previews" aria-label="Selected files">{files.map((file, index) => <span key={`${file.name}-${index}`}><FileUp size={15} aria-hidden="true" /><span>{file.name} · {Math.ceil(file.size / 1024)} KB{uploadStatus[composerKey]?.[`file:${index}`] && <small role="status">{uploadStatus[composerKey][`file:${index}`]}</small>}</span><button type="button" aria-label={`Remove ${file.name}`} onClick={() => setFiles(current => current.filter((_, i) => i !== index))}><X size={15} aria-hidden="true" /></button></span>)}</div>}
            {suggestions}
            {chat?.running && !desktop && <button type="button" className="m-steer-toggle" aria-label="Steer this turn" aria-pressed={steerNext} onClick={() => setSteerNext(value => !value)}>Steer this turn</button>}
            <div className="m-composer-row"><input hidden ref={photoInput} type="file" accept="image/png,image/jpeg,image/gif,image/webp,image/bmp" multiple onChange={e => { choosePhotos(e.target.files); e.target.value = ""; }} />
              <input hidden ref={fileInput} type="file" multiple onChange={e => { chooseFiles(e.target.files); e.target.value = ""; }} />
              <DropdownMenu.Root><DropdownMenu.Trigger className="m-add-photo" aria-label="Attach photo or file" disabled={busy || sendingHere || connection !== "open"}><Plus size={20} aria-hidden="true" /></DropdownMenu.Trigger>
                <DropdownMenu.Portal container={shellRef.current}><DropdownMenu.Content align="start" side="top" sideOffset={8} className="m-dropdown m-attach-menu">
                  <DropdownMenu.Item onSelect={() => photoInput.current?.click()}><ImagePlus size={17} aria-hidden="true" />Photo</DropdownMenu.Item>
                  <DropdownMenu.Item onSelect={() => fileInput.current?.click()}><FileUp size={17} aria-hidden="true" />File</DropdownMenu.Item>
                </DropdownMenu.Content></DropdownMenu.Portal>
              </DropdownMenu.Root>
              <SkillEditor ref={composerInput} scope={composerKey} value={text} picked={pickedSkills} placeholder={`Message ${name}…`} onChange={(value, position, skills) => {
                updateDraft(composerKey, previous => previous.text === value && previous.cursor === position && previous.skills.join("|") === skills.join("|") ? previous : { ...previous, text: value, cursor: position, skills });
              }} onFiles={addAttachments} onKeyDown={e => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && !e.nativeEvent.isComposing) {
                  e.preventDefault(); void send(null, undefined, true); return;
                }
                if (onSuggestionKeyDown(e)) return;
                if (e.key === "Escape" && chat?.running && chat.runtimeId) {
                  e.preventDefault();
                  void client.current?.request("session.interrupt", { profile, session_id: chat.runtimeId }).catch(error => setError(errorText(error)));
                  return;
                }
                if (desktop && e.key === "ArrowUp" && !text && !suggestionsOpen) {
                  const last = [...(chat?.rows || [])].reverse().find(row => row.role === "user");
                  if (last) { e.preventDefault(); setText(last.text.split(/\n\n--- Attached Context ---\n/)[0].replace(/^@(?:image|file):[^\n]+\n?/gm, "").trim()); }
                  return;
                }
                if (desktop && e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing && !suggestionsOpen) {
                  e.preventDefault();
                  composerForm.current?.requestSubmit();
                }
              }} />
              {chat?.running && <button type="button" className="m-stop" aria-label="Stop" onClick={() => { void client.current?.request("session.interrupt", { profile, session_id: chat.runtimeId }).catch(e => setError(errorText(e))); }}><Square size={16} fill="currentColor" /></button>}
              {voice.phase === "recording" ? <button type="button" className="m-voice-stop" aria-label="Stop recording" onClick={voice.stop}><Square size={16} fill="currentColor" aria-hidden="true" /></button>
                : voice.phase !== "idle" ? <button type="button" className="m-voice-loading" aria-label={voice.phase === "starting" ? "Starting microphone" : "Transcribing audio"} disabled><LoaderCircle size={20} aria-hidden="true" /></button>
                : !text.trim() && !photos.length && !files.length ? <button type="button" className="m-voice-start" aria-label="Dictate message" disabled={busy || sendingHere || connection !== "open"} onClick={() => void voice.start()}><Mic size={20} aria-hidden="true" /></button>
                : <Button type="submit" variant="primary" size="icon" className="m-send" aria-label="Send" disabled={busy || sendingHere || connection !== "open" || !branchReady}><ArrowUp size={20} /></Button>}
            </div>
            {!chat && !selected && newChatToolbar}
          </form>
        </>}
        {view === "board" && <MobileKanban taskId={route.task} onSelectTask={id => routerNavigate(taskPath(id))} getSavedScroll={getBoardScroll} onScroll={setBoardScroll} avatars={avatars} />}
        {view === "screen" && (profile === "samwise" || profile === "default" ? <MobileScreen key={profile} gateway={screenGateway} profile={profile} name={name} onStateChange={setScreenState} onContinue={profile === "samwise" ? continueAfterScreen : undefined} /> : <section className="m-screen m-computer-activity" aria-label={`${name} computer activity`}>
          <p className="m-activity-now" role="status"><i className="m-status-dot" aria-hidden="true" />{status}</p>
          {liveSessions.filter(session => session.status === "running" || session.status === "waiting").map(session => <p key={session.id}>{session.title || "Conversation"} · {session.status}</p>)}
          <ul>{activity.map((item, index) => <li key={index}>{item}</li>)}</ul>
          {!activity.length && <p className="m-muted">{activityByBot[profile]?.preview || "Waiting for the next activity."}</p>}
        </section>)}
        {view === "subscriptions" && <MobileSubscriptions sessionId={chat?.runtimeId || selected || undefined} />}
        {view === "settings" && <section className="m-settings">
          <div className="m-settings-group"><h3>Appearance</h3><div className="m-theme-choices" role="group" aria-label="Appearance">{(["system", "light", "dark"] as const).map(choice => <Button key={choice} type="button" variant={theme === choice ? "outline" : "secondary"} aria-pressed={theme === choice} onClick={() => setTheme(choice)}>{choice === "system" ? <Monitor size={17} /> : choice === "light" ? <Sun size={17} /> : <Moon size={17} />}{choice[0].toUpperCase() + choice.slice(1)}</Button>)}</div></div>
          <div className="m-settings-group"><h3>Notifications</h3><button className="m-setting-action" type="button" disabled={!pushAvailable() || busy} onClick={() => void togglePush()}>{pushEnabled ? <BellOff size={19} /> : <Bell size={19} />}{pushAvailable() ? (pushEnabled ? "Turn off notifications" : "Turn on notifications") : "Unavailable in this browser"}<ChevronRight size={17} /></button></div>
          <div className="m-settings-group"><h3>Account</h3><button className="m-setting-action" type="button" disabled={busy} onClick={() => void logout()}><LockKeyhole size={19} />Sign out<ChevronRight size={17} /></button><p className="m-muted">Other devices stay signed in.</p></div>
        </section>}
      </main>
    </>
      </motion.div>}
      </AnimatePresence>
      {view === "chat" && <RightSplit open={splitOpen} width={splitWidth} onWidth={resizeSplit} onClose={() => setSplitOpen(false)}
        tab={splitTab === "screen" && !screenVisible ? "browser" : splitTab} onTab={setSplitTab}
        browserUrl={browserUrl} onBrowserUrl={setBrowserUrl} suggestions={conversationLocalLinks(chat?.rows.map(row => row.text) || [])} filePath={filePath} profile={profile} session={selected}
        screen={screenVisible ? <MobileScreen gateway={screenGateway} profile={profile} name={name} onStateChange={setScreenState} onContinue={profile === "samwise" ? continueAfterScreen : undefined} /> : undefined} />}
      <BotTerminalDock profile={terminalProfile} session={terminalSession} open={terminalVisible} fullScreen={view === "terminal"}
      height={terminalHeight} onHeightChange={setTerminalHeight}
      onClose={() => { if (view === "terminal") goBack(); else setTerminalOpenByChat(previous => ({ ...previous, [chatKey(profile, selected)]: false })); }} />
    </div>
    {newChatOpen && <Sheet open={newChatOpen} onClose={() => setNewChatOpen(false)} label="Choose a bot">
      <div className="m-activity-head"><h2>New conversation</h2><button type="button" className="m-icon-button" aria-label="Close bot picker" onClick={() => setNewChatOpen(false)}><X size={20} aria-hidden="true" /></button></div>
      <div className="m-bot-picker">{[...pinned, ...others].map(p => <button type="button" key={p.name} onClick={() => { setNewChatOpen(false); void selectProfile(p.name, ""); }}>{avatar(p)}{botName(p)}</button>)}</div>
    </Sheet>}
    {!!pinMenu && <Sheet open={!!pinMenu} onClose={() => setPinMenu("")} label="Bot options">
      <div className="m-activity-head"><h2>{profiles.find(p => p.name === pinMenu)?.display_name || pinMenu}</h2><button type="button" className="m-icon-button" aria-label="Close bot options" onClick={() => setPinMenu("")}><X size={20} aria-hidden="true" /></button></div>
      <button type="button" className="m-pin-choice" onClick={() => { setPins(current => pinIndex >= 0
        ? current.filter(p => p !== pinMenu && !(p === "default" && pinMenu === profiles.find(bot => bot.is_default)?.name))
        : [...current, pinMenu]); setPinMenu(""); }}>{pinIndex >= 0 ? "Unpin bot" : "Pin bot"}</button>
      {pinIndex > 0 && <button type="button" className="m-pin-choice" onClick={() => reorderPin(-1)}>Move pin left</button>}
      {pinIndex >= 0 && pinIndex < pinned.length - 1 && <button type="button" className="m-pin-choice" onClick={() => reorderPin(1)}>Move pin right</button>}
      <button type="button" className="m-pin-choice" onClick={() => { routerNavigate(`/m/terminal/${encodeURIComponent(pinMenu)}${pinMenu === profile && selected ? `/${encodeURIComponent(selected)}` : ""}`); setPinMenu(""); }}>Terminal</button>
    </Sheet>}
    {messageAction?.scope === composerKey && <Sheet open onClose={() => setMessageAction(null)} label="Message actions">
      <div className="m-activity-head"><h2>Message</h2><button type="button" className="m-icon-button" aria-label="Close message actions" onClick={() => setMessageAction(null)}><X size={20} aria-hidden="true" /></button></div>
      <button type="button" className="m-pin-choice" onClick={() => { void copyTextToClipboard(messageAction.text).then(copied => { if (copied) { setMessageAction(null); toast.success("Copied message"); } else toast.error("Could not copy message"); }); }}><Copy size={18} aria-hidden="true" />Copy text</button>
      <button type="button" className="m-pin-choice" onClick={() => { toggleReaction(messageAction.key); setMessageAction(null); }}><ThumbsUp size={18} aria-hidden="true" />{reactions[messageAction.key] ? "Remove thumbs up" : "React thumbs up"}</button>
    </Sheet>}
    <ShortcutHelp open={helpOpen} onClose={() => setHelpOpen(false)} />
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
      <button type="button" className="m-pin-choice" onClick={() => { setActivityOpen(false); routerNavigate(`/m/terminal/${encodeURIComponent(profile)}${selected ? `/${encodeURIComponent(selected)}` : ""}`); }}><span>Terminal</span></button>
      <button type="button" className="m-pin-choice" onClick={() => { setActivityOpen(false); setConversationsOpen(true); }}><MessageSquare size={18} aria-hidden="true" />Conversations</button>
      {activity.length ? <ul>{activity.map((item, index) => <li key={index}>{item}</li>)}</ul> : <p className="m-muted">No activity yet.</p>}
    </Sheet>}
  </div>;
}
