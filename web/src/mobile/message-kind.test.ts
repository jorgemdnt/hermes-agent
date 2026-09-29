import { describe, expect, it } from "vitest";
import { classifyUserText, groupNoticeRows } from "./message-kind";

describe("classifyUserText", () => {
  it("attributes a bot delivery to the sending bot, not the human", () => {
    expect(classifyUserText("Message from 🤖 Frodo (@hermes): **ship** it")).toEqual({ kind: "agent", sender: "Frodo", handle: "hermes", body: "**ship** it" });
    expect(classifyUserText("[Message from agent 'gimli'] hi")).toMatchObject({ kind: "agent", sender: "gimli", body: "hi" });
  });
  it("turns cron, process and system injections into notices", () => {
    expect(classifyUserText('[Cronjob "Daily report" output — scheduled job, not the user.]\nbody')).toMatchObject({ kind: "system", label: "Scheduled job: Daily report" });
    expect(classifyUserText("[IMPORTANT: Background process p1 completed normally (exit code 0).\nCommand: x]")).toMatchObject({ kind: "system", label: "Background task finished", body: "Background process p1 completed normally (exit code 0).\nCommand: x" });
    expect(classifyUserText("[IMPORTANT: Background process p2 failed (exit code 1).]")).toMatchObject({ kind: "system", label: "Background task failed" });
    expect(classifyUserText("[System: stop thinking]")).toMatchObject({ kind: "system", label: "System notice" });
  });
  it("leaves what the human typed alone", () => {
    expect(classifyUserText("Can you redo the report?")).toEqual({ kind: "human", text: "Can you redo the report?" });
  });
  it("collapses only consecutive notices, not the assistant reply between them", () => {
    const notice = (text: string) => ({ role: "user" as const, text, timestamp: 1 });
    const rows = [notice("[IMPORTANT: Background process p1 completed normally (exit code 0).]"),
      notice("Message from Gimli (@gimli): hello"),
      { role: "assistant" as const, text: "I checked", timestamp: 2 },
      notice("[IMPORTANT: Background process p2 failed (exit code 1).]")];
    expect(groupNoticeRows(rows).map(group => group.length)).toEqual([2, 1, 1]);
  });
});
