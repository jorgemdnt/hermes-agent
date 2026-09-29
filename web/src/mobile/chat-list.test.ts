import { expect, it } from "vitest";
import { adjacentChat, chatLayout, filterChats, projectLabel, unreadCount } from "./chat-list";
import type { Conversation } from "./conversations";

const chat = (id: string, o: Partial<Conversation> = {}): Conversation =>
  ({ id, profile: "frodo", title: id, preview: "", lastActive: 0, createdAt: 0, pinned: false, unread: false, project: "", ...o });
const rows = [
  chat("a", { lastActive: 30, createdAt: 1, project: "/w/artemis" }),
  chat("b", { lastActive: 20, createdAt: 3 }),
  chat("c", { lastActive: 10, createdAt: 2, project: "/w/artemis", unread: true }),
  chat("d", { lastActive: 40, createdAt: 0, project: "/w/hermes" }),
];
const none = new Set<string>();
const ids = (list: Conversation[]) => list.map(c => c.id);

it("sorts by recent activity or creation date, pins first", () => {
  expect(ids(chatLayout(rows, { sort: "recent", grouped: false, collapsed: none }).visible)).toEqual(["d", "a", "b", "c"]);
  expect(ids(chatLayout(rows, { sort: "created", grouped: false, collapsed: none }).visible)).toEqual(["b", "c", "a", "d"]);
  expect(ids(chatLayout([...rows, chat("p", { pinned: true })], { sort: "recent", grouped: false, collapsed: none }).visible)[0]).toBe("p");
});

it("groups by project with No project last, and collapsed groups leave the visible order", () => {
  const layout = chatLayout(rows, { sort: "recent", grouped: true, collapsed: none });
  expect(layout.groups.map(g => [g.label, ids(g.chats)])).toEqual([["hermes", ["d"]], ["artemis", ["a", "c"]], ["No project", ["b"]]]);
  const collapsed = chatLayout(rows, { sort: "recent", grouped: true, collapsed: new Set(["/w/artemis"]) });
  expect(ids(collapsed.visible)).toEqual(["d", "b"]);
});

it("counts unread, labels projects, filters, and finds neighbours", () => {
  expect(unreadCount(rows)).toBe(1);
  expect(projectLabel("/w/artemis/")).toBe("artemis");
  expect(ids(filterChats(rows, "ART", () => "x"))).toEqual([]);
  expect(ids(filterChats(rows, "gandalf", p => p === "frodo" ? "Gandalf" : p))).toEqual(["a", "b", "c", "d"]);
  const list = rows;
  expect(adjacentChat(list, "frodo/b", 1)?.id).toBe("c");
  expect(adjacentChat(list, "frodo/a", -1)).toBeUndefined();
  expect(adjacentChat(list, "gone/x", 1)?.id).toBe("a");
  expect(adjacentChat(list, "gone/x", -1)?.id).toBe("d");
});
