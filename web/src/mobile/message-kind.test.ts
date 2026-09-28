import { describe, expect, it } from "vitest";
import { classifyUserText } from "./message-kind";

describe("classifyUserText", () => {
  it("attributes a bot delivery to the sending bot, not the human", () => {
    expect(classifyUserText("Message from 🤖 Frodo (@hermes): **ship** it")).toEqual({ kind: "agent", sender: "Frodo", handle: "hermes", body: "**ship** it" });
    expect(classifyUserText("[Message from agent 'gimli'] hi")).toMatchObject({ kind: "agent", sender: "gimli", body: "hi" });
  });
  it("turns cron, process and system injections into notices", () => {
    expect(classifyUserText('[Cronjob "Daily report" output — scheduled job, not the user.]\nbody')).toMatchObject({ kind: "system", label: "Scheduled job: Daily report" });
    expect(classifyUserText("[IMPORTANT: Background process p1 completed.\nCommand: x]")).toMatchObject({ kind: "system", body: "Command: x" });
    expect(classifyUserText("[System: stop thinking]").kind).toBe("system");
  });
  it("leaves what the human typed alone", () => {
    expect(classifyUserText("Can you redo the report?")).toEqual({ kind: "human", text: "Can you redo the report?" });
  });
});
