// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const fetchJSON = vi.hoisted(() => vi.fn(async (url: string) => {
  if (url.endsWith("/boards")) return { current: "default", boards: [{ slug: "default" }] };
  if (url.includes("/tasks/")) return {
    task: { id: "t_1", title: "Ship the feature", status: "running", assignee: "gandalf", body: "**Scope**: read only", latest_summary: "Done safely", created_at: 900 },
    runs: [{ id: 4, status: "done", outcome: "success", summary: "Tests passed" }],
    comments: [{ id: 1, author: "Jorge", body: "Approved" }],
  };
  return { now: 1000, columns: [
    { name: "triage", tasks: [] }, { name: "todo", tasks: [] },
    { name: "scheduled", tasks: [{ id: "t_2", title: "Scheduled task", status: "scheduled", created_at: 940 }] },
    { name: "ready", tasks: [] },
    { name: "running", tasks: [{ id: "t_1", title: "Ship the feature", status: "running", assignee: "gandalf", model_override: "gpt-6-sol", created_at: 900 }] },
    { name: "blocked", tasks: [] }, { name: "review", tasks: [] }, { name: "done", tasks: [] },
  ] };
}));
vi.mock("@/lib/api", () => ({ fetchJSON }));
import MobileKanban from "./MobileKanban";

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  fetchJSON.mockClear();
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); });
const settle = async () => act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });

it("renders real API statuses, model, owner avatar, age and live marker without edit controls", async () => {
  const onSelectTask = vi.fn();
  await act(async () => root.render(<MobileKanban onSelectTask={onSelectTask} getSavedScroll={() => 0} onScroll={() => {}} avatars={{ gandalf: "/gandalf.png" }} />));
  await settle(); await settle();
  expect(fetchJSON).toHaveBeenCalledWith("/api/plugins/kanban/boards");
  expect(fetchJSON).toHaveBeenCalledWith("/api/plugins/kanban/board?board=default");
  expect(Array.from(host.querySelectorAll(".m-column h3")).map(node => node.textContent?.trim())).toEqual([
    "triage 0", "todo 0", "scheduled 1", "ready 0", "running 1", "blocked 0", "review 0", "done 0",
  ]);
  const card = Array.from(host.querySelectorAll(".m-task")).find(node => node.textContent?.includes("t_1")) as HTMLButtonElement;
  expect(card.textContent).toContain("gpt-6-sol");
  expect(card.textContent).toContain("Running");
  expect(card.querySelector("img")?.getAttribute("src")).toBe("/gandalf.png");
  expect(card.querySelector("time")?.textContent).toBe("1m");
  expect(host.querySelector("form, [draggable], input")).toBeNull();
  await act(async () => card.click());
  expect(onSelectTask).toHaveBeenCalledWith("t_1");
});

it("loads the clicked card body, result, comments and runs", async () => {
  await act(async () => root.render(<MobileKanban taskId="t_1" onSelectTask={() => {}} getSavedScroll={() => 0} onScroll={() => {}} />));
  await settle(); await settle();
  expect(fetchJSON).toHaveBeenCalledWith("/api/plugins/kanban/tasks/t_1?board=default");
  const detail = host.querySelector(".m-task-detail") as HTMLElement;
  expect(detail.textContent).toContain("Scope: read only");
  expect(detail.textContent).toContain("Done safely");
  expect(detail.textContent).toContain("Tests passed");
  expect(detail.textContent).toContain("Approved");
});
