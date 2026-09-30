// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { AccountAvatar } from "./AccountAvatar";

vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
let cleanup = () => {};
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.useRealTimers(); });

it("retries transient failures, bounds automatic retries, and recovers on reconnect", async () => {
  vi.useFakeTimers();
  const images: HTMLImageElement[] = [];
  const OriginalImage = window.Image;
  vi.spyOn(window, "Image").mockImplementation(function () {
    const image = new OriginalImage();
    Object.defineProperty(image, "complete", { get: () => false, configurable: true });
    images.push(image);
    return image;
  });
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  cleanup = () => { act(() => root.unmount()); host.remove(); };
  await act(async () => root.render(<AccountAvatar picture="/api/auth/avatar" name="Jorge" />));
  for (const delay of [1000, 5000, 30000]) {
    await act(async () => images.at(-1)!.dispatchEvent(new Event("error")));
    expect(host.textContent).toBe("J");
    const count = images.length;
    await act(async () => vi.advanceTimersByTime(delay));
    expect(images.length).toBe(count + 1);
  }
  await act(async () => images.at(-1)!.dispatchEvent(new Event("error")));
  const count = images.length;
  await act(async () => vi.advanceTimersByTime(120000));
  expect(images.length).toBe(count);
  await act(async () => window.dispatchEvent(new Event("online")));
  expect(images.length).toBe(count + 1);
  const recovered = images.at(-1)!;
  Object.defineProperty(recovered, "complete", { get: () => true });
  Object.defineProperty(recovered, "naturalWidth", { get: () => 96 });
  await act(async () => recovered.dispatchEvent(new Event("load")));
  expect(host.querySelector("img")?.getAttribute("src")).toContain("retry=");
  expect(host.querySelector(".m-avatar-fallback")).toBeNull();
});
