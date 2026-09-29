import { expect, it } from "vitest";
import type { SessionInfo } from "@/lib/api";
import { conversationProject, sideConversations } from "./conversations";

it("groups worktree sessions under their registered repository", () => {
  expect(conversationProject({ git_repo_root: "/repo/.worktrees/feat-qa", cwd: "/repo/.worktrees/feat-qa" })).toBe("/repo");
  expect(conversationProject({ git_repo_root: "/repo", cwd: "/repo" })).toBe("/repo");
  expect(conversationProject({ git_repo_root: "", cwd: "/other" })).toBe("/other");
});

it("keeps back-filled pins, puts pins first, and leaves the Bot Chat on its bot row", () => {
  const rows = [
    { id: "new", profile: "default", title: "New session", preview: "", last_active: 30 },
    { id: "bot", profile: "gandalf", title: "Bot Chat", last_active: 25 },
    { id: "old", profile: "gandalf", title: "Named side chat", last_active: 10, pinned: true },
  ] as SessionInfo[];
  expect(sideConversations(rows, 2)).toEqual([
    { id: "old", profile: "gandalf", title: "Named side chat", preview: "", lastActive: 10, createdAt: 10, pinned: true, unread: false, project: "" },
    { id: "new", profile: "default", title: "New session", preview: "", lastActive: 30, createdAt: 30, pinned: false, unread: false, project: "" },
  ]);
});
