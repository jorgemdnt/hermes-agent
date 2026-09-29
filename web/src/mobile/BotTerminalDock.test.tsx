// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import BotTerminalDock from "./BotTerminalDock";

const mocks = vi.hoisted(() => ({
  sockets: [] as string[],
  fetchFolder: vi.fn(async (url: string) => ({ folder: url.includes("session=chat-a") ? "/workspace/a" : "/workspace/b" })),
}));
vi.mock("@xterm/xterm", () => ({ Terminal: class {
  cols = 80; rows = 24;
  loadAddon() {} open() {} onData() { return { dispose() {} }; }
  write() {} focus() {} dispose() {}
} }));
vi.mock("@xterm/addon-fit", () => ({ FitAddon: class { fit() {} } }));
vi.mock("@/lib/api", () => ({
  api: { buildWsUrl: async (_path: string, params: { profile: string; session: string }) => `wss://test/terminal?profile=${params.profile}&session=${params.session}` },
  fetchJSON: mocks.fetchFolder,
}));

let root: Root;
let host: HTMLDivElement;
const render = async (session: string, open = true) => {
  await act(async () => root.render(<BotTerminalDock profile="samwise" session={session} open={open} fullScreen={false}
    height={310} onHeightChange={() => {}} onClose={() => {}} />));
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
};
beforeEach(() => {
  mocks.sockets.length = 0;
  mocks.fetchFolder.mockClear();
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  vi.stubGlobal("WebSocket", class {
    static OPEN = 1;
    readyState = 1;
    binaryType = "";
    constructor(url: string) { mocks.sockets.push(url); }
    send() {} close() {}
  });
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => { cb(0); return 1; });
  vi.stubGlobal("cancelAnimationFrame", () => {});
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); });

it("retains independent terminal tabs across conversation switches and shows their server folders", async () => {
  await render("chat-a");
  expect(host.querySelector(".m-terminal-title")?.textContent).toContain("/workspace/a");
  expect(mocks.sockets).toEqual(["wss://test/terminal?profile=samwise&session=chat-a"]);
  await act(async () => (host.querySelector('[aria-label="New terminal tab"]') as HTMLButtonElement).click());
  expect(host.querySelectorAll(".m-terminal-tab")).toHaveLength(2);

  await render("chat-b");
  expect(host.querySelector(".m-terminal-title")?.textContent).toContain("/workspace/b");
  expect(host.querySelectorAll(".m-terminal-tab")).toHaveLength(1);
  expect(mocks.sockets).toHaveLength(3);

  await render("chat-a", false);
  await render("chat-a");
  expect(host.querySelectorAll(".m-terminal-tab")).toHaveLength(2);
  expect(mocks.sockets).toHaveLength(3);
  expect(host.querySelector(".m-terminal-title")?.textContent).toContain("/workspace/a");
});
