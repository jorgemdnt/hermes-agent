# Conversation

## Sub-features

Assistant/user bubbles and loading, grouped notices, floating bot pill and jump-to-latest, text composer and slash/mention suggestions, file/photo previews and removal, message actions.

## How to get to it (user POV)

Choose Frodo's long conversation in Chats. Scroll its transcript under the floating identity pill. Type in Message; use + to attach a file or photo, but do not send from this fixture without a gateway. The three-dot message controls expose actions. Press ⌘/ for shortcut help.

## Driving it with verify-hermetic

`click '.m-chat-row:has(strong[title^="The very"])'`; assert `/m/chat/default/qa-default-long` and `.m-message` count. `scroll '.m-messages' -2000`; capture `shot "$QA/screenshots/chat-390-light.png" 390 844 light` and 1440/dark counterparts, ensuring text goes behind an opaque readable pill, not a header bar. `fill '.m-composer textarea' 'QA unsent draft'`; assert textarea value and `.m-send`. `attach '.m-composer input[type=file]:not([accept])' "$QA/projects/orion/fixture.md"`; assert `.m-file-previews` displays `fixture.md`, capture it, then click `[aria-label^="Remove fixture.md"]` and assert it disappears while message count remains unchanged. Open + menu and check Photo and File. Inspect message action buttons and notice grouping; use existing web tests for gateway-driven send, slash completion, typing, prompt responses, and upload. Capture state before/after each safe interaction.

## Gotchas

The fixture intentionally lacks a model gateway, so sending or dictating is not a valid end-to-end test here. `fixture.md` is read-only preview input; attachment selection does not prove upload. An alternating long transcript ends with an assistant message to avoid the app's real interrupted-turn notice. A one-off CDP screenshot viewport does not persist to the next command; take screenshots at both sizes and do not claim phone touch interactions solely from a desktop click.
