// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ComposerAttachments } from "./ComposerAttachments";
import MobileMessage from "./MobileMessage";

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.stubGlobal("fetch", vi.fn(async () => new Response("image", { headers: { "Content-Type": "image/png" } })));
  vi.stubGlobal("URL", class extends URL { static createObjectURL = vi.fn(() => "blob:message-image"); static revokeObjectURL = vi.fn(); });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.useRealTimers(); vi.unstubAllGlobals(); });

it("keeps image/file metadata and removal controls together without redundant sent-image labels", async () => {
  const removePhoto = vi.fn(), removeFile = vi.fn();
  const photo = new File(["image"], "roof.png", { type: "image/png" });
  const file = new File(["report"], "report.pdf");
  act(() => root.render(<ComposerAttachments photos={[{ file: photo, preview: "blob:roof" }]} files={[file]} status={{ "photo:0": "Uploading" }} onRemovePhoto={removePhoto} onRemoveFile={removeFile} />));
  const chips = host.querySelectorAll(".m-attachment-chip");
  expect(chips).toHaveLength(2);
  expect(chips[0].querySelector("img")?.alt).toBe(photo.name);
  expect(chips[0].textContent).toContain("1 KB");
  expect(chips[0].querySelector('[role="status"]')?.textContent).toContain("Uploading");
  act(() => (chips[0].querySelector("button") as HTMLButtonElement).click());
  act(() => (chips[1].querySelector("button") as HTMLButtonElement).click());
  expect(removePhoto).toHaveBeenCalledWith(0); expect(removeFile).toHaveBeenCalledWith(0);
  await act(async () => root.render(<MobileMessage profile="default" row={{ role: "user", text: "See the roof\n@image:/images/roof.png", timestamp: 100 }} onAction={vi.fn()} />));
  const image = host.querySelector(".m-image-attachment img") as HTMLImageElement;
  expect(image.alt).toBe(photo.name);
  expect(image.closest("a")?.getAttribute("href")).toBe("blob:message-image");
  expect(host.querySelector(".m-bubble")?.textContent).not.toContain("Photo");
  act(() => image.dispatchEvent(new Event("error")));
  expect(host.querySelector(".m-image-ref")?.textContent).toContain(photo.name);
});

it("reveals timestamp on tap or long-press, not scrolling, and keeps metadata outside the bubble", () => {
  vi.useFakeTimers();
  const action = vi.fn();
  act(() => root.render(<MobileMessage profile="default" row={{ role: "user", text: "A message", timestamp: 100 }} onAction={action} />));
  const message = host.querySelector("article") as HTMLElement;
  expect(host.querySelector(".m-bubble time")).toBeNull();
  expect(host.querySelector(".m-message-footer time")).not.toBeNull();
  const touch = (name: string, x = 10) => {
    const event = new Event(name, { bubbles: true });
    Object.defineProperty(event, "touches", { value: [{ clientX: x, clientY: 10 }] });
    act(() => message.dispatchEvent(event));
  };
  expect(message.hasAttribute("data-timestamp-visible")).toBe(false);
  touch("touchstart"); touch("touchend");
  expect(message.getAttribute("data-timestamp-visible")).toBe("true");
  touch("touchstart"); touch("touchend");
  expect(message.hasAttribute("data-timestamp-visible")).toBe(false);
  touch("touchstart"); touch("touchmove", 50); touch("touchend");
  expect(message.hasAttribute("data-timestamp-visible")).toBe(false);
  expect(action).not.toHaveBeenCalled();
  touch("touchstart"); act(() => vi.advanceTimersByTime(550)); touch("touchend");
  expect(message.getAttribute("data-timestamp-visible")).toBe("true");
  expect(action).toHaveBeenCalledExactlyOnceWith("A message");
});
