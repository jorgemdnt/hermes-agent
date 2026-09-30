// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { RightSplit } from "./RightSplit";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
afterEach(() => { delete window.hermetic; });

it("ignores late guest events after Back closes a preview and replaces in-page redirects", async () => {
  window.hermetic = { titlebarInset: 0 } as Window["hermetic"];
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host), onAddress = vi.fn();
  const render = (url: string) => act(() => root.render(<RightSplit open={!!url} width={520} onWidth={() => {}} onClose={() => {}} tab="browser" onTab={() => {}} browserUrl={url} onBrowserUrl={onAddress} suggestions={[]} filePath="" profile="default" session="chat" />));
  try {
    await render("https://linear.app/team/issue/ART-1");
    const guest = host.querySelector("webview")!;
    let url = "https://linear.app/team/issue/ART-1";
    Object.assign(guest, { getURL: () => url, loadURL: vi.fn().mockResolvedValue(undefined) });
    await act(() => guest.dispatchEvent(new Event("dom-ready")));
    url += "?noRedirect=1";
    await act(() => guest.dispatchEvent(new Event("did-navigate-in-page")));
    expect(onAddress).toHaveBeenLastCalledWith(url, true);
    onAddress.mockClear();
    await render("");
    await act(() => { guest.dispatchEvent(new Event("did-navigate")); guest.dispatchEvent(new Event("dom-ready")); });
    expect(onAddress).not.toHaveBeenCalled();
  } finally { await act(() => root.unmount()); host.remove(); }
});
