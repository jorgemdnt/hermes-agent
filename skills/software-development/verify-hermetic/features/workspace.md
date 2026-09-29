# Terminal and split

## Sub-features

Conversation-scoped ⌘J terminal; right split Browser with address, localhost links and navigation; read-only Files; Screen for supported profiles; drag/keyboard resize and close.

## How to get to it (user POV)

In a chat, press ⌘J for the terminal. Use Open right split in the floating chat controls, then Browser/Files/Screen tabs. A localhost link in a chat opens Browser; a file link opens Files. The Browser address accepts HTTP(S), and the splitter can be dragged or nudged with arrow keys.

## Driving it with verify-hermetic

On `qa-default-long`, `key j 4` shows `.m-terminal-dock` with `projects/orion` as its folder. Click `[aria-label="Hide terminal"]`. Click `[aria-label="Open right split"]`; assert `[role="tabpanel"][aria-label="browser"]` and `.m-split-browser-empty` are visible instead of a white `about:blank` pane. The suggested URL must have the fixture's random port, not live port 9119. Click `.m-split-suggestions button`, then check `[aria-label="Browser address"]` and `webview.getURL()` both show the fixture localhost health page. Select `[role="tab"]:nth-child(2)` (Files), verify `.m-split-file-list` contains `fixture.md`, click it and inspect `.m-split-file-content` for the isolated QA text. On a bot with a Screen tab, switch there and verify live canvas or a clear unavailable state. For resize, focus `[aria-label="Resize right split"]`, dispatch ArrowLeft/ArrowRight, and assert `aria-valuenow` changes. Capture empty Browser, loaded Browser, Files, and 390/1440 screenshots.

## Gotchas

The native Browser is a separate Electron webview partition; renderer DOM does not include the guest page. Never navigate its suggested link to the live dashboard. The native guest can have `about:blank` attached even while the empty-state overlay is shown. Screen needs a supported profile and a reachable screen gateway; the fake fixture does not produce a real remote stream. The terminal may start a real local shell even with fixture Hermes state; keep commands read-only. Do not use process-name kills for teardown.
