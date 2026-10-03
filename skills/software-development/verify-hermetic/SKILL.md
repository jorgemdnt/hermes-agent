---
name: verify-hermetic
description: Verify the installed Hermetic Electron app and Hermes /m phone UI with an isolated dashboard, CDP, and captured QA evidence.
---

# Verify Hermetic

Run from the Hermes checkout containing this skill; use its `.venv`. The installed `/Applications/hermetic.app` is the actual client under test, not a browser-only substitute. The fixture starts a separate dashboard on a random loopback port and uses `~/Library/Caches/hermetic-qa` for its Hermes home, runtime, and Electron profile. It never uses the live `~/.hermes` root. **Do not** repoint the installed app to the live dashboard for this workflow.

## Launch

```sh
cd /Users/jorgemodesto/.hermes/hermes-agent/.worktrees/t_6118cc31
cd web && npm run build && cd ..
.venv/bin/python skills/software-development/verify-hermetic/scripts/fixture.py start
```

The command prints the disposable dashboard URL and CDP port, not the fixture password. It creates `default` and `atlas` bots, registered Orion/Nebula projects (Orion is a committed throwaway Git repository), a long-title transcript, an unread conversation, a localhost link targeting the fixture, and a read-only fixture file. It launches the installed app with `open -g -n` and a separate `HERMETIC_USER_DATA`; never bring a user's window forward. If `start` says a fixture exists, run `doctor` rather than creating another. A healthy launch exposes `/login` on the fixture loopback port and writes a private `fixture.json` (mode 0600) under `~/.hermes/cache/scratch/hermetic-v2/qa/`.

```sh
QA="$HOME/.hermes/cache/scratch/hermetic-v2/qa"
PORT=$(python3 -c 'import json,pathlib;print(json.loads((pathlib.Path.home()/".hermes/cache/scratch/hermetic-v2/qa/fixture.json").read_text())["cdp_port"])')
node skills/software-development/verify-hermetic/scripts/cdp.mjs --port "$PORT" signin "$QA/fixture.json"
```

The `signin` helper reads only the generated QA login from the fixture file. Never print or commit that file, cookies, live credentials, or auth headers. Tear down with `.venv/bin/python skills/software-development/verify-hermetic/scripts/fixture.py stop`. This closes only its CDP browser and server process group; it retains screenshots/report but removes disposable profiles. Run `stop` after failed attempts too.

## Doctor

Run `.venv/bin/python skills/software-development/verify-hermetic/scripts/fixture.py doctor`. It checks its PID, dashboard health, login, CDP target URL, and separate user-data directory. Stop if its target is not the fixture loopback origin. The source's `get_default_hermes_root` maps any `HERMES_HOME` beneath `~/.hermes` to the real root; never relocate fixture-home there. For a non-fixture installed app, `~/Library/Application Support/hermetic/DevToolsActivePort` identifies its CDP endpoint, but do not use that live instance for destructive QA.

## Drive

`cdp.mjs --port "$PORT"` accepts `doctor`, `text`, `eval JS`, `click CSS`, `fill CSS TEXT`, `attach CSS ABSOLUTE_FILE`, `scroll CSS PIXELS`, `key KEY MODIFIERS`, `navigate URL`, `shot ABSOLUTE_PNG WIDTH HEIGHT light|dark`, and `close`. It uses the real installed Electron target and CDP mouse/keyboard events. `MODIFIERS`: 4 is Command, 12 is Command+Shift. Prefix an action with `--width 390` (before its command) to interact in a phone viewport; each CDP connection is new, so repeat `--width 390` for the next action. The screenshot helper also applies a fresh per-call viewport and preferred color scheme; overrides do not persist across helper invocations. For desktop use 1440×900; for phone 390×844. The shell's theme remains `system` if no explicit in-app appearance choice was made, but CSS media emulation renders light/dark. Use `eval` for read-only DOM assertions (e.g. row titles, `aria-expanded`, viewport overflow). Never use `eval` to set app state in place of a user action.

Start at `/m` (Bots); click `.m-home-switch button:last-child` for Chats. Click `.m-chat-row` for a conversation; open the split with `[aria-label="Open right split"]`, and choose `[role="tab"]` Browser/Files. `click '.m-split-suggestions button'` visits the fixture's localhost link. `key j 4` toggles the scoped terminal. `fill '.m-composer textarea' 'unsent draft'` exercises input; `attach '.m-composer input[type=file]:not([accept])' "$QA/projects/orion/fixture.md"` exercises a disposable file without sending a message. Use the feature map below for each entry point and proof condition. The fixture dashboard does not launch a model gateway: never mistake a disabled send/live Screen/subscription meter for a production defect; test gateway-bound logic in unit tests or a separately authorized isolated gateway.

To verify reconnect without killing anything by name: `.venv/bin/python skills/software-development/verify-hermetic/scripts/fixture.py restart`; it restarts only its owned dashboard on the same port. Doctor and reopen a fixture chat, then check that the list and transcript return. For an update check, inspect `useLatestBuild.test.ts` and compare the served entry with the running document; don't force a reload over an unsent draft. Service workers can retain an old bundle: use a fresh fixture user-data directory between builds or inspect the loaded `assets/index-*.js` against `/m` with no-store. Live dashboard rebuilds require `npm run build` and `launchctl kickstart -k gui/$(id -u)/ai.hermes.dashboard`; check that LaunchAgent executable points at the intended checkout and `/api/health` returns 200. Never restart the gateway.

## Shadcn menus and Chats sidebar (headless only)

From `~/work/hermetic`, build private output and run `HERMETIC_OUTPUT_DIR=/absolute/output PROOF_DIR=/absolute/proof node scripts/verify-menus.cjs` with headless CDP 9222 (Playwright Core >=1.63). The harness owns only loopback workers and a real disposable Hermes HTTP/RPC home plus Kanban plugin under `~/Library/Caches`; its provider is fake, its REST/RPC mutations are real. `--before` selects the independently built baseline. Never run the Electron fixture, publish a QA release, or touch live Hermes state for this check.

Require all four 1440/390 light/dark cases in `after-result.json`: Projects nest folder chats with a bot fallback, Recents are flat/chronological, rows have one-line ellipsis with no fade or page overflow, collapse changes nested counts, menus support arrows/typeahead/Escape with focus return, and project dropdown/right-click actions match. Exercise pin/rename/remove/restore and read back archived session IDs through the real REST API. The Board Display radios/checkboxes must have 32px rows, a dedicated indicator gutter and no label overlap. A phone filter Select must be clickable above its Dialog overlay. Check profile/chat/attachment menus and bot/project pickers too. All menu content owns its themed portal; do not nest portals. Run `test/ui-primitives.test.cjs` to reject raw Radix feature imports and missing registry components, and typecheck every installed component. Spinner/unread state is covered by `ChatsPanel.test.tsx`; real physical touch, keyboard and Glass composition are not proven by a Chrome viewport.

Composer completion now uses shadcn Command: inspect `.m-suggestion-icon`, not every SVG (Command also owns a hidden check indicator). Rerun `scripts/verify-skill-mentions.cjs` after a menu change. Host/UI/CSS releases use the existing guarded update; they cannot hot-swap into an old mounted host. Never force a reload over a turn or draft.

## Evidence

Save `shot "$QA/screenshots/<feature>-390-light.png" 390 844 light` and the corresponding dark/1440 variants, plus a pass/fail table in `$QA/report.md`. Capture both the action and resulting state: title and unread before/after selection, split empty then loaded URL, attachment selected then removed, and login after sign-out. For filesystem effects, check the actual fixture folder and no change to live Hermes; for terminal verify its displayed conversation folder. Do not count DOM setters, test-only endpoints, or a screenshot alone as proof. `restart` is not a gateway-reconnect proof; report the distinction. A dry run may still use network or open a window: inspect the side effects, not the label.

## Cleanup

Run `fixture.py stop`; then check `fixture.py doctor` cannot find state, and confirm `$QA/screenshots/` plus `$QA/report.md` still exist. The fixture removes only its named `~/Library/Caches/hermetic-qa` tree; never kill by process name, erase `~/.hermes`, or delete the evidence. Do not copy the credential-bearing `fixture.json` into a report or commit.

## Feature map

See `features/README.md` for the entry points and proof standards. A pass through a convenient route is incomplete if another mapped entry point is untested.
