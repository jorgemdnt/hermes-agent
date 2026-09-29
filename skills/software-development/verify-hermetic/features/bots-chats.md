# Bots and Chats

## Sub-features

Bots roster, Chats roster across profiles, unread badges, recent/created sort, project grouping and collapse, search, bot/chat switching, and keyboard navigation.

## How to get to it (user POV)

Open `/m`; the bottom or desktop-side Bots | Chats switch changes rosters. Select a bot for its chat or a conversation from Chats. Use Sort conversations, Group by project, or Search. In a chat press ⌘1–9 to select a visible bot/conversation; ⌘/ opens the shortcut help. In a browser tab Ctrl substitutes for Cmd.

## Driving it with verify-hermetic

After `doctor` and fixture sign-in: `cdp.mjs --port "$PORT" eval 'JSON.stringify([...document.querySelectorAll(".m-pinned-bot,.m-bot-row")].map(e=>e.innerText))'` shows Frodo and Atlas. `click '.m-home-switch button:last-child'` lists three `.m-chat-row` elements including `qa-default-long`; query `.m-chat-row strong` for titles and `.m-chat-row[data-unread]` for the second conversation. Click `[aria-label="Sort conversations"]`, then `[role="menuitemradio"]:last-child` for Date created. Click `.m-chats-tool[aria-pressed]` to group; `click '.m-chat-group-head:first-child'` collapses that project (assert `aria-expanded` and row count). Click a row, check `/m/chat/default/qa-default-long`, then use `key / 4` for shortcut help and `key Escape`. Use `key 1 4` and check selection. Search from `[aria-label="Search"]` and type into `[aria-label="Search bots and conversations"]`; assert matching visible results. Capture list screenshots at 390/1440 in light/dark, plus before/after unread and group collapse.

## New conversation and worktrees

The fixture registers Orion (a committed throwaway Git repository) for `default` and Nebula for `atlas`. In Chats enable Group by project, click `[aria-label="New conversation in orion"]`, and assert `#m-new-project` selects Orion. Check that the bot's tiny avatar is top-right of each row and that rows have no borders. In the empty chat, choose `.m-new-mode button:last-child`, fill `#m-new-branch` with `feat/qa-check`, and send a disposable prompt. Inspect the progress list for Creating worktree → Starting chat → Bot is working; verify `git -C "$QA/projects/orion" worktree list` and the new chat's folder endpoint. The fixture has no model provider, so a later provider error is expected; do not call that an answered chat. For forced failure, use an invalid branch (e.g. `../../bad`): the failed Creating worktree step and Retry button must remain visible, the draft must remain, and no worktree/session must be created. Capture action and result at both viewports. The SSH bot path must show the unsupported explanation, never create a local worktree for that bot. `tests/hermes_cli/test_web_mobile_workspace.py` and `web/src/mobile/MobileApp.test.tsx` cover the inaccessible stages and retry. Never use a live project for the send probe.

## Gotchas

The fixture's unread state changes once a chat is opened; check it before opening `qa-default-short`. A hidden/collapsed group changes the meaning of ⌘1–9. Desktop screenshot emulation is per CDP call; never assume a prior `resize` or `theme` command persists. Inspect the CSS line clamp and long-title tooltip as well as pixels. Search may debounce; wait for rendered results rather than asserting immediately.
