// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { expect, it } from "vitest";
import { HomeSwitch, type HomeTab } from "./HomeSwitch";

it("moves one segment at a time, wraps and focuses the selected radio", async () => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  function Switch() {
    const [tab, setTab] = useState<HomeTab>("bots");
    return <HomeSwitch value={tab} onChange={setTab} chatsUnread={2} />;
  }
  try {
    await act(async () => root.render(<Switch />));
    const group = host.querySelector('[role="radiogroup"]')!;
    for (const [key, value] of [["ArrowRight", "chats"], ["ArrowRight", "board"], ["ArrowLeft", "chats"], ["Home", "bots"], ["End", "board"], ["ArrowRight", "bots"]]) {
      await act(async () => group.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true })));
      const selected = host.querySelector<HTMLElement>('[aria-checked="true"]')!;
      expect(group.getAttribute("data-value")).toBe(value);
      expect(document.activeElement).toBe(selected);
      expect(selected.tabIndex).toBe(0);
      expect(host.querySelectorAll('[role="radio"][tabindex="0"]')).toHaveLength(1);
    }
    expect(host.querySelector('[aria-label="2 unread"]')).not.toBeNull();
  } finally {
    act(() => root.unmount());
    host.remove();
  }
});
