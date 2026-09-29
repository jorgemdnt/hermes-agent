# Bots and Chats

## Sub-features

Bots roster, Chats roster across profiles, unread badges, recent/created sort, project grouping and collapse, search, bot/chat switching, and keyboard navigation.

## How to get to it (user POV)

Open `/m`; the bottom or desktop-side Bots | Chats switch changes rosters. Select a bot for its chat or a conversation from Chats. Use Sort conversations, Group by project, or Search. In a chat press ⌘1–9 to select a visible bot/conversation; ⌘/ opens the shortcut help. In a browser tab Ctrl substitutes for Cmd.

## Driving it with verify-hermetic

After `doctor` and fixture sign-in: `cdp.mjs --port "$PORT" eval 'JSON.stringify([...document.querySelectorAll(".m-pinned-bot,.m-bot-row")].map(e=>e.innerText))'` shows Frodo and Atlas. `click '.m-home-switch button:last-child'` lists three `.m-chat-row` elements including `qa-default-long`; query `.m-chat-row strong` for titles and `.m-chat-row[data-unread]` for the second conversation. Click `[aria-label="Sort conversations"]`, then `[role="menuitemradio"]:last-child` for Date created. Click `.m-chats-tool[aria-pressed]` to group; `click '.m-chat-group-head:first-child'` collapses that project (assert `aria-expanded` and row count). Click a row, check `/m/chat/default/qa-default-long`, then use `key / 4` for shortcut help and `key Escape`. Use `key 1 4` and check selection. Search from `[aria-label="Search"]` and type into `[aria-label="Search bots and conversations"]`; assert matching visible results. Capture list screenshots at 390/1440 in light/dark, plus before/after unread and group collapse.

## Gotchas

The fixture's unread state changes once a chat is opened; check it before opening `qa-default-short`. A hidden/collapsed group changes the meaning of ⌘1–9. Desktop screenshot emulation is per CDP call; never assume a prior `resize` or `theme` command persists. Inspect the CSS line clamp and long-title tooltip as well as pixels. Search may debounce; wait for rendered results rather than asserting immediately.
