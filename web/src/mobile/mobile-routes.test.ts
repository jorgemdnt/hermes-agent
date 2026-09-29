import { expect, it } from "vitest";
import { mobileRoute } from "./mobile-routes";

it("keeps the conversation id in a phone terminal route", () => {
  expect(mobileRoute("/m/terminal/samwise/chat-1")).toEqual({ view: "terminal", profile: "samwise", session: "chat-1" });
  expect(mobileRoute("/m/terminal/samwise")).toEqual({ view: "terminal", profile: "samwise", session: "" });
});
