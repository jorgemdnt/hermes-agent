// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, useLocation, useNavigate } from "react-router";
import { expect, it, vi } from "vitest";
import { cardReference, linkifyCardMentions, isWorkItemLink, resolveCard, NavigationHistory } from "@hermes/shared";
import { HistoryButtons, useMobileNavigation } from "./navigation";

it("resolves card titles by board and leaves code, malformed IDs and auth failures alone", async () => {
  expect(cardReference("https://hermes.example/m/board/t_1234abcd?board=team" )).toEqual({ id: "t_1234abcd", board: "team" });
  expect(cardReference("t_1234ABCD")).toBeNull();
  expect(linkifyCardMentions("t_1234abcd `t_1234abcd` [Title](/m/board/t_1234abcd)")).toBe("[t_1234abcd](/m/board/t_1234abcd) `t_1234abcd` [Title](/m/board/t_1234abcd)");
  const get = vi.fn(async (_id: string, board: string) => {
    if (board !== "team") throw new Error("404 not found");
    return { task: { id: "t_1234abcd", title: "A human title", status: "review" } };
  });
  expect(await resolveCard({ id: "t_1234abcd" }, "default", get, async () => ({ boards: [{ slug: "default" }, { slug: "team" }] }))).toEqual({ id: "t_1234abcd", title: "A human title", status: "review", board: "team" });
  const boards = vi.fn();
  await expect(resolveCard({ id: "t_1234abcd" }, "default", async () => { throw new Error("401"); }, boards)).rejects.toThrow("401");
  expect(boards).not.toHaveBeenCalled();
  expect(isWorkItemLink("https://github.com/org/repo/pull/12")).toBe(true);
  expect(isWorkItemLink("https://linear.app/team/issue/ART-1/title")).toBe(true);
  expect(isWorkItemLink("https://github.com.evil.test/org/repo/pull/12")).toBe(false);
});

it("uses one back/forward stack for chat, card and preview; new navigation drops forward entries", async () => {
  const stack = new NavigationHistory<{ route: string; offset: number }>(entry => entry.route);
  stack.record({ route: "chat", offset: 240 }); stack.record({ route: "card", offset: 0 });
  expect(stack.move(-1)).toEqual({ route: "chat", offset: 240 });
  stack.record({ route: "pr", offset: 0 }); expect(stack.canGoForward).toBe(false);
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  window.history.replaceState({ idx: 0 }, "", "/m/chat/default/one");
  function Probe() {
    const location = useLocation(); const navigate = useNavigate(); const history = useMobileNavigation();
    return <><HistoryButtons {...history} /><output>{location.pathname}{location.search}</output><button data-action="card" onClick={() => navigate("/m/board/t_1234abcd")}>Card</button><button data-action="pr" onClick={() => navigate("/m/chat/default/one?preview=https%3A%2F%2Fgithub.com%2Forg%2Frepo%2Fpull%2F12")}>PR</button></>;
  }
  const click = async (selector: string) => { await act(async () => (host.querySelector(selector) as HTMLButtonElement).click()); };
  try {
    await act(async () => root.render(<BrowserRouter><Probe /></BrowserRouter>));
    await click('[data-action="card"]'); expect(host.querySelector("output")?.textContent).toBe("/m/board/t_1234abcd");
    await act(async () => { window.dispatchEvent(new KeyboardEvent("keydown", { key: "[", metaKey: true, cancelable: true })); await new Promise(resolve => setTimeout(resolve, 30)); });
    expect(host.querySelector("output")?.textContent).toBe("/m/chat/default/one");
    await click('[aria-label="Go forward"]');
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 30)); });
    expect(host.querySelector("output")?.textContent).toBe("/m/board/t_1234abcd");
    await click('[data-action="pr"]');
    expect(host.querySelector("output")?.textContent).toContain("?preview=");
    await click('[aria-label="Go back"]');
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 30)); });
    expect(host.querySelector("output")?.textContent).toBe("/m/board/t_1234abcd");
  } finally { await act(async () => root.unmount()); host.remove(); }
});
