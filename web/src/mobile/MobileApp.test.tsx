// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { BrowserRouter } from "react-router";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  running: false,
  latestBuildIdle: null as (() => boolean) | null,
  liveSessions: [] as Array<{ id: string; session_key: string; title: string; status: string }>,
  waitingProfile: "",
  rosterPreview: {} as Record<string, string>,
  rosterAbsent: "",
  fetchJSON: vi.fn(async (url: string, _init?: RequestInit): Promise<unknown> => { void _init; return url.startsWith("/api/mobile/projects") ? { projects: [], supported: true } : { server_host: "testhost", client_on_server_host: false, profiles: {} }; }),
  existingCanonical: "",
  getProfiles: vi.fn(async () => ({ profiles: [{ name: "frodo", is_default: true }, { name: "gandalf", is_default: false }] })),
  getAllProfileSessions: vi.fn(async (_limit?: number, archived?: "exclude" | "only"): Promise<{ sessions: Array<{ id: string; profile: string; title: string; preview: string; last_active: number; message_count: number; pinned?: boolean }> }> => { void _limit; return { sessions: archived === "only" ? [] : [
    { id: "side-frodo", profile: "frodo", title: "Prior chat", preview: "Earlier from frodo", last_active: 20, message_count: 2 },
    { id: "gandalf-found", profile: "gandalf", title: "Found chat", preview: "Match in message", last_active: 10, message_count: 2 },
  ] }; }),
  renameSession: vi.fn(async (_id: string, title: string, _profile: string) => { void _profile; return { ok: true, title }; }),
  setSessionArchived: vi.fn(async (_id: string, archived: boolean, _profile: string) => { void _profile; return { ok: true, archived }; }),
  setSessionUnread: vi.fn(async (_id: string, unread: boolean, _profile: string) => { void _profile; return { ok: true, unread }; }),
  setSessionPinned: vi.fn(async (_id: string, pinned: boolean, _profile: string) => { void _profile; return { ok: true, pinned }; }),
  uploadChatImage: vi.fn(async () => ({ path: "/sample/image.png", name: "image.png", bytes: 68, mime_type: "image/png" })),
  transcribeAudio: vi.fn(async (_dataUrl: string, _mimeType: string, _profile: string) => { void _dataUrl; void _mimeType; void _profile; return { ok: true, transcript: "Dictated words" }; }),
  getSessionMessages: vi.fn(async (_id: string, profile: string, page?: { offset?: number }): Promise<{ messages: Array<{ role: string; content: string; timestamp?: number }> }> => { void page; return { messages: [{ role: "user", content: `Earlier from ${profile}` }] }; }),
  searchSessions: vi.fn(async (_query: string, profile: string) => ({ results: profile === "gandalf" ? [{ session_id: "gandalf-found", title: "Found chat", snippet: "Match in message", last_active: 10 }] : [] })),
  request: vi.fn(async (method: string, params?: { session_id?: string; profile?: string }) => {
    if (method === "profiles.list") return { profiles: ["frodo", "gandalf", "samwise", "author", "default", "gimli"].map(name => ({ name, canonical_session: name === mocks.rosterAbsent ? null : {
      id: name === "gandalf" ? "gandalf-stored" : "stored", resolved_id: name === "gandalf" ? "gandalf-stored" : "stored",
      preview: mocks.rosterPreview[name] || `Earlier from ${name}`, last_active: 50,
    } })) };
    if (method === "session.list") return { sessions: params?.profile === mocks.existingCanonical ? [{ id: "already-stored", resolved_id: "already-current" }] : [] };
    if (method === "session.active_list") return { sessions: mocks.waitingProfile && params?.profile !== mocks.waitingProfile ? [] : mocks.liveSessions };
    if (method === "session.resume") return { session_id: params?.session_id === "other-stored" ? "other-runtime" : "runtime", stored_session_id: params?.session_id, messages: [{ role: "user", text: `Earlier from ${params?.profile}` }], running: mocks.running };
    if (method === "session.create") return { session_id: "new-runtime", stored_session_id: "new-stored", messages: [] };
    if (method === "session.steer") return { status: "queued" };
    if (method === "commands.catalog") return { categories: [{ name: "Session", pairs: [["/help", "Show help"]] }], pairs: [["/help", "Show help"], ["/my-skill", "Run skill"]] };
    if (method === "complete.slash") return { items: [{ text: "/help", display: "/help", meta: "Show help", kind: "command" }], replace_from: 1 };
    if (method === "file.attach") return { attached: true, ref_text: "@file:attachments/test.txt" };
    return {};
  }),
  events: new Set<(event: unknown) => void>(),
  requests: new Set<(request: unknown) => void>(),
}));
vi.mock("@/lib/chatImagePaste", () => ({ uploadChatImage: mocks.uploadChatImage }));
vi.mock("@/lib/api", () => ({ HERMES_BASE_PATH: "", fetchJSON: mocks.fetchJSON, api: { getProfiles: mocks.getProfiles, getAllProfileSessions: mocks.getAllProfileSessions, getSessionMessages: mocks.getSessionMessages, searchSessions: mocks.searchSessions, renameSession: mocks.renameSession, setSessionArchived: mocks.setSessionArchived, setSessionUnread: mocks.setSessionUnread, setSessionPinned: mocks.setSessionPinned, transcribeAudio: mocks.transcribeAudio } }));
vi.mock("@/lib/gatewayClient", () => ({ GatewayClient: class {
  connectionState = "idle";
  onState(handler: (state: string) => void) { handler("idle"); this.stateHandler = handler; return () => {}; }
  stateHandler: (state: string) => void = () => {};
  onEvent(handler: (event: unknown) => void) { mocks.events.add(handler); return () => { mocks.events.delete(handler); }; }
  onRequest(handler: (request: unknown) => void) { mocks.requests.add(handler); return () => { mocks.requests.delete(handler); }; }
  async connect() { this.connectionState = "open"; this.stateHandler("open"); }
  request = mocks.request;
  close() { this.connectionState = "closed"; }
} }));
vi.mock("./useLatestBuild", () => ({ useLatestBuild: (_path: string, idle: () => boolean) => { mocks.latestBuildIdle = idle; } }));
vi.mock("./mobile-push", () => ({ pushAvailable: () => false, registerMobileWorker: vi.fn(), subscribePush: vi.fn(), unsubscribePush: vi.fn(), localSignOut: vi.fn() }));
vi.mock("./MobileKanban", () => ({ default: ({ taskId, onSelectTask }: { taskId?: string; onSelectTask: (id: string) => void }) => <div>{taskId ? `Task ${taskId}` : <button onClick={() => onSelectTask("t-1")}>Open task</button>}</div> }));
vi.mock("./BotTerminalDock", () => ({ default: () => null }));
vi.mock("./MobileScreen", () => ({ default: ({ onContinue }: { onContinue: () => Promise<void> }) => <button onClick={() => void onContinue()}>Continue after hand back</button> }));
import MobileApp from "./MobileApp";
import { PIN_STORAGE_KEY } from "./home-data";

let root: Root;
let host: HTMLDivElement;
const storage = new Map<string, string>();
beforeEach(() => { storage.clear(); vi.stubGlobal('localStorage', { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => { storage.set(key, value); }, removeItem: (key: string) => { storage.delete(key); } }); vi.clearAllMocks(); mocks.getAllProfileSessions.mockImplementation(async (_limit, archived) => ({ sessions: archived === "only" ? [] : [
    { id: "side-frodo", profile: "frodo", title: "Prior chat", preview: "Earlier from frodo", last_active: 20, message_count: 2 },
    { id: "gandalf-found", profile: "gandalf", title: "Found chat", preview: "Match in message", last_active: 10, message_count: 2 },
  ] })); mocks.renameSession.mockImplementation(async (_id, title) => ({ ok: true, title })); mocks.setSessionArchived.mockImplementation(async (_id, archived) => ({ ok: true, archived })); mocks.setSessionPinned.mockImplementation(async (_id, pinned) => ({ ok: true, pinned })); mocks.getSessionMessages.mockImplementation(async (_id, profile) => ({ messages: [{ role: "user", content: `Earlier from ${profile}` }] })); mocks.running = false; mocks.liveSessions = []; mocks.waitingProfile = ""; mocks.rosterPreview = {}; mocks.rosterAbsent = ""; mocks.existingCanonical = ""; window.history.replaceState({}, "", "/m"); vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }))); HTMLDialogElement.prototype.showModal = function () { this.open = true; }; HTMLDialogElement.prototype.close = function () { this.open = false; }; (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true; Element.prototype.scrollIntoView = vi.fn(); host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); mocks.events.clear(); mocks.requests.clear(); vi.restoreAllMocks(); vi.unstubAllGlobals(); window.history.replaceState({}, "", "/m"); });
const renderApp = async () => { await act(async () => root.render(<BrowserRouter><MobileApp /></BrowserRouter>)); };
const settle = async () => { await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); }); };

const openDestination = async (label: string) => {
  await act(async () => (host.querySelector('[aria-label="Profile menu"]') as HTMLButtonElement).dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 })));
  await act(async () => (Array.from(host.querySelectorAll('.m-dropdown a')).find(link => link.textContent === label) as HTMLAnchorElement).click());
};

const openConversations = async () => {
  await act(async () => (host.querySelector('.m-chat-identity') as HTMLButtonElement).click());
  await act(async () => (Array.from(host.querySelectorAll('.m-activity .m-pin-choice')).find(button => button.textContent === 'Conversations') as HTMLButtonElement).click());
};

it.each(["another chat", "new conversation"])("keeps a foreign-session approval out of %s but answerable in its attributed inbox", async (mode) => {
  mocks.liveSessions = [
    { id: "runtime", session_key: "stored", title: "Current chat", status: "idle" },
    { id: "other-runtime", session_key: "other-stored", title: "Approval owner", status: "idle" },
  ];
  await renderApp();
  await settle(); await settle();
  await act(async () => (host.querySelector('.m-pinned-bot') as HTMLButtonElement).click());
  if (mode === "new conversation") {
    await act(async () => (host.querySelector('[aria-label="Back to bots"]') as HTMLButtonElement).click());
    await act(async () => (host.querySelector('.m-home [aria-label="New conversation"]') as HTMLButtonElement).click());
    await act(async () => (host.querySelector('.m-bot-picker button') as HTMLButtonElement).click());
  }
  const respond = vi.fn();
  await act(async () => { for (const handler of mocks.requests) handler({ id: "srq-other", method: "approval", params: { session_id: "other-runtime", request_id: "ap-other", choices: ["once", "deny"], command: "test foreign" }, respond, fail: vi.fn() }); });
  await settle();
  expect(host.querySelector('.m-messages')?.textContent).not.toContain("test foreign");
  expect(host.querySelector('.m-messages')?.textContent).toContain("View requests");
  await act(async () => (Array.from(host.querySelectorAll("button")).find(button => button.textContent?.includes("View requests")) as HTMLButtonElement).click());
  expect(host.querySelector('.m-inbox')?.textContent).toContain("Approval owner · other-runtime");
  expect(host.querySelector('.m-inbox')?.textContent).toContain("test foreign");
  await act(async () => (host.querySelector('.m-inbox button') as HTMLButtonElement).click());
  await settle();
  expect(mocks.request).toHaveBeenCalledWith("session.resume", { profile: "frodo", session_id: "other-stored", source: "mobile", close_on_disconnect: false, omit_messages: true, defer_history: true });
  expect(host.querySelector('.m-messages')?.textContent).toContain("test foreign");
  await act(async () => (Array.from(host.querySelectorAll("button")).find(button => button.textContent === "Allow once") as HTMLButtonElement).click());
  expect(respond).toHaveBeenCalledWith({ choice: "once" });
});

it("keeps notices quiet and reactions behind the message action menu", async () => {
  mocks.getSessionMessages.mockResolvedValue({ messages: [
    { role: 'user', content: 'Message from Gimli (@gimli): details', timestamp: 100 },
    { role: 'user', content: '[IMPORTANT: Background process proc_a completed normally (exit code 0).]', timestamp: 101 },
    { role: 'assistant', content: 'I checked it', timestamp: 102 },
  ] });
  await renderApp(); await settle(); await settle();
  await act(async () => (host.querySelector('.m-pinned-bot') as HTMLButtonElement).click());
  await settle();
  expect(host.querySelector('.m-notice-group > summary')?.textContent).toBe('2 updates');
  expect(host.querySelector('.m-notice-group > summary')?.textContent).not.toContain('proc_a');
  await act(async () => (host.querySelector('.m-notice-group > summary') as HTMLElement).click());
  expect(host.querySelectorAll('.m-notice-group .m-notice')).toHaveLength(2);
  expect(host.querySelector('.m-notice-group')?.textContent).toContain('Background task finished');
  expect(host.querySelector('.m-notice-group')?.textContent).toContain('proc_a');
  expect(host.querySelector('.m-notice-group .m-notice-head svg')).toBeNull();
  const reply = host.querySelector('.m-assistant') as HTMLElement;
  expect(reply.querySelector('.m-reaction')).toBeNull();
  expect(reply.querySelector('.m-bubble .m-message-footer time')).not.toBeNull();
  expect(reply.querySelector('.m-bubble .m-markdown')).not.toBeNull();
  expect(host.querySelector('.m-notice-group .m-bubble')).toBeNull();
  await act(async () => reply.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true })));
  const react = Array.from(host.querySelectorAll('.m-pin-choice')).find(button => button.textContent?.includes('React thumbs up')) as HTMLButtonElement;
  expect(react).not.toBeNull();
  await act(async () => react.click());
  expect(reply.querySelector('.m-reaction')?.textContent).toContain('1');
  await act(async () => (reply.querySelector('.m-reaction') as HTMLButtonElement).click());
  expect(reply.querySelector('.m-reaction')).toBeNull();
});

it("shows pinned bots above one recency list with real message previews", async () => {
  mocks.getProfiles.mockResolvedValueOnce({ profiles: [{ name: "frodo", is_default: true }, { name: "gandalf", is_default: false }, { name: "author", is_default: false }] });
  mocks.getSessionMessages.mockImplementation(async (_id, profile) => ({ messages: profile === "author"
    ? [{ role: "user", content: "work kanban task ta1e7d76a" }, { role: "assistant", content: "## Fixed **the layout** t_a1e7d76a" }]
    : [{ role: "assistant", content: `Earlier from ${profile}` }] }));
  await renderApp(); await settle(); await settle();
  expect(Array.from(host.querySelectorAll(".m-pinned-bot > span:last-of-type")).map(row => row.textContent)).toEqual(["Frodo", "Gandalf"]);
  expect(host.querySelector(".m-bot-row .m-bot-copy small")?.textContent).toBe("Fixed the layout");
  expect(host.querySelector(".m-recent")).toBeNull();
  expect(host.querySelector(".m-destination")).toBeNull();
  expect(host.querySelector(".m-list-header h1")?.className).toBe("sr-only");
  expect(host.querySelector('[aria-label="New conversation"]')).not.toBeNull();
});

it("lists only bots beside the desktop chat", async () => {
  vi.stubGlobal("matchMedia", vi.fn((query: string) => ({ matches: query === "(min-width: 900px)", addEventListener: vi.fn(), removeEventListener: vi.fn() })));
  await renderApp(); await settle(); await settle();
  expect(host.querySelector('.m-desktop-empty')?.textContent).toContain('Choose a bot');
  expect(host.querySelector('.m-list-header .m-profile-button')).toBeNull();
  expect(host.querySelector('.m-sidebar-footer .m-profile-button .m-profile-name')?.textContent).toBe('Jorge');
  expect(host.querySelector('.m-list-header .m-top-actions')?.children).toHaveLength(2);
  expect(host.querySelector('.m-home')?.textContent).not.toContain('Prior chat');
  await act(async () => (host.querySelector('.m-pinned-bot') as HTMLButtonElement).click());
  expect(host.querySelector('.m-header .m-chat-identity')?.textContent).toContain('Frodo');
  expect(host.querySelector('.m-header [aria-label="Back to bots"]')).toBeNull();
  expect(host.querySelector('.m-home')?.getAttribute('aria-hidden')).toBe('false');
  expect((host.querySelector('.m-home') as HTMLElement).hasAttribute('inert')).toBe(false);
  expect(host.querySelector('.m-messages')?.textContent).toContain('Earlier from frodo');
});

it("sends on Enter but keeps Shift+Enter as a newline only on desktop", async () => {
  vi.stubGlobal("matchMedia", vi.fn((query: string) => ({ matches: query === "(min-width: 900px)", addEventListener: vi.fn(), removeEventListener: vi.fn() })));
  await renderApp(); await settle(); await settle();
  await act(async () => (host.querySelector('.m-pinned-bot') as HTMLButtonElement).click());
  const textarea = host.querySelector('.m-composer textarea') as HTMLTextAreaElement;
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(textarea, 'Hello desktop'); textarea.dispatchEvent(new Event('input', { bubbles: true })); });
  const shifted = new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, bubbles: true, cancelable: true });
  await act(async () => textarea.dispatchEvent(shifted));
  expect(shifted.defaultPrevented).toBe(false);
  expect(mocks.request).not.toHaveBeenCalledWith('prompt.submit', expect.anything());
  const enter = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
  await act(async () => textarea.dispatchEvent(enter));
  expect(enter.defaultPrevented).toBe(true);
  expect(mocks.request).toHaveBeenCalledWith('prompt.submit', { session_id: 'runtime', profile: 'frodo', text: 'Hello desktop' });
});

it("leaves Enter as a newline on the phone", async () => {
  await renderApp(); await settle(); await settle();
  await act(async () => (host.querySelector('.m-pinned-bot') as HTMLButtonElement).click());
  const textarea = host.querySelector('.m-composer textarea') as HTMLTextAreaElement;
  const enter = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
  await act(async () => textarea.dispatchEvent(enter));
  expect(enter.defaultPrevented).toBe(false);
  expect(mocks.request).not.toHaveBeenCalledWith('prompt.submit', expect.anything());
  expect(host.querySelector('.m-sidebar-conversations')).toBeNull();
  expect(host.querySelector('.m-home')?.getAttribute('aria-hidden')).toBe('true');
});

it.each(["chat", "board", "board task", "screen"])("swipes back from %s in standalone mode with a following previous screen", async target => {
  vi.stubGlobal("matchMedia", vi.fn((query: string) => ({ matches: query.includes("display-mode: standalone"), addEventListener: vi.fn(), removeEventListener: vi.fn() })));
  if (target === "screen") mocks.getProfiles.mockResolvedValueOnce({ profiles: [{ name: "samwise", is_default: true }] });
  await renderApp(); await settle(); await settle();
  if (target === "chat") await act(async () => (host.querySelector(".m-pinned-bot") as HTMLButtonElement).click());
  else await openDestination(target.startsWith("board") ? "Board" : "Screen");
  if (target === "board task") await act(async () => (Array.from(host.querySelectorAll("button")).find(row => row.textContent === "Open task") as HTMLButtonElement).click());
  await settle();
  const index = window.history.state.idx as number;
  const back = vi.spyOn(window.history, "back");
  const shell = host.querySelector(".m-shell") as HTMLElement;
  Object.defineProperty(shell, "clientWidth", { value: 393 });
  const touch = (type: string, x: number) => {
    const event = new Event(type, { bubbles: true, cancelable: true });
    Object.defineProperty(event, "touches", { value: type === "touchend" ? [] : [{ clientX: x, clientY: 250 }] });
    shell.dispatchEvent(event);
  };
  await act(async () => touch("touchstart", 10));
  expect(host.querySelector(".m-swipe-preview")?.textContent).toContain(target === "board task" ? "Board" : "Frodo");
  await act(async () => touch("touchmove", 190));
  await act(async () => { await vi.waitFor(() => expect((host.querySelector('.m-detail') as HTMLElement).style.transform).toMatch(/translateX\(\d+(?:\.\d+)?px\)/)); });
  const duringGesture = (host.querySelector('.m-detail') as HTMLElement).style.transform;
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 40)); });
  expect((host.querySelector('.m-detail') as HTMLElement).style.transform).toBe(duringGesture);
  await act(async () => { touch("touchend", 190); await vi.waitFor(() => expect(window.location.pathname).toBe(target === "board task" ? "/m/board" : "/m")); });
  expect(back).toHaveBeenCalledTimes(1);
  expect(window.history.state.idx).toBe(index - 1);
  if (target !== "board task") {
    expect((host.querySelector('.m-home') as HTMLElement).style.transform).toBe("");
    expect(host.querySelector('.m-swipe-preview')).toBeNull();
  }
  if (target === "board task") {
    await vi.waitFor(() => {
      expect(host.querySelector('.m-swipe-preview')).toBeNull();
      expect((host.querySelector('.m-detail') as HTMLElement).style.transform).toMatch(/^(none|translateX\(0px\))$/);
      expect(host.querySelector('.m-detail')?.textContent).toContain("Open task");
    });
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 40)); });
    expect((host.querySelector('.m-detail') as HTMLElement).style.transform).toMatch(/^(none|translateX\(0px\))$/);
  }
});

const edgeTouch = (shell: HTMLElement, type: string, x: number) => {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, "touches", { value: type === "touchend" ? [] : [{ clientX: x, clientY: 250 }] });
  shell.dispatchEvent(event);
  return event;
};

it("lets iOS standalone own the edge swipe: one native history step and no app slide", async () => {
  vi.spyOn(navigator, "userAgent", "get").mockReturnValue("Mozilla/5.0 (iPhone; CPU iPhone OS 18_4 like Mac OS X)");
  vi.stubGlobal("matchMedia", vi.fn((query: string) => ({ matches: query.includes("display-mode: standalone"), addEventListener: vi.fn(), removeEventListener: vi.fn() })));
  await renderApp(); await settle();
  await act(async () => (host.querySelector(".m-pinned-bot") as HTMLButtonElement).click());
  await settle();
  const shell = host.querySelector(".m-shell") as HTMLElement;
  Object.defineProperty(shell, "clientWidth", { value: 393 });
  const back = vi.spyOn(window.history, "back");
  window.addEventListener("popstate", event => Object.defineProperty(event, "hasUAVisualTransition", { value: true }), { once: true, capture: true });
  await act(async () => { edgeTouch(shell, "touchstart", 10); expect(edgeTouch(shell, "touchmove", 190).defaultPrevented).toBe(false); edgeTouch(shell, "touchend", 190); });
  expect(host.querySelector(".m-swipe-preview")).toBeNull();
  expect((host.querySelector(".m-detail") as HTMLElement).style.transform).not.toMatch(/translateX\(\d{2,}px\)/);
  expect(window.location.pathname).toContain("/m/chat/");
  await act(async () => { window.history.back(); await new Promise(resolve => setTimeout(resolve, 40)); });
  expect(back).toHaveBeenCalledTimes(1); // The only back call belongs to the simulated OS gesture.
  expect(window.location.pathname).toBe("/m");
  expect(host.querySelectorAll(".m-detail")).toHaveLength(0);
});

it.each([true, false])("skips the app exit only when popstate has a UA visual transition (%s)", async uaTransition => {
  window.addEventListener("popstate", event => Object.defineProperty(event, "hasUAVisualTransition", { value: uaTransition }), { once: true, capture: true });
  await renderApp(); await settle();
  await act(async () => (host.querySelector(".m-pinned-bot") as HTMLButtonElement).click());
  await settle();
  await act(async () => { window.history.back(); await new Promise(resolve => setTimeout(resolve, 30)); });
  expect(window.location.pathname).toBe("/m");
  expect(host.querySelectorAll(".m-detail").length).toBe(uaTransition ? 0 : 1);
});

it("uses an iOS edge touch as the fallback for an unmarked native popstate", async () => {
  vi.spyOn(navigator, "userAgent", "get").mockReturnValue("Mozilla/5.0 (iPhone; CPU iPhone OS 17_6 like Mac OS X)");
  await renderApp(); await settle();
  await act(async () => (host.querySelector(".m-pinned-bot") as HTMLButtonElement).click());
  await settle();
  const shell = host.querySelector(".m-shell") as HTMLElement;
  await act(async () => { edgeTouch(shell, "touchstart", 10); edgeTouch(shell, "touchmove", 190); edgeTouch(shell, "touchend", 190); });
  await act(async () => { window.history.back(); await new Promise(resolve => setTimeout(resolve, 30)); });
  expect(window.location.pathname).toBe("/m");
  expect(host.querySelectorAll(".m-detail")).toHaveLength(0);
});

it("slides a settled board task with the finger and leaves its board panel in view", async () => {
  vi.stubGlobal("matchMedia", vi.fn((query: string) => ({ matches: query.includes("display-mode: standalone"), addEventListener: vi.fn(), removeEventListener: vi.fn() })));
  await renderApp(); await settle();
  await openDestination("Board");
  await act(async () => (Array.from(host.querySelectorAll("button")).find(row => row.textContent === "Open task") as HTMLButtonElement).click());
  await vi.waitFor(() => expect((host.querySelector('.m-detail') as HTMLElement).style.transform).toMatch(/^(none|translateX\(0px\))$/));
  const shell = host.querySelector(".m-shell") as HTMLElement;
  Object.defineProperty(shell, "clientWidth", { value: 393 });
  const touch = (type: string, x: number) => {
    const event = new Event(type, { bubbles: true, cancelable: true });
    Object.defineProperty(event, "touches", { value: type === "touchend" ? [] : [{ clientX: x, clientY: 250 }] });
    shell.dispatchEvent(event);
  };
  await act(async () => touch("touchstart", 10));
  await act(async () => touch("touchmove", 190));
  await act(async () => { await vi.waitFor(() => expect((host.querySelector('.m-detail') as HTMLElement).style.transform).toBe("translateX(180px)")); });
  await act(async () => { touch("touchend", 190); await vi.waitFor(() => expect(window.location.pathname).toBe("/m/board")); });
  expect(host.querySelector('.m-swipe-preview')).toBeNull();
  expect((host.querySelector('.m-detail') as HTMLElement).style.transform).toMatch(/^(none|translateX\(0px\))$/);
  expect(host.querySelector('.m-detail')?.textContent).toContain("Open task");
});

it("returns the board task to its original position after cancelling an early edge swipe", async () => {
  vi.stubGlobal("matchMedia", vi.fn((query: string) => ({ matches: query.includes("display-mode: standalone"), addEventListener: vi.fn(), removeEventListener: vi.fn() })));
  await renderApp(); await settle();
  await openDestination("Board");
  await act(async () => (Array.from(host.querySelectorAll("button")).find(row => row.textContent === "Open task") as HTMLButtonElement).click());
  const shell = host.querySelector(".m-shell") as HTMLElement;
  Object.defineProperty(shell, "clientWidth", { value: 393 });
  const touch = (type: string, x: number) => {
    const event = new Event(type, { bubbles: true, cancelable: true });
    Object.defineProperty(event, "touches", { value: type === "touchend" ? [] : [{ clientX: x, clientY: 250 }] });
    shell.dispatchEvent(event);
  };
  await act(async () => touch("touchstart", 10));
  await act(async () => touch("touchmove", 60));
  await act(async () => touch("touchend", 60));
  await act(async () => {
    await vi.waitFor(() => expect((host.querySelector('.m-detail') as HTMLElement).style.transform).toMatch(/^(none|translateX\(0px\))$/));
  });
  expect(host.querySelector('.m-swipe-preview')).toBeNull();
  expect(window.location.pathname).toBe("/m/board/t-1");
  expect(host.querySelector('.m-detail')?.textContent).toContain("Task t-1");
});

it("shows only data-loading placeholders on the first frame of a stored-chat deep link", async () => {
  window.history.replaceState({}, "", "/m/chat/frodo/stored");
  act(() => root.render(<BrowserRouter><MobileApp /></BrowserRouter>));
  expect(host.querySelector('.m-empty')).toBeNull();
  expect(host.querySelector('.m-messages .m-loading')).not.toBeNull();
  await settle();
});

it("opens a stored conversation from a deep link after reload", async () => {
  window.history.replaceState({}, "", "/m/chat/frodo/stored");
  await renderApp();
  await settle(); await settle();
  expect(host.querySelector('.m-home')?.getAttribute('aria-hidden')).toBe('true');
  expect(host.querySelector('.m-detail')?.textContent).toContain("Earlier");
});

it("hydrates fifty recent messages and prepends older pages without moving the visible row", async () => {
  mocks.getSessionMessages.mockImplementation(async (_id, _profile, page) => {
    const start = page?.offset === 50 ? 0 : 50;
    return { messages: Array.from({ length: 50 }, (_, index) => ({ role: "user", content: `Message ${start + index}` })),
      pagination: { limit: 50, offset: page?.offset ?? 0, order: "latest" as const, returned: 50 } };
  });
  await renderApp(); await settle(); await settle();
  await act(async () => (host.querySelector('.m-pinned-bot') as HTMLButtonElement).click());
  await settle();
  const log = host.querySelector('.m-messages') as HTMLElement;
  expect(log.querySelectorAll('.m-message')).toHaveLength(50);
  expect(log.textContent).not.toContain('Message 0');
  Object.defineProperty(log, 'scrollHeight', { get: () => log.querySelectorAll('.m-message').length * 100 });
  await act(async () => { log.dispatchEvent(new Event("wheel")); log.scrollTop = 40; log.dispatchEvent(new Event('scroll', { bubbles: true })); });
  await settle();
  expect(mocks.getSessionMessages).toHaveBeenCalledWith('stored', 'frodo', { limit: 50, offset: 50, order: 'latest', includeCompacted: true });
  expect(log.querySelectorAll('.m-message')).toHaveLength(100);
  expect(log.querySelector('.m-message')?.textContent).toContain('Message 0');
  expect(log.scrollTop).toBe(5040);
});

it("prefetches both bots, pushes real URLs, and restores cached chat on browser back without resuming again", async () => {
  await renderApp();
  await settle(); await settle();
  expect(mocks.getSessionMessages).toHaveBeenCalledWith('stored', 'frodo', { limit: 50, offset: 0, order: 'latest', includeCompacted: true });
  expect(mocks.getSessionMessages).toHaveBeenCalledWith('gandalf-stored', 'gandalf', { limit: 50, offset: 0, order: 'latest', includeCompacted: true });
  expect(mocks.getAllProfileSessions).toHaveBeenCalled();
  expect(host.textContent).toContain("Gandalf");
  await act(async () => (Array.from(host.querySelectorAll('.m-pinned-bot')).find(row => row.textContent?.includes('Gandalf')) as HTMLButtonElement).click());
  expect(window.location.pathname).toBe('/m/chat/gandalf/gandalf-stored');
  expect(host.querySelector('.m-messages')?.textContent).toContain('Earlier from gandalf');
  await settle();
  const resumes = mocks.request.mock.calls.filter(([method]) => method === 'session.resume').length;
  await act(async () => { window.history.back(); await new Promise(resolve => setTimeout(resolve, 30)); });
  expect(window.location.pathname).toBe('/m');
  await act(async () => { window.history.forward(); await new Promise(resolve => setTimeout(resolve, 30)); });
  expect(window.location.pathname).toBe('/m/chat/gandalf/gandalf-stored');
  expect(host.querySelector('.m-messages')?.textContent).toContain('Earlier from gandalf');
  expect(mocks.request.mock.calls.filter(([method]) => method === 'session.resume')).toHaveLength(resumes);
});

it("resumes a cached bot after its gateway connection was closed", async () => {
  await renderApp(); await settle(); await settle();
  await act(async () => (host.querySelector('[aria-label="Frodo"]') as HTMLButtonElement).click());
  await settle();
  expect(mocks.request.mock.calls.filter(([method, params]) => method === 'session.resume' && params?.profile === 'frodo')).toHaveLength(1);
  await act(async () => (host.querySelector('[aria-label="Gandalf"]') as HTMLButtonElement).click());
  await settle();
  await act(async () => (host.querySelector('[aria-label="Frodo"]') as HTMLButtonElement).click());
  await settle();
  expect(mocks.request.mock.calls.filter(([method, params]) => method === 'session.resume' && params?.profile === 'frodo')).toHaveLength(2);
});

it("restores the bot list scroll after returning through browser history", async () => {
  await renderApp(); await settle(); await settle();
  const list = host.querySelector('.m-bot-list') as HTMLElement;
  await act(async () => { list.scrollTop = 140; list.dispatchEvent(new Event('scroll', { bubbles: true })); });
  await act(async () => (host.querySelector('.m-pinned-bot') as HTMLButtonElement).click());
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 180)); });
  expect(window.location.pathname).toContain('/m/chat/');
  expect(host.querySelector('.m-bot-list')).toBe(list);
  await act(async () => { window.history.back(); await new Promise(resolve => setTimeout(resolve, 180)); });
  expect(host.querySelector('.m-bot-list')).toBe(list);
  expect(list.scrollTop).toBe(140);
});

it("opens the canonical Bot Chat, not a newer side conversation, and previews that same row", async () => {
  mocks.getProfiles.mockResolvedValueOnce({ profiles: [{ name: "frodo", is_default: true }, { name: "author", is_default: false }] });
  mocks.rosterPreview.author = "## Canonical **reply**";
  mocks.getAllProfileSessions.mockResolvedValue({ sessions: [
    { id: "newer-author-side", profile: "author", title: "Research", preview: "Unrelated side conversation", last_active: 999, message_count: 2 },
  ] });
  mocks.getSessionMessages.mockImplementation(async (_id, profile) => ({ messages: [{ role: "assistant", content: profile === "author" ? "Canonical reply" : "Earlier from frodo" }] }));
  await renderApp(); await settle(); await settle();
  expect(host.querySelector('.m-bot-row small')?.textContent).toBe("Canonical reply");
  await act(async () => (host.querySelector('.m-bot-main') as HTMLButtonElement).click());
  expect(window.location.pathname).toBe('/m/chat/author/stored');
  expect(mocks.request).toHaveBeenCalledWith("profiles.list", { include_sessions: true });
  expect(mocks.request).not.toHaveBeenCalledWith("session.most_recent", expect.anything());
  await openConversations();
  expect(host.querySelector('.m-conversation-list')?.textContent).toContain('Research');
  expect(host.querySelector('.m-conversation-list')?.textContent).not.toContain('Bot Chat');
  await act(async () => (host.querySelector('.m-conversation-list button') as HTMLButtonElement).click());
  expect(window.location.pathname).toBe('/m/chat/author/newer-author-side');
});

it("creates the first canonical chat hidden and titled without adopting an unrelated recent session", async () => {
  mocks.rosterAbsent = "author";
  mocks.getProfiles.mockResolvedValueOnce({ profiles: [{ name: "frodo", is_default: true }, { name: "author", is_default: false }] });
  await renderApp(); await settle();
  await act(async () => (host.querySelector('.m-bot-main') as HTMLButtonElement).click());
  expect(mocks.request).toHaveBeenCalledWith("session.list", { profile: "author", title: "Bot Chat", include_hidden: true });
  expect(mocks.request).toHaveBeenCalledWith("session.create", { profile: "author", source: "mobile", title: "Bot Chat", hidden: true, follow_profile_config: true, close_on_disconnect: false });
  expect(mocks.request).toHaveBeenCalledWith("session.title", { session_id: "new-runtime", title: "Bot Chat" });
  expect(window.location.pathname).toBe('/m/chat/author/new-stored');
});

it("adopts an existing titled Bot Chat when the roster has no canonical row yet", async () => {
  mocks.rosterAbsent = "author";
  mocks.existingCanonical = "author";
  mocks.getProfiles.mockResolvedValueOnce({ profiles: [{ name: "frodo", is_default: true }, { name: "author", is_default: false }] });
  await renderApp(); await settle();
  await act(async () => (host.querySelector('.m-bot-main') as HTMLButtonElement).click());
  expect(window.location.pathname).toBe('/m/chat/author/already-current');
  expect(mocks.request).not.toHaveBeenCalledWith("session.create", expect.anything());
});

it("switches stored conversations from the activity sheet without creating another bot chat", async () => {
  await renderApp(); await settle(); await settle();
  await act(async () => (host.querySelector('.m-pinned-bot') as HTMLButtonElement).click());
  await settle();
  const before = mocks.request.mock.calls.filter(([method]) => method === 'session.create').length;
  await openConversations();
  expect(host.querySelector('[role="dialog"]')?.textContent).toContain('Prior chat');
  await act(async () => (host.querySelector('.m-conversation-list button') as HTMLButtonElement).click());
  expect(window.location.pathname).toBe('/m/chat/frodo/side-frodo');
  expect(host.querySelector('.m-detail [aria-label="New conversation"]')).toBeNull();
  expect(host.querySelector('[aria-label="Open right split"]')).not.toBeNull();
  expect(mocks.request.mock.calls.filter(([method]) => method === 'session.create')).toHaveLength(before);
});

it("lists pinned cross-profile side chats first with desktop titles in the switcher and search", async () => {
  mocks.getAllProfileSessions.mockResolvedValue({ sessions: [
    { id: "new-default", profile: "frodo", title: "Recent draft", preview: "first", last_active: 100, message_count: 3 },
    { id: "old-gandalf", profile: "gandalf", title: "Long-lived project", preview: "second", last_active: 1, pinned: true, message_count: 3 },
    { id: "hidden", profile: "gandalf", title: "Bot Chat", preview: "private", last_active: 90, message_count: 3 },
  ] });
  await renderApp(); await settle();
  await act(async () => (host.querySelector('[aria-label="Search"]') as HTMLButtonElement).click());
  const input = host.querySelector('[aria-label="Search bots and conversations"]') as HTMLInputElement;
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'project'); input.dispatchEvent(new Event('input', { bubbles: true })); });
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 350)); });
  expect(input.value).toBe('project');
  expect(host.querySelector('.m-search-results')?.textContent).toContain('Long-lived project');
  expect(host.querySelectorAll('.m-search-result')).toHaveLength(1);
  await act(async () => (host.querySelector('[aria-label="Close search"]') as HTMLButtonElement).click());
  await act(async () => (host.querySelector('.m-pinned-bot') as HTMLButtonElement).click());
  await openConversations();
  expect([...host.querySelectorAll('.m-conversation-list strong')].map(x => x.textContent)).toEqual(['Long-lived project', 'Recent draft']);
  await act(async () => (host.querySelector('.m-conversation-list button') as HTMLButtonElement).click());
  expect(window.location.pathname).toBe('/m/chat/gandalf/old-gandalf');
});

it("shows only the three default pins with Jorge's five real profile names", async () => {
  mocks.getProfiles.mockResolvedValueOnce({ profiles: ["gimli", "samwise", "gandalf", "default", "author"].map(name => ({ name, is_default: name === "default" })) });
  await renderApp(); await settle(); await settle();
  expect(Array.from(host.querySelectorAll(".m-pinned-bot > span:last-of-type")).map(label => label.textContent)).toEqual(["Frodo", "Gandalf", "Samwise"]);
  expect(Array.from(host.querySelectorAll(".m-bot-main .m-bot-heading strong")).map(label => label.textContent)).toEqual(["Author", "Gimli"]);
  expect(host.querySelectorAll(".m-pinned-bot, .m-bot-main")).toHaveLength(5);
  expect(host.querySelector(".m-row-action, .m-pin-action")).toBeNull();
});

it("refreshes the bot preview when the newest message changes", async () => {
  await renderApp(); await settle(); await settle();
  await act(async () => (host.querySelector('.m-pinned-bot') as HTMLButtonElement).dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true })));
  await act(async () => (host.querySelector('.m-pin-choice') as HTMLButtonElement).click());
  const frodo = Array.from(host.querySelectorAll('.m-bot-row')).find(row => row.textContent?.includes('Frodo'))!;
  expect(frodo.querySelector('small')?.textContent).toContain('Earlier from frodo');
  mocks.rosterPreview.frodo = '## Fresh **answer**';
  await act(async () => { for (const handler of mocks.events) handler({ type: 'message.complete', session_id: 'runtime', payload: {} }); });
  await settle();
  expect(frodo.querySelector('small')?.textContent).toBe('Fresh answer');
});

it("board task has a deep-linkable URL and back returns to the board", async () => {
  await renderApp(); await settle();
  await openDestination("Board");
  expect(window.location.pathname).toBe('/m/board');
  await act(async () => (Array.from(host.querySelectorAll('button')).find(button => button.textContent === 'Open task') as HTMLButtonElement).click());
  expect(window.location.pathname).toBe('/m/board/t-1');
  expect(host.textContent).toContain('Task t-1');
  await act(async () => { (host.querySelector('[aria-label="Back to board"]') as HTMLButtonElement).click(); await new Promise(resolve => setTimeout(resolve, 30)); });
  expect(window.location.pathname).toBe('/m/board');
});

it("resolves legacy notification links to the latest stored chat", async () => {
  window.history.replaceState({}, '', '/m?profile=frodo');
  await renderApp(); await settle(); await settle(); await settle();
  expect(window.location.pathname).toBe('/m/chat/frodo/stored');
  expect(host.querySelector('.m-messages')?.textContent).toContain('Earlier');
});

it("defers build reload while a turn is active, then allows it when done", async () => {
  await renderApp(); await settle(); await settle();
  await act(async () => (host.querySelector('.m-pinned-bot') as HTMLButtonElement).click());
  await settle();
  expect(mocks.latestBuildIdle?.()).toBe(true);
  await act(async () => { for (const handler of mocks.events) handler({ type: 'message.start', session_id: 'runtime', payload: {} }); });
  expect(mocks.latestBuildIdle?.()).toBe(false);
  await act(async () => { for (const handler of mocks.events) handler({ type: 'message.complete', session_id: 'runtime', payload: { text: 'Done' } }); });
  expect(mocks.latestBuildIdle?.()).toBe(true);
});

it("timestamps a just-sent message before a reload", async () => {
  await renderApp(); await settle(); await settle();
  await act(async () => (host.querySelector('.m-pinned-bot') as HTMLButtonElement).click());
  await settle();
  const input = host.querySelector('[aria-label="Message"]') as HTMLTextAreaElement;
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(input, 'Fresh send'); input.dispatchEvent(new Event('input', { bubbles: true })); });
  await act(async () => (host.querySelector('.m-send') as HTMLButtonElement).click());
  expect(host.querySelector('.m-message.m-user:last-of-type time')?.getAttribute('datetime')).toBeTruthy();
});

it("shows compaction and a failed turn with an edit-and-retry action instead of spinning", async () => {
  mocks.running = true;
  await renderApp(); await settle(); await settle();
  await act(async () => (host.querySelector('.m-pinned-bot') as HTMLButtonElement).click());
  await settle();
  await act(async () => { for (const handler of mocks.events) handler({ type: 'status.update', session_id: 'runtime', payload: { kind: 'compacting', text: 'Compacting context' } }); });
  expect(host.querySelector('.m-thinking')?.textContent).toContain('Compacting conversation…');
  await act(async () => { for (const handler of mocks.events) handler({ type: 'message.complete', session_id: 'runtime', payload: { status: 'error', error: 'Compression interrupted', text: '' } }); });
  expect(host.querySelector('.m-thinking')).toBeNull();
  expect(host.querySelector('[role="alert"]')?.textContent).toContain('Compression interrupted');
  expect(host.querySelector('[aria-label="Edit and retry message"]')).not.toBeNull();
});

it("marks a saved unanswered turn as interrupted after reconnect and offers edit/retry", async () => {
  window.history.replaceState({}, "", "/m/chat/frodo/stored");
  await renderApp(); await settle(); await settle();
  expect(host.querySelector('.m-thinking')).toBeNull();
  expect(host.querySelector('[role="alert"]')?.textContent).toContain('stopped without a reply');
  expect(host.querySelector('[aria-label="Edit and retry message"]')).not.toBeNull();
});

it("re-checks the server after a silent turn and stops a ghost spinner", async () => {
  await renderApp(); await settle(); await settle();
  await act(async () => (host.querySelector('.m-pinned-bot') as HTMLButtonElement).click());
  await settle();
  vi.useFakeTimers();
  try {
    await act(async () => { for (const handler of mocks.events) handler({ type: 'message.start', session_id: 'runtime', payload: {} }); });
    expect(host.querySelector('.m-typing')).not.toBeNull();
    await act(async () => { await vi.advanceTimersByTimeAsync(20000); });
    await act(async () => { for (const handler of mocks.events) handler({ type: 'session.usage', session_id: 'runtime', payload: { usage: {} } }); });
    await act(async () => { await vi.advanceTimersByTimeAsync(11000); });
    expect(mocks.request).toHaveBeenCalledWith('session.active_list', { profile: 'frodo' });
    expect(mocks.request.mock.calls.filter(call => call[0] === 'session.resume').length).toBe(2);
    expect(host.querySelector('.m-thinking')).toBeNull();
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('stopped without a reply');
  } finally { vi.useRealTimers(); }
});

it("keeps one live status through thinking, tools, streamed writing, and completion", async () => {
  mocks.running = true;
  await renderApp(); await settle(); await settle();
  await act(async () => (host.querySelector('.m-pinned-bot') as HTMLButtonElement).click());
  await settle();
  expect(host.querySelector('.m-typing[aria-label="Bot is typing"]')).not.toBeNull();
  expect(host.querySelector('.m-messages')?.textContent).not.toContain('Thinking…');
  expect(host.querySelector('.m-jump-row')).toBeNull();
  await act(async () => { for (const handler of mocks.events) handler({ type: 'tool.start', session_id: 'runtime', payload: { tool_id: 't1', name: 'terminal' } }); });
  expect(host.querySelector('.m-thinking')?.textContent).toBe('Using terminal');
  await act(async () => { for (const handler of mocks.events) handler({ type: 'tool.complete', session_id: 'runtime', payload: { tool_id: 't1', name: 'terminal' } }); });
  expect(host.querySelector('.m-thinking')?.textContent).toBe('Using terminal');
  await act(async () => { for (const handler of mocks.events) handler({ type: 'message.delta', session_id: 'runtime', payload: { text: 'Here is the result' } }); });
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 470)); });
  expect(host.querySelector('.m-thinking')).toBeNull();
  expect(host.querySelector('.m-streaming .m-bubble')?.textContent).toContain('Here is the result');
  await act(async () => { for (const handler of mocks.events) handler({ type: 'message.complete', session_id: 'runtime', payload: { text: 'Here is the result' } }); });
  expect(host.querySelector('.m-thinking')).toBeNull();
});

it("resumes a profile's stored session, streams its runtime id, stops the turn, and answers a pending approval", async () => {
  await renderApp();
  await settle(); await settle();
  expect(host.querySelector('.m-bot-list')).not.toBeNull();
  expect(mocks.request).not.toHaveBeenCalledWith("session.resume", expect.anything());
  await act(async () => (host.querySelector('.m-pinned-bot') as HTMLButtonElement).click());
  await settle();
  expect(mocks.request).toHaveBeenCalledWith("session.resume", { profile: "frodo", session_id: "stored", source: "mobile", close_on_disconnect: false, omit_messages: true, defer_history: true });
  expect(host.querySelector('.m-nav')).toBeNull();
  expect(host.textContent).toContain("Earlier");
  await act(async () => { for (const handler of mocks.events) handler({ type: "message.delta", session_id: "runtime", payload: { text: "Streaming" } }); });
  expect(host.textContent).toContain("Streaming");
  await act(async () => (host.querySelector('.m-chat-identity') as HTMLButtonElement).click());
  expect(host.querySelector('[role="dialog"]')?.textContent).toContain("Frodo activity");
  await act(async () => (host.querySelector('[aria-label="Close activity"]') as HTMLButtonElement).click());
  const respond = vi.fn();
  await act(async () => { for (const handler of mocks.requests) handler({ id: "srq-1", method: "approval", params: { session_id: "runtime", request_id: "ap-1", choices: ["once", "deny"], command: "ls" }, respond, fail: vi.fn() }); });
  expect(host.textContent).toContain("Approve command?");
  expect(host.querySelector('.m-inline-request')).not.toBeNull();
  expect(host.querySelector('.m-prompt-overlay')).toBeNull();
  await act(async () => (Array.from(host.querySelectorAll("button")).find(button => button.textContent === "Allow once") as HTMLButtonElement).click());
  expect(respond).toHaveBeenCalledWith({ choice: "once" });
  await act(async () => (host.querySelector('button[aria-label="Stop"]') as HTMLButtonElement).click());
  expect(mocks.request).toHaveBeenCalledWith("session.interrupt", { profile: "frodo", session_id: "runtime" });
});

it("uploads a selected photo to the bot profile, attaches it before submitting, and renders a photo chip", async () => {
  Object.defineProperty(URL, "createObjectURL", { configurable: true, value: vi.fn(() => "blob:mobile-photo") });
  Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() });
  await renderApp(); await settle(); await settle();
  await act(async () => (host.querySelector('.m-pinned-bot') as HTMLButtonElement).click());
  await settle();
  const input = host.querySelector('.m-composer input[type="file"]') as HTMLInputElement;
  const photo = new File(["png"], "test.png", { type: "image/png" });
  Object.defineProperty(input, "files", { configurable: true, value: [photo] });
  await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })));
  expect(host.querySelector('.m-photo-preview img')?.getAttribute('alt')).toBe('test.png');
  await act(async () => (host.querySelector('.m-send') as HTMLButtonElement).click());
  expect(mocks.uploadChatImage).toHaveBeenCalledWith(photo, 'frodo');
  expect(mocks.request).toHaveBeenCalledWith('image.attach', { session_id: 'runtime', profile: 'frodo', path: '/sample/image.png' });
  expect(mocks.request).toHaveBeenCalledWith('prompt.submit', { session_id: 'runtime', profile: 'frodo', text: 'What do you see in this photo?' });
  expect(host.querySelector('.m-message.m-user:last-of-type')?.textContent).toContain('Photo');
  expect(host.querySelector('.m-messages')?.textContent).not.toContain('/sample/image.png');
  expect(host.querySelector('.m-photo-preview')).toBeNull();
});

it("stages pasted photos and dropped files in the same composer", async () => {
  Object.defineProperty(URL, "createObjectURL", { configurable: true, value: vi.fn(() => "blob:pasted-photo") });
  Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() });
  await renderApp(); await settle(); await settle();
  await act(async () => (host.querySelector('.m-pinned-bot') as HTMLButtonElement).click()); await settle();
  const photo = new File(["png"], "pasted.png", { type: "image/png" });
  const paste = new Event('paste', { bubbles: true, cancelable: true });
  Object.defineProperty(paste, 'clipboardData', { value: { files: [photo] } });
  await act(async () => (host.querySelector('.m-composer textarea') as HTMLTextAreaElement).dispatchEvent(paste));
  expect(paste.defaultPrevented).toBe(true);
  expect(host.querySelector('.m-photo-preview img')?.getAttribute('alt')).toBe('pasted.png');
  const dropped = new Event('drop', { bubbles: true, cancelable: true });
  Object.defineProperty(dropped, 'dataTransfer', { value: { files: [new File(["PDF"], "dropped.pdf", { type: "application/pdf" })] } });
  await act(async () => (host.querySelector('.m-main') as HTMLElement).dispatchEvent(dropped));
  expect(dropped.defaultPrevented).toBe(true);
  expect(host.querySelector('.m-file-previews')?.textContent).toContain('dropped.pdf');
});

it("keeps the selected photo and text when its upload fails without sending a ghost message", async () => {
  Object.defineProperty(URL, "createObjectURL", { configurable: true, value: vi.fn(() => "blob:failed-photo") });
  Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() });
  await renderApp(); await settle(); await settle();
  await act(async () => (host.querySelector('.m-pinned-bot') as HTMLButtonElement).click());
  await settle();
  const input = host.querySelector('.m-composer input[type="file"]') as HTMLInputElement;
  Object.defineProperty(input, "files", { configurable: true, value: [new File(["png"], "test.png", { type: "image/png" })] });
  await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })));
  mocks.uploadChatImage.mockRejectedValueOnce(new Error('Upload unavailable'));
  await act(async () => (host.querySelector('.m-send') as HTMLButtonElement).click());
  expect(host.querySelector('.m-photo-preview')).not.toBeNull();
  expect(host.querySelector('.m-messages')?.textContent).not.toContain('What do you see in this photo?');
  expect(mocks.request).not.toHaveBeenCalledWith('prompt.submit', expect.anything());
});

it("renames and archives a foreign bot conversation and restores it from the archived tab", async () => {
  let title = "Found chat";
  let archived = false;
  mocks.getAllProfileSessions.mockImplementation(async (_limit, mode) => ({ sessions: (mode === "only") === archived ? [
    { id: "gandalf-found", profile: "gandalf", title, preview: "Match in message", last_active: 10, message_count: 2 },
  ] : [] }));
  mocks.renameSession.mockImplementation(async (_id, next) => { title = next; return { ok: true, title }; });
  mocks.setSessionArchived.mockImplementation(async (_id, next) => { archived = next; return { ok: true, archived }; });
  await renderApp(); await settle(); await settle();
  await act(async () => (host.querySelector('.m-pinned-bot') as HTMLButtonElement).click());
  await settle();
  await openConversations();
  await act(async () => (host.querySelector('[aria-label="Options for Found chat"]') as HTMLButtonElement).click());
  await act(async () => { const input = host.querySelector('#m-conversation-title') as HTMLInputElement; Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, "Renamed Gandalf chat"); input.dispatchEvent(new Event('input', { bubbles: true })); });
  await act(async () => (Array.from(host.querySelectorAll('button')).find(button => button.textContent === 'Save name') as HTMLButtonElement).click());
  expect(mocks.renameSession).toHaveBeenCalledWith('gandalf-found', 'Renamed Gandalf chat', 'gandalf');
  expect(host.querySelector('.m-conversation-list')?.textContent).toContain('Renamed Gandalf chat');
  await act(async () => (host.querySelector('[aria-label="Options for Renamed Gandalf chat"]') as HTMLButtonElement).click());
  await act(async () => (Array.from(host.querySelectorAll('button')).find(button => button.textContent === 'Archive conversation') as HTMLButtonElement).click());
  expect(mocks.setSessionArchived).toHaveBeenCalledWith('gandalf-found', true, 'gandalf');
  expect(host.querySelector('.m-conversation-list')?.textContent).not.toContain('Renamed Gandalf chat');
  await act(async () => (Array.from(host.querySelectorAll('.m-conversation-tabs button')).find(button => button.textContent === 'Archived') as HTMLButtonElement).click());
  await settle();
  expect(host.querySelector('.m-conversation-list')?.textContent).toContain('Renamed Gandalf chat');
  await act(async () => (host.querySelector('[aria-label="Options for Renamed Gandalf chat"]') as HTMLButtonElement).click());
  await act(async () => (Array.from(host.querySelectorAll('button')).find(button => button.textContent === 'Restore conversation') as HTMLButtonElement).click());
  expect(mocks.setSessionArchived).toHaveBeenCalledWith('gandalf-found', false, 'gandalf');
  expect(host.querySelector('.m-conversation-list')?.textContent).not.toContain('Renamed Gandalf chat');
});

it("pins and unpins a side conversation for its owning profile", async () => {
  let pinned = false;
  mocks.getAllProfileSessions.mockImplementation(async (_limit, archived) => ({ sessions: archived === "only" ? [] : [
    { id: "gandalf-found", profile: "gandalf", title: "Found chat", preview: "Match in message", last_active: 10, message_count: 2, pinned },
  ] }));
  mocks.setSessionPinned.mockImplementation(async (_id, next) => { pinned = next; return { ok: true, pinned }; });
  await renderApp(); await settle(); await settle();
  await act(async () => (host.querySelector('.m-pinned-bot') as HTMLButtonElement).click());
  await settle();
  await openConversations();
  await act(async () => (host.querySelector('[aria-label="Options for Found chat"]') as HTMLButtonElement).click());
  await act(async () => (Array.from(host.querySelectorAll('button')).find(button => button.textContent === 'Pin conversation') as HTMLButtonElement).click());
  expect(mocks.setSessionPinned).toHaveBeenCalledWith('gandalf-found', true, 'gandalf');
  expect(host.querySelector('.m-conversation-row .lucide-pin')).not.toBeNull();
  await act(async () => (host.querySelector('[aria-label="Options for Found chat"]') as HTMLButtonElement).click());
  await act(async () => (Array.from(host.querySelectorAll('button')).find(button => button.textContent === 'Unpin conversation') as HTMLButtonElement).click());
  expect(mocks.setSessionPinned).toHaveBeenCalledWith('gandalf-found', false, 'gandalf');
  expect(host.querySelector('.m-conversation-row .lucide-pin')).toBeNull();
});

it("dictates into the draft without submitting the bot turn", async () => {
  const stopTrack = vi.fn();
  Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia: vi.fn(async () => ({ getTracks: () => [{ stop: stopTrack }] })) } });
  class FakeMediaRecorder {
    state = "inactive";
    mimeType = "audio/webm";
    ondataavailable?: (event: { data: Blob }) => void;
    onstop?: () => void;
    static isTypeSupported() { return true; }
    start() { this.state = "recording"; }
    stop() { this.state = "inactive"; this.ondataavailable?.({ data: new Blob(["sample"], { type: this.mimeType }) }); this.onstop?.(); }
  }
  vi.stubGlobal("MediaRecorder", FakeMediaRecorder);
  await renderApp(); await settle(); await settle();
  await act(async () => (host.querySelector('.m-pinned-bot') as HTMLButtonElement).click());
  await settle();
  await act(async () => (host.querySelector('[aria-label="Dictate message"]') as HTMLButtonElement).click());
  expect(host.querySelector('[aria-label="Stop recording"]')).not.toBeNull();
  await act(async () => (host.querySelector('[aria-label="Stop recording"]') as HTMLButtonElement).click());
  await vi.waitFor(() => expect((host.querySelector('.m-composer textarea') as HTMLTextAreaElement).value).toBe('Dictated words'));
  expect(mocks.transcribeAudio).toHaveBeenCalledWith(expect.stringMatching(/^data:audio\/webm;base64,/), 'audio/webm', 'frodo');
  expect(stopTrack).toHaveBeenCalled();
  expect(mocks.request).not.toHaveBeenCalledWith('prompt.submit', expect.anything());
});

it("copies the exact message from its long-press action without changing the conversation", async () => {
  vi.stubGlobal("isSecureContext", true);
  const writeText = vi.fn(async () => {});
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
  await renderApp(); await settle(); await settle();
  await act(async () => (host.querySelector('.m-pinned-bot') as HTMLButtonElement).click());
  await settle();
  const message = host.querySelector('.m-message') as HTMLElement;
  await act(async () => message.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true })));
  expect(host.textContent).toContain('Copy text');
  await act(async () => (Array.from(host.querySelectorAll('button')).find(button => button.textContent === 'Copy text') as HTMLButtonElement).click());
  expect(writeText).toHaveBeenCalledWith('Earlier from frodo');
  await vi.waitFor(() => expect(host.textContent).not.toContain('Copy text'));
});

it("falls back to selection copy when clipboard permission is denied", async () => {
  vi.stubGlobal("isSecureContext", true);
  const writeText = vi.fn().mockRejectedValue(new Error('NotAllowedError'));
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
  const fallback = vi.fn(() => true);
  Object.defineProperty(document, "execCommand", { configurable: true, value: fallback });
  try {
    await renderApp(); await settle(); await settle();
    await act(async () => (host.querySelector('.m-pinned-bot') as HTMLButtonElement).click());
    await settle();
    await act(async () => (host.querySelector('.m-message') as HTMLElement).dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true })));
    await act(async () => (Array.from(host.querySelectorAll('button')).find(button => button.textContent === 'Copy text') as HTMLButtonElement).click());
    await vi.waitFor(() => expect(writeText).toHaveBeenCalledWith('Earlier from frodo'));
    await vi.waitFor(() => expect(fallback).toHaveBeenCalledWith('copy'));
    await vi.waitFor(() => expect(host.textContent).not.toContain('Copy text'));
  } finally { Reflect.deleteProperty(document, "execCommand"); }
});

it("sends Continue to Samwise's selected chat after a screen hand-back", async () => {
  mocks.getProfiles.mockResolvedValueOnce({ profiles: [{ name: "samwise", is_default: true }] });
  await renderApp();
  await settle(); await settle();
  await openDestination("Screen");
  await act(async () => (Array.from(host.querySelectorAll("button")).find(button => button.textContent === "Continue after hand back") as HTMLButtonElement).click());
  expect(mocks.request).toHaveBeenCalledWith("prompt.submit", {
    profile: "samwise", session_id: "runtime", text: "I handed back the screen; continue from the current state.",
  });
  expect(host.textContent).toContain("Earlier");
  await vi.waitFor(() => expect(host.querySelectorAll('.m-detail .m-messages')).toHaveLength(1));
  await vi.waitFor(() => expect((host.querySelector('.m-detail:has(.m-messages)') as HTMLElement).style.transform).toMatch(/^(none|translateX\(0px\))$/));
  expect(host.querySelector('.m-detail .m-messages')?.textContent).toContain("Earlier");
});

it("steers the running Samwise turn instead of starting a second one", async () => {
  mocks.running = true;
  mocks.getProfiles.mockResolvedValueOnce({ profiles: [{ name: "samwise", is_default: true }] });
  await renderApp();
  await settle(); await settle();
  await openDestination("Screen");
  await act(async () => (Array.from(host.querySelectorAll("button")).find(button => button.textContent === "Continue after hand back") as HTMLButtonElement).click());
  expect(mocks.request).toHaveBeenCalledWith("session.steer", {
    profile: "samwise", session_id: "runtime", text: "I handed back the screen; continue from the current state.",
  });
  expect(mocks.request).not.toHaveBeenCalledWith("prompt.submit", expect.anything());
});

it("routes Board and Settings from the profile menu, and offers Screen only with Samwise", async () => {
  await renderApp(); await settle();
  await act(async () => (host.querySelector('[aria-label="Profile menu"]') as HTMLButtonElement).dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 })));
  expect(Array.from(host.querySelectorAll('.m-dropdown a')).map(a => [a.textContent, a.getAttribute('href')])).toEqual([["Board", "/m/board"], ["Subscriptions", "/m/subscriptions"], ["Settings", "/m/settings"]]);
  await act(async () => (host.querySelector('.m-dropdown a[href="/m/settings"]') as HTMLAnchorElement).click());
  expect(window.location.pathname).toBe('/m/settings');
  await act(async () => (host.querySelector('[aria-label="Back to bots"]') as HTMLButtonElement).click());
  await openDestination("Board");
  expect(window.location.pathname).toBe('/m/board');
});

it("shows the Screen destination only when Samwise is installed", async () => {
  mocks.getProfiles.mockResolvedValueOnce({ profiles: [{ name: "samwise", is_default: true }] });
  await renderApp(); await settle();
  await act(async () => (host.querySelector('[aria-label="Profile menu"]') as HTMLButtonElement).dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 })));
  expect(host.querySelector('.m-dropdown a[href="/m/screen/samwise"]')).not.toBeNull();
  await act(async () => (host.querySelector('.m-dropdown a[href="/m/screen/samwise"]') as HTMLAnchorElement).click());
  expect(window.location.pathname).toBe('/m/screen/samwise');
});

it("filters bots and searches stored conversation messages across profiles", async () => {
  await renderApp(); await settle();
  await act(async () => (host.querySelector('[aria-label="Search"]') as HTMLButtonElement).click());
  const input = host.querySelector('[aria-label="Search bots and conversations"]') as HTMLInputElement;
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'Gandalf'); input.dispatchEvent(new Event('input', { bubbles: true })); });
  expect(host.querySelectorAll('.m-pinned-bot')).toHaveLength(1);
  await vi.waitFor(() => expect(mocks.searchSessions).toHaveBeenCalledWith('Gandalf', 'gandalf'));
  await act(async () => { await vi.waitFor(() => expect(host.querySelector('.m-search-result')?.textContent).toContain('Found chat')); });
  await act(async () => (host.querySelector('.m-search-result') as HTMLButtonElement).click());
  expect(window.location.pathname).toBe('/m/chat/gandalf/gandalf-found');
});

it("persists a pin action and moves a bot out of the unpinned list", async () => {
  const values = new Map<string, string>();
  vi.stubGlobal('localStorage', { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } });
  mocks.getProfiles.mockResolvedValueOnce({ profiles: [{ name: 'frodo', is_default: true }, { name: 'gandalf', is_default: false }, { name: 'author', is_default: false }] });
  await renderApp(); await settle();
  expect(host.querySelector('.m-bot-row')?.textContent).toContain('Author');
  await act(async () => (host.querySelector('.m-bot-main') as HTMLButtonElement).dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true })));
  await act(async () => (host.querySelector('.m-pin-choice') as HTMLButtonElement).click());
  expect(host.querySelector('.m-bot-row')).toBeNull();
  expect(values.get(PIN_STORAGE_KEY)).toContain('author');
});

it("long-presses an unpinned bot to pin it without opening its chat", async () => {
  mocks.getProfiles.mockResolvedValueOnce({ profiles: [{ name: 'frodo', is_default: true }, { name: 'author', is_default: false }] });
  await renderApp(); await settle();
  const author = host.querySelector('.m-bot-main') as HTMLButtonElement;
  await act(async () => {
    const touch = new Event('touchstart', { bubbles: true });
    Object.defineProperty(touch, 'touches', { value: [{ clientX: 100, clientY: 250 }] });
    author.dispatchEvent(touch);
    await new Promise(resolve => setTimeout(resolve, 570));
  });
  await act(async () => {
    const touch = new Event('touchend', { bubbles: true });
    Object.defineProperty(touch, 'touches', { value: [] });
    author.dispatchEvent(touch); author.click();
  });
  expect(window.location.pathname).toBe('/m');
  expect(host.querySelector('.m-pin-choice')?.textContent).toBe('Pin bot');
  await act(async () => (host.querySelector('.m-pin-choice') as HTMLButtonElement).click());
  expect(host.querySelectorAll('.m-pinned-bot')).toHaveLength(2);
  expect(host.querySelector('.m-bot-row')).toBeNull();
  expect(storage.get(PIN_STORAGE_KEY)).toContain('author');
});

it("opens the phone's full-screen split from the chat header with a Screen tab", async () => {
  await renderApp(); await settle(); await settle();
  await act(async () => (host.querySelector('.m-pinned-bot') as HTMLButtonElement).click());
  await settle();
  await act(async () => (host.querySelector('[aria-label="Open right split"]') as HTMLButtonElement).click());
  expect(window.location.pathname).toContain('/m/chat/');
  expect(host.querySelector('.m-right-split')).not.toBeNull();
  expect(host.querySelector('.m-split-browser-empty')?.textContent).toContain('Enter an address');
  const address = host.querySelector('[aria-label="Browser address"]') as HTMLInputElement;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(address, 'localhost:9119');
    address.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await act(async () => (address.closest('form') as HTMLFormElement).dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  expect(host.querySelector('iframe[title="Browser preview"]')?.getAttribute('src')).toBe('http://localhost:9119/');
  expect(host.querySelector('.m-split-framing')?.textContent).toContain('refuse');
  await act(async () => (host.querySelector('[role="tab"]:last-child') as HTMLButtonElement).click());
  expect(host.querySelector('[role="tabpanel"]')?.getAttribute('aria-label')).toBe('screen');
  expect(host.querySelector('[aria-label="Close right split"]')).not.toBeNull();
});

it.each([{ modifier: 'ctrlKey', label: 'Ctrl' }, { modifier: 'metaKey', label: 'Cmd' }] as const)("switches bots with $label+number in desktop sidebar order", async ({ modifier }) => {
  vi.stubGlobal("matchMedia", vi.fn((query: string) => ({ matches: query === "(min-width: 900px)", addEventListener: vi.fn(), removeEventListener: vi.fn() })));
  await renderApp(); await settle(); await settle();
  const key = new KeyboardEvent('keydown', { key: '2', [modifier]: true, bubbles: true, cancelable: true });
  await act(async () => window.dispatchEvent(key));
  expect(key.defaultPrevented).toBe(true);
  expect(window.location.pathname).toBe('/m/chat/gandalf/gandalf-stored');
});

it("offers slash catalog and bot mentions with keyboard selection", async () => {
  await renderApp(); await settle(); await settle();
  await act(async () => (host.querySelector('.m-pinned-bot') as HTMLButtonElement).click());
  const input = host.querySelector('.m-composer textarea') as HTMLTextAreaElement;
  const type = async (value: string) => act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(input, value);
    input.setSelectionRange(value.length, value.length);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('select', { bubbles: true }));
  });
  await type('/');
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 30)); });
  expect(input.value).toBe('/');
  expect(host.querySelector('.m-suggestions')?.textContent).toContain('/my-skill');
  expect(mocks.request).toHaveBeenCalledWith('commands.catalog', { session_id: 'runtime' });
  await act(async () => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true })));
  await act(async () => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })));
  expect(input.value).toBe('/my-skill ');
  await type('Hello @gan');
  expect(host.querySelector('.m-suggestions')?.textContent).toContain('gandalf');
  await act(async () => (host.querySelector('.m-suggestions button') as HTMLButtonElement).click());
  expect(input.value).toBe('Hello @gandalf ');
});

it("uses complete.slash for typed commands, Tab selects and Escape dismisses", async () => {
  await renderApp(); await settle(); await settle();
  await act(async () => (host.querySelector('.m-pinned-bot') as HTMLButtonElement).click());
  const input = host.querySelector('.m-composer textarea') as HTMLTextAreaElement;
  const type = async (value: string) => act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(input, value);
    input.setSelectionRange(value.length, value.length);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('select', { bubbles: true }));
  });
  await type('/he');
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 140)); });
  expect(mocks.request).toHaveBeenCalledWith('complete.slash', { text: '/he', session_id: 'runtime' });
  await act(async () => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })));
  expect(input.value).toBe('/help ');
  await type('/');
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 30)); });
  expect(host.querySelector('.m-suggestions')).not.toBeNull();
  await act(async () => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })));
  expect(host.querySelector('.m-suggestions')).toBeNull();
});

it("opens the composer menu with separate Photo and File actions", async () => {
  await renderApp(); await settle(); await settle();
  await act(async () => (host.querySelector('.m-pinned-bot') as HTMLButtonElement).click());
  await act(async () => (host.querySelector('[aria-label="Attach photo or file"]') as HTMLButtonElement).dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 })));
  expect(host.querySelector('.m-attach-menu')?.textContent).toContain('Photo');
  expect(host.querySelector('.m-attach-menu')?.textContent).toContain('File');
});

it("focuses the desktop composer on bot switch and grows and shrinks with text", async () => {
  vi.stubGlobal('matchMedia', vi.fn((query: string) => ({ matches: query === '(min-width: 900px)', addEventListener: vi.fn(), removeEventListener: vi.fn() })));
  await renderApp(); await settle(); await settle();
  await act(async () => (host.querySelector('[aria-label="Frodo"]') as HTMLButtonElement).click()); await settle();
  const input = host.querySelector('.m-composer textarea') as HTMLTextAreaElement;
  expect(document.activeElement).toBe(input);
  Object.defineProperty(input, 'scrollHeight', { configurable: true, get: () => input.value.length > 10 ? 500 : 46 });
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(input, 'Long message that should grow'); input.dispatchEvent(new Event('input', { bubbles: true })); });
  expect(parseInt(input.style.height)).toBeGreaterThan(46);
  expect(input.style.overflowY).toBe('auto');
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(input, 'short'); input.dispatchEvent(new Event('input', { bubbles: true })); });
  expect(input.style.height).toBe('46px');
  await act(async () => (host.querySelector('[aria-label="Gandalf"]') as HTMLButtonElement).click()); await settle();
  expect(document.activeElement).toBe(host.querySelector('.m-composer textarea'));
});

it("does not focus the composer when opening a bot at phone width", async () => {
  await renderApp(); await settle(); await settle();
  await act(async () => (host.querySelector('[aria-label="Frodo"]') as HTMLButtonElement).click()); await settle();
  expect(document.activeElement).not.toBe(host.querySelector('.m-composer textarea'));
});

it("keeps drafts and attachments scoped to each bot and restores on switch", async () => {
  vi.stubGlobal('matchMedia', vi.fn((query: string) => ({ matches: query === '(min-width: 900px)', addEventListener: vi.fn(), removeEventListener: vi.fn() })));
  vi.stubGlobal('URL', { ...URL, createObjectURL: vi.fn(() => 'blob:fixture'), revokeObjectURL: vi.fn() });
  await renderApp(); await settle(); await settle();
  await act(async () => (host.querySelector('[aria-label="Frodo"]') as HTMLButtonElement).click());
  const type = async (value: string) => {
    const input = host.querySelector('.m-composer textarea') as HTMLTextAreaElement;
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true })); });
  };
  await type('Frodo draft');
  const photo = host.querySelector('.m-composer input[type="file"]') as HTMLInputElement;
  Object.defineProperty(photo, 'files', { configurable: true, value: [new File(['photo'], 'frodo.png', { type: 'image/png' })] });
  await act(async () => photo.dispatchEvent(new Event('change', { bubbles: true })));
  await act(async () => (host.querySelector('[aria-label="Gandalf"]') as HTMLButtonElement).click()); await settle();
  expect((host.querySelector('.m-composer textarea') as HTMLTextAreaElement).value).toBe('');
  expect(host.querySelector('.m-photo-previews')).toBeNull();
  await type('Gandalf only');
  await act(async () => (host.querySelector('[aria-label="Frodo"]') as HTMLButtonElement).click()); await settle();
  expect((host.querySelector('.m-composer textarea') as HTMLTextAreaElement).value).toBe('Frodo draft');
  expect(host.querySelector('.m-photo-previews')?.textContent).toContain('frodo.png');
  expect((host.querySelector('.m-photo-preview img') as HTMLImageElement).alt).toBe('frodo.png');
  await act(async () => (host.querySelector('[aria-label="Gandalf"]') as HTMLButtonElement).click()); await settle();
  await act(async () => (host.querySelector('.m-send') as HTMLButtonElement).click());
  expect(mocks.request).toHaveBeenCalledWith('prompt.submit', { session_id: 'runtime', profile: 'gandalf', text: 'Gandalf only' });
  expect(mocks.uploadChatImage).not.toHaveBeenCalled();
  await act(async () => (host.querySelector('[aria-label="Frodo"]') as HTMLButtonElement).click()); await settle();
  expect((host.querySelector('.m-composer textarea') as HTMLTextAreaElement).value).toBe('Frodo draft');
  expect((host.querySelector('.m-photo-preview img') as HTMLImageElement).alt).toBe('frodo.png');
});

it("keeps a pending photo upload in its original chat after switching bots", async () => {
  vi.stubGlobal('matchMedia', vi.fn((query: string) => ({ matches: query === '(min-width: 900px)', addEventListener: vi.fn(), removeEventListener: vi.fn() })));
  vi.stubGlobal('URL', { ...URL, createObjectURL: vi.fn(() => 'blob:pending'), revokeObjectURL: vi.fn() });
  let finishUpload!: (result: { path: string; name: string; bytes: number; mime_type: string }) => void;
  mocks.uploadChatImage.mockImplementationOnce(() => new Promise(resolve => { finishUpload = resolve; }));
  await renderApp(); await settle(); await settle();
  await act(async () => (host.querySelector('[aria-label="Frodo"]') as HTMLButtonElement).click());
  const image = host.querySelector('.m-composer input[type="file"]') as HTMLInputElement;
  Object.defineProperty(image, 'files', { configurable: true, value: [new File(['photo'], 'frodo.png', { type: 'image/png' })] });
  await act(async () => image.dispatchEvent(new Event('change', { bubbles: true })));
  await act(async () => (host.querySelector('.m-send') as HTMLButtonElement).click());
  expect(host.querySelector('.m-photo-label')?.textContent).toContain('Uploading 1 of 1');
  await act(async () => (host.querySelector('[aria-label="Gandalf"]') as HTMLButtonElement).click()); await settle();
  expect(host.querySelector('.m-photo-previews')).toBeNull();
  const input = host.querySelector('.m-composer textarea') as HTMLTextAreaElement;
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(input, 'Gandalf only'); input.dispatchEvent(new Event('input', { bubbles: true })); });
  await act(async () => (host.querySelector('.m-send') as HTMLButtonElement).click());
  expect(mocks.request).toHaveBeenCalledWith('prompt.submit', { session_id: 'runtime', profile: 'gandalf', text: 'Gandalf only' });
  await act(async () => { finishUpload({ path: '/frodo/image.png', name: 'image.png', bytes: 5, mime_type: 'image/png' }); });
  await settle();
  expect(mocks.request).toHaveBeenCalledWith('prompt.submit', { session_id: 'runtime', profile: 'frodo', text: 'What do you see in this photo?' });
  expect(host.querySelector('.m-messages')?.textContent).not.toContain('What do you see in this photo?');
});

it("attaches a file using the existing gateway RPC before sending", async () => {
  await renderApp(); await settle(); await settle();
  await act(async () => (host.querySelector('.m-pinned-bot') as HTMLButtonElement).click());
  const input = host.querySelectorAll('.m-composer input[type="file"]')[1] as HTMLInputElement;
  Object.defineProperty(input, 'files', { configurable: true, value: [new File(['hello'], 'test.txt', { type: 'text/plain' })] });
  await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })));
  expect(host.querySelector('.m-file-previews')?.textContent).toContain('test.txt');
  await act(async () => (host.querySelector('.m-send') as HTMLButtonElement).click());
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 30)); });
  expect(mocks.request).toHaveBeenCalledWith('file.attach', expect.objectContaining({ session_id: 'runtime', profile: 'frodo', name: 'test.txt', data_url: expect.stringMatching(/^data:text\/plain;base64,/) }));
  expect(mocks.request).toHaveBeenCalledWith('prompt.submit', { session_id: 'runtime', profile: 'frodo', text: 'Please read the attached file.\n@file:attachments/test.txt' });
  const sent = host.querySelector('.m-message.m-user:last-of-type') as HTMLElement;
  expect(sent.textContent).toContain('test.txt');
  expect(sent.textContent).not.toContain('@file:attachments');
});

it("shows stored attachment chips without exposing injected context or filesystem paths", async () => {
  mocks.getSessionMessages.mockResolvedValue({ messages: [{ role: 'user', content: 'Please read these.\n@file:.hermes/profiles/gimli/attachments/fixture.txt\n\n--- Attached Context ---\n\n📄 @file:.hermes/profiles/gimli/attachments/fixture.txt (26 tokens)\n```\nPrivate content\n```\n@image:/private/images/photo.png\n[screenshot]', timestamp: 100 }] });
  await renderApp(); await settle(); await settle();
  await act(async () => (host.querySelector('.m-pinned-bot') as HTMLButtonElement).click());
  await settle();
  const row = host.querySelector('.m-message.m-user') as HTMLElement;
  expect(row.textContent).toContain('Please read these.');
  expect(row.textContent).toContain('fixture.txt');
  expect(row.textContent).toContain('Photo');
  expect(row.textContent).not.toContain('@file:');
  expect(row.textContent).not.toContain('Private content');
  expect(row.textContent).not.toContain('[screenshot]');
  expect(row.querySelector<HTMLAnchorElement>('.m-image-attachment')?.href).toContain('/api/chat/attachment/frodo/image/photo.png');
  expect(row.querySelector<HTMLAnchorElement>('a[download="fixture.txt"]')?.href).toContain('/api/chat/attachment/frodo/file/fixture.txt');
});

it("hides generated context warnings while retaining photo and file chips", async () => {
  mocks.getSessionMessages.mockResolvedValue({ messages: [{ role: 'user', content: 'QA attachment check\n@file:/Users/qa/attachments/qa-riverstone.pdf\n\n--- Context Warnings ---\n- @file:/Users/qa/attachments/qa-riverstone.pdf: path is outside the allowed workspace\n@image:/Users/qa/images/qa-lantern.png', timestamp: 100 }] });
  await renderApp(); await settle(); await settle();
  await act(async () => (host.querySelector('.m-pinned-bot') as HTMLButtonElement).click()); await settle();
  const row = host.querySelector('.m-message.m-user') as HTMLElement;
  expect(row.textContent).toContain('QA attachment check');
  expect(row.textContent).toContain('qa-riverstone.pdf');
  expect(row.textContent).toContain('Photo');
  expect(row.textContent).not.toContain('Context Warnings');
  expect(row.textContent).not.toContain('allowed workspace');
  expect(row.textContent).not.toContain('/Users/qa');
});

it("persists a thumbs-up reaction and renders a URL preview from a bot reply", async () => {
  mocks.getSessionMessages.mockImplementation(async () => ({ messages: [{ role: 'assistant', content: 'See [Board deck](https://docs.google.com/presentation/d/abc)' }] }));
  await renderApp(); await settle(); await settle();
  await act(async () => (host.querySelector('.m-pinned-bot') as HTMLButtonElement).click());
  await settle();
  expect(host.querySelector('.m-link-preview')?.textContent).toContain('Board deck');
  expect(host.querySelector('.m-reaction')).toBeNull();
  await act(async () => (host.querySelector('.m-assistant') as HTMLElement).dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true })));
  await act(async () => (Array.from(host.querySelectorAll('.m-pin-choice')).find(button => button.textContent?.includes('React thumbs up')) as HTMLButtonElement).click());
  expect(host.querySelector('.m-reaction')?.getAttribute('aria-pressed')).toBe('true');
  expect(storage.get('hermes-mobile-reactions')).toContain('true');
});

it("shows a waiting bot's request but still opens the canonical Bot Chat", async () => {
  mocks.waitingProfile = "author";
  mocks.liveSessions = [{ id: "pending-runtime", session_key: "pending-stored", title: "Approval owner", status: "waiting" }];
  mocks.getProfiles.mockResolvedValueOnce({ profiles: [{ name: "frodo", is_default: true }, { name: "author", is_default: false }] });
  await renderApp(); await settle(); await settle();
  await vi.waitFor(() => expect(host.querySelector('.m-bot-row small')?.textContent).toContain('Needs your input: Approval owner'));
  await act(async () => (host.querySelector('.m-bot-main') as HTMLButtonElement).click());
  expect(window.location.pathname).toBe('/m/chat/author/stored');
});

it("shows the pending approval in the bot's home status without losing its answer card", async () => {
  await renderApp(); await settle();
  await act(async () => { for (const handler of mocks.requests) handler({ id: 'approval-1', method: 'approval', params: { session_id: 'runtime', command: 'run tests', choices: ['once', 'deny'] }, respond: vi.fn(), fail: vi.fn() }); });
  expect(host.querySelector('.m-pinned-bot')?.getAttribute('aria-label')).toBe('Frodo, needs your input');
  expect(host.querySelector('.m-pinned-bot > span:last-of-type')?.textContent).toBe('Frodo');
  expect(host.querySelector('.m-inbox')?.textContent).toContain('run tests');
});

it("submits Continue to the same chat when a running turn finishes before steer", async () => {
  mocks.running = true;
  mocks.getProfiles.mockResolvedValueOnce({ profiles: [{ name: "samwise", is_default: true }] });
  await renderApp();
  await settle(); await settle();
  await openDestination("Screen");
  mocks.request.mockImplementationOnce(async () => ({ status: "rejected" }));
  await act(async () => (Array.from(host.querySelectorAll("button")).find(button => button.textContent === "Continue after hand back") as HTMLButtonElement).click());
  expect(mocks.request).toHaveBeenCalledWith("session.steer", {
    profile: "samwise", session_id: "runtime", text: "I handed back the screen; continue from the current state.",
  });
  expect(mocks.request).toHaveBeenCalledWith("prompt.submit", {
    profile: "samwise", session_id: "runtime", text: "I handed back the screen; continue from the current state.",
  });
  expect(host.textContent).toContain("Earlier");
});

it("switches to Chats, shows unread, opens with Ctrl+1 and marks the row read", async () => {
  mocks.getAllProfileSessions.mockImplementation(async (_limit, archived) => ({ sessions: archived === "only" ? [] : [
    { id: "side-frodo", profile: "frodo", title: "Prior chat", preview: "Earlier", last_active: 20, message_count: 2, unread: true },
    { id: "gandalf-found", profile: "gandalf", title: "Found chat", preview: "Match", last_active: 10, message_count: 2 },
  ] }));
  vi.stubGlobal("matchMedia", vi.fn((query: string) => ({ matches: query === "(min-width: 900px)", addEventListener: vi.fn(), removeEventListener: vi.fn() })));
  await renderApp(); await settle(); await settle();
  const chats = Array.from(host.querySelectorAll('.m-home-switch button')).find(b => b.textContent?.startsWith("Chats")) as HTMLButtonElement;
  expect(chats.textContent).toContain("1");
  await act(async () => chats.click());
  expect(Array.from(host.querySelectorAll('.m-chat-row strong')).map(n => n.textContent)).toEqual(["Prior chat", "Found chat"]);
  expect(host.querySelectorAll('.m-chat-row .m-bot-heading .m-chat-row-trailing .m-avatar-fallback').length).toBe(2);
  expect(host.querySelector('.m-chat-row[data-unread]')).not.toBeNull();
  expect(localStorage.getItem("hermes-mobile-home-tab")).toBe("chats");
  await act(async () => { window.dispatchEvent(new KeyboardEvent("keydown", { key: "/", ctrlKey: true })); });
  expect(document.body.textContent).toContain("Keyboard shortcuts");
  await act(async () => { window.dispatchEvent(new KeyboardEvent("keydown", { key: "1", ctrlKey: true })); });
  await settle();
  expect(mocks.setSessionUnread).toHaveBeenCalledWith("side-frodo", false, "frodo");
});

it("creates a project worktree on first send, shows failure and retries without losing the draft", async () => {
  let attempts = 0;
  mocks.fetchJSON.mockImplementation(async (url, init) => {
    if (url.startsWith("/api/mobile/projects")) return { projects: [{ id: "p_qa", label: "QA repo", path: "/qa/repo" }], supported: true };
    if (url === "/api/mobile/workspace") {
      attempts++;
      if (attempts === 1) throw new Error("Branch already exists");
      expect(JSON.parse(String(init?.body))).toEqual({ profile: "frodo", project_id: "p_qa", mode: "worktree", branch: "feat/qa-flow" });
      return { cwd: "/qa/repo/.worktrees/feat-qa-flow", branch: "feat/qa-flow" };
    }
    return { server_host: "testhost", client_on_server_host: false, profiles: {} };
  });
  await renderApp(); await settle(); await settle();
  await act(async () => (host.querySelector('.m-home [aria-label="New conversation"]') as HTMLButtonElement).click());
  await act(async () => (host.querySelector('.m-bot-picker button') as HTMLButtonElement).click());
  await settle();
  expect(host.querySelector('.m-new-chat')?.textContent).toContain('New conversation with Frodo');
  await act(async () => { const select = host.querySelector('#m-new-project') as HTMLSelectElement; select.value = 'p_qa'; select.dispatchEvent(new Event('change', { bubbles: true })); });
  await act(async () => (Array.from(host.querySelectorAll('.m-new-mode button')).find(button => button.textContent === 'New worktree') as HTMLButtonElement).click());
  await act(async () => { const input = host.querySelector('#m-new-branch') as HTMLInputElement; Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'feat/qa-flow'); input.dispatchEvent(new Event('input', { bubbles: true })); });
  const textarea = host.querySelector('.m-composer textarea') as HTMLTextAreaElement;
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(textarea, 'Test first send'); textarea.dispatchEvent(new Event('input', { bubbles: true })); });
  await act(async () => (host.querySelector('.m-composer .m-send') as HTMLButtonElement).click());
  expect(host.querySelector('.m-creation-progress [data-state="failed"]')?.textContent).toContain('Creating worktree');
  expect(host.textContent).toContain('Branch already exists');
  expect((host.querySelector('.m-composer textarea') as HTMLTextAreaElement).value).toBe('Test first send');
  expect(mocks.request).not.toHaveBeenCalledWith('session.create', expect.anything());
  await act(async () => (host.querySelector('.m-creation-error button') as HTMLButtonElement).click());
  expect(mocks.request).toHaveBeenCalledWith('session.create', { profile: 'frodo', source: 'mobile', close_on_disconnect: false, cwd: '/qa/repo/.worktrees/feat-qa-flow' });
  expect(mocks.request).toHaveBeenCalledWith('prompt.submit', { profile: 'frodo', session_id: 'new-runtime', text: 'Test first send' });
  expect(host.querySelector('.m-creation-progress')?.textContent).toContain('Bot is working');
  expect(attempts).toBe(2);
});
