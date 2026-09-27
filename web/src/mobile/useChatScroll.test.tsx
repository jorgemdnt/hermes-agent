// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it } from "vitest";
import { useChatScroll } from "./useChatScroll";

let root: Root;
let host: HTMLDivElement;
function Transcript({ id, text }: { id: string; text: string }) {
  const { container, atBottom, onScroll, scrollToLatest } = useChatScroll(id, text);
  return <><div className="messages" ref={container} onScroll={onScroll}><div>{text}</div></div>
    {!atBottom && <button type="button" onClick={scrollToLatest}>Latest</button>}</>;
}
beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); });
it("follows streaming only while at the bottom, offers a jump, and resets on conversation switch", () => {
  let height = 400;
  const oldScrollHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollHeight")!;
  const oldClientHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientHeight")!;
  Object.defineProperty(HTMLElement.prototype, "scrollHeight", { configurable: true, get: () => height });
  Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, get: () => 100 });
  try {
    act(() => root.render(<Transcript id="first" text="Hello" />));
    const box = host.querySelector(".messages") as HTMLDivElement;
    expect(box.scrollTop).toBe(400);
    height = 600;
    act(() => root.render(<Transcript id="first" text="Hello, streamed" />));
    expect(box.scrollTop).toBe(600);
    act(() => { box.scrollTop = 80; box.dispatchEvent(new Event("scroll", { bubbles: true })); });
    expect(host.textContent).toContain("Latest");
    height = 900;
    act(() => root.render(<Transcript id="first" text="Hello, streamed more" />));
    expect(box.scrollTop).toBe(80);
    act(() => (host.querySelector("button") as HTMLButtonElement).click());
    expect(box.scrollTop).toBe(900);
    act(() => { box.scrollTop = 50; box.dispatchEvent(new Event("scroll", { bubbles: true })); });
    act(() => root.render(<Transcript id="second" text="New chat" />));
    expect(box.scrollTop).toBe(900);
  } finally {
    if (oldScrollHeight) Object.defineProperty(HTMLElement.prototype, "scrollHeight", oldScrollHeight);
    else Reflect.deleteProperty(HTMLElement.prototype, "scrollHeight");
    if (oldClientHeight) Object.defineProperty(HTMLElement.prototype, "clientHeight", oldClientHeight);
    else Reflect.deleteProperty(HTMLElement.prototype, "clientHeight");
  }
});
