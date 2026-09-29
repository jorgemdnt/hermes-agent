import { describe, expect, it } from "vitest";
import { browserAddress, fileLinkPath, localPreviewLink } from "./preview-links";

describe("browser and conversation file links", () => {
  it("normalizes HTTP(S) and local dev URLs but rejects active or local-file schemes", () => {
    expect(browserAddress("localhost:3000/dashboard")).toBe("http://localhost:3000/dashboard");
    expect(browserAddress("https://example.com")).toBe("https://example.com/");
    expect(browserAddress("file:///etc/passwd")).toBeNull();
    expect(browserAddress("javascript:alert(1)")).toBeNull();
    expect(localPreviewLink("http://127.0.0.1:3000/test")).toBe("http://127.0.0.1:3000/test");
    expect(localPreviewLink("https://example.com")).toBeNull();
  });
  it("only opens linked files beneath the conversation folder", () => {
    const folder = "/workspace/my project";
    expect(fileLinkPath("file:///workspace/my%20project/src/app.ts", folder)).toBe("src/app.ts");
    expect(fileLinkPath("./src/app.ts", folder)).toBe("src/app.ts");
    expect(fileLinkPath("../secret.ts", folder)).toBeNull();
    expect(fileLinkPath("src/%2e%2e/secret.ts", folder)).toBeNull();
    expect(fileLinkPath("file:///workspace/other/secret.ts", folder)).toBeNull();
  });
});
