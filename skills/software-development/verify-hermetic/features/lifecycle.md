# Account and lifecycle

## Sub-features

Subscriptions, appearance, sign-out, new-bundle refresh, dashboard reconnect, and fixture cleanup.

## How to get to it (user POV)

Open the profile menu for Subscriptions, Settings, or Sign out. In Settings choose Light/Dark. New dashboard builds refresh when idle; after a dashboard restart the app should reconnect without losing the selected conversation.

## Driving it with verify-hermetic

Click `[aria-label="Profile menu"]` and choose the menu item named Subscriptions; `/m/subscriptions` should show either provider meters or an explicit error when the fixture has no provider connection. Choose Settings and test Appearance buttons, then capture 390/1440 light/dark screenshots. Return to a fixture chat, run `fixture.py restart`, then `doctor`: the same selected chat must display its transcript after health returns 200. Query the running `assets/index-*.js` entry and fetch `/m` with no-store to check update availability; use `useLatestBuild.test.ts` for idle/draft behavior. Finally choose Sign out from the menu; assert `/login` and a username/password form, and confirm fixture `doctor` still points at its own port. `fixture.py stop` must remove fixture state and keep `$QA/report.md`/screenshots.

## Gotchas

No real provider subscriptions or model gateway exist in the fixture; an explicit request failure is preferable to a fabricated balance. Never click OAuth consent or enter a real password. Service worker cache can keep an old bundle; a new isolated user-data directory is the clean control. The installed app and dashboard build are separate: check the LaunchAgent executable path before restarting the live dashboard, and never restart the gateway as part of this fixture. A dashboard `restart` tests HTTP reconnect, not a model gateway reconnection. When testing update behavior, keep an unsent draft and verify it is not discarded.
