// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MessageFile, MessageImage } from "./MessageAttachment";

let host: HTMLDivElement;
let root: Root;
const fetch = vi.fn<typeof globalThis.fetch>();
beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  fetch.mockReset().mockResolvedValue(new Response("image", { headers: { "Content-Type": "image/png" } }));
  vi.stubGlobal("fetch", fetch);
  vi.stubGlobal("URL", class extends URL { static createObjectURL = vi.fn(() => "blob:attachment"); static revokeObjectURL = vi.fn(); });
  window.__HERMES_SESSION_TOKEN__ = "test-session";
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); delete window.__HERMES_SESSION_TOKEN__; vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it("authenticates image bytes instead of putting a token in the URL, and releases its preview on unmount", async () => {
  const src = "/api/chat/attachment/default/image/roof.png";
  await act(async () => root.render(<MessageImage src={src} name="roof.png" />));
  const [requested, init] = fetch.mock.calls[0];
  expect(requested).toBe(src);
  expect(new Headers(init?.headers).get("X-Hermes-Session-Token")).toBe("test-session");
  expect(init?.credentials).toBe("include");
  expect(host.querySelector("img")?.getAttribute("src")).toBe("blob:attachment");
  expect(host.querySelector("a")?.getAttribute("href")).toBe("blob:attachment");
  act(() => root.render(null));
  expect((init?.signal as AbortSignal).aborted).toBe(true);
  expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:attachment");
});

it("fetches files lazily using cookie auth, downloads their name, and reports a failed image without a broken preview", async () => {
  delete window.__HERMES_SESSION_TOKEN__;
  const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function () {
    expect(this.download).toBe("report.pdf");
    expect(this.getAttribute("href")).toBe("blob:attachment");
  });
  await act(async () => root.render(<MessageFile src="/api/chat/attachment/default/file/report.pdf" name="report.pdf" />));
  expect(fetch).not.toHaveBeenCalled();
  await act(async () => (host.querySelector("button") as HTMLButtonElement).click());
  expect(fetch.mock.calls[0][1]?.credentials).toBe("include");
  expect(new Headers(fetch.mock.calls[0][1]?.headers).has("X-Hermes-Session-Token")).toBe(false);
  expect(click).toHaveBeenCalledOnce();
  expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:attachment");
  fetch.mockResolvedValue(new Response("Not found", { status: 404 }));
  await act(async () => root.render(<MessageImage src="/api/chat/attachment/default/image/missing.png" name="missing.png" />));
  expect(host.querySelector("img")).toBeNull();
  expect(host.querySelector("button")?.textContent).toContain("missing.png");
  await act(async () => (host.querySelector("button") as HTMLButtonElement).click());
  expect(host.querySelector('[role="status"]')?.textContent).toBe("Download failed (404)");
  expect(click).toHaveBeenCalledOnce();
});
