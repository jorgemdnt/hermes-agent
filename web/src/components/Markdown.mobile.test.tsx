// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Markdown } from "./Markdown";

let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); });

it("renders a complete mobile answer with nested structure, safe links, and copyable scrolling code", async () => {
  const writeText = vi.fn(async () => {});
  vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
  const content = [
    "# Plan", "A **bold** and *italic* paragraph with `inline` and [docs](https://example.com/long/path).",
    "", "> Quoted **source**", "", "- First", "  - Nested", "    1. Deep item", "- Second",
    "", "3. Third", "4. Fourth", "", "| Name | Value |", "| --- | --- |", "| Alice | 42 |",
    "", "```ts", "const x = 42; // a long line which must stay on one line and scroll", "```",
    "", "[unsafe](javascript:alert(1))",
  ].join("\n");
  await act(async () => root.render(<Markdown content={content} streaming />));
  expect(host.querySelector("h1")?.textContent).toBe("Plan");
  expect(host.querySelector("strong")?.textContent).toBe("bold");
  expect(host.querySelector("em")?.textContent).toBe("italic");
  expect(host.querySelector("p code")?.textContent).toBe("inline");
  expect(host.querySelector("blockquote strong")?.textContent).toBe("source");
  expect(host.querySelector("ul > li > ul > li > ol > li")?.textContent).toBe("Deep item");
  expect(host.querySelector("ol[start='3']")?.children.length).toBe(2);
  expect(host.querySelector(".m-table-scroll table th")?.textContent).toBe("Name");
  expect(host.querySelector("td")?.textContent).toBe("Alice");
  expect(host.querySelector(".m-code-block pre code")?.textContent).toContain("const x = 42");
  expect(host.querySelector("a")?.getAttribute("href")).toBe("https://example.com/long/path");
  expect(host.querySelectorAll("a")).toHaveLength(1);
  await act(async () => (host.querySelector('[aria-label="Copy code"]') as HTMLButtonElement).click());
  expect(writeText).toHaveBeenCalledWith("const x = 42; // a long line which must stay on one line and scroll");
  expect(host.textContent).toContain("Copied");
});

it("renders inline code inside bold without raw backticks", async () => {
  await act(async () => root.render(<Markdown content="Use **`pnpm test` before shipping**." />));
  expect(host.querySelector('strong code')?.textContent).toBe('pnpm test');
  expect(host.querySelector('strong')?.textContent).not.toContain('`');
});

it("keeps a long link's full destination and accessible text while streaming", async () => {
  const url = `https://example.com/${"a".repeat(320)}`;
  await act(async () => root.render(<Markdown content={url} streaming />));
  const link = host.querySelector("a");
  expect(link?.href).toBe(url);
  expect(link?.textContent).toBe(url);
  expect(host.querySelector(".m-streaming-caret")?.getAttribute("aria-hidden")).toBe("true");
});
