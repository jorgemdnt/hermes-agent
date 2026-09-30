// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it } from "vitest";
import { NewChatToolbar } from "./NewChatSetup";

it("only offers worktree creation for the selected Git folder", async () => {
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  const projects = [{ id: "repo", label: "Repo", path: "/host/repo", git: true }, { id: "plain", label: "Files", path: "/host/files", git: false }];
  const choices: string[] = [];
  const render = async (projectId: string) => act(async () => root.render(<NewChatToolbar container={host} projects={projects} supported projectId={projectId} onProject={() => {}} mode="local" onMode={mode => choices.push(mode)} branch="feat/work" onBranch={() => {}} branchError="" disabled={false} />));
  try {
    await render("plain");
    expect((host.querySelector('[type="checkbox"]') as HTMLInputElement).disabled).toBe(true);
    await render("repo");
    const checkbox = host.querySelector('[type="checkbox"]') as HTMLInputElement;
    expect(checkbox.disabled).toBe(false);
    await act(async () => checkbox.click());
    expect(choices).toEqual(["worktree"]);
    await render("");
    expect((host.querySelector('[type="checkbox"]') as HTMLInputElement).disabled).toBe(true);
  } finally { await act(async () => root.unmount()); host.remove(); }
});
