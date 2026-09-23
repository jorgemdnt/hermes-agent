---
name: hermes-bot-session
description: Hand bot coding to a visible Desktop session.
version: 0.1.0
author: Jorge Modesto, Hermes Agent
license: MIT
platforms: [linux, macos, windows]
metadata:
  hermes:
    tags: [desktop, session, bots, handoff]
    related_skills: []
---

# Bot to Desktop session

A bot stays the short thread. Coding and investigation go to a Desktop session the person can open. `delegate_task` is invisible. `message_agent` is another bot. Neither is this pipe.

## When to Use

- A bot is about to investigate, edit, or debug.
- The person should be able to open that work in the session list.
- Don't use for a one-line answer, a route, or a message to another bot.

## Procedure

1. Write the full brief to a file. It must stand alone. The session cannot see this chat.
2. Run `terminal(command="hermes sessions handoff --title '<short title>' --prompt-file <path> --cwd <repo>")`.
3. Done when stdout is JSON with `link` and the serve token is absent.
4. When you tell the person about that session, write the `link` value exactly. Desktop turns `@session:<profile>/<id>` into a click. A bare id is not a link.
5. A follow-up is the same command with `--resume <stored_session_id>`.
6. Read the transcript from the session store. Do not redo the work in the bot chat.

## Pitfalls

- Do not scrape the Desktop serve token, and do not print it.
- Do not spawn Cursor, a headless `hermes chat -q`, or a hidden subagent and call it this pipe.
- Do not restart Hermes.app to make the row appear. `hidden` is already false.
