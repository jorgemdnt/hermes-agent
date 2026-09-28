import { expect, it } from "vitest";
import { servedEntry } from "./useLatestBuild";

it("reads the bundle entry the server serves", () => {
  expect(servedEntry('<script type="module" src="/assets/index-jbYRQw9Y.js"></script>')).toBe("assets/index-jbYRQw9Y.js");
  expect(servedEntry("<html></html>")).toBeNull();
});
