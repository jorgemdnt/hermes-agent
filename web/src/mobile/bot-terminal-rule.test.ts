import { describe, expect, it } from "vitest";
import { showBotScreen, type BotTerminalCapabilities } from "./bot-terminal-rule";

const capabilities: BotTerminalCapabilities = {
  server_host: "Jorges-MacBook-Pro.local",
  client_on_server_host: false,
  profiles: {
    default: { backend: "local", local_to_server: true },
    samwise: { backend: "ssh", local_to_server: false },
  },
};

describe("bot computer visibility", () => {
  it("hides local screens only in hermetic on the server host", () => {
    expect(showBotScreen(capabilities, "default", false, "Jorges-MacBook-Pro.local")).toBe(false);
    expect(showBotScreen(capabilities, "samwise", false, "Jorges-MacBook-Pro.local")).toBe(true);
    expect(showBotScreen(capabilities, "default", false, "other-host")).toBe(true);
  });
  it("uses the server's client-address hint for desktop browsers", () => {
    expect(showBotScreen({ ...capabilities, client_on_server_host: true }, "default", false)).toBe(false);
    expect(showBotScreen(capabilities, "default", false)).toBe(true);
  });
  it("keeps screen on the phone for both hosts", () => {
    expect(showBotScreen({ ...capabilities, client_on_server_host: true }, "default", true)).toBe(true);
    expect(showBotScreen(capabilities, "samwise", true)).toBe(true);
  });
});
