# Grok AI Teammates on Luxor Agent Cloud

[Grok AI Teammates](https://github.com/code-with-antonio/ai-teammates) by [Code With Antonio](https://github.com/code-with-antonio) is an open-source chat app where every bot has a job and a Linux computer of its own: it runs shell commands, edits files, keeps notes, and drives a desktop you can watch from the chat. This example runs those computers on [Luxor Sandboxes](https://luxor.ai): one sticky sandbox per bot, its desktop streamed over noVNC on a named preview URL, paused when idle.

The upstream repository has no license file, so this example ships only replacement files and the steps to apply them to your own clone. The app's code stays in its repository.

## Set it up with a coding agent

Paste this into Claude Code, Codex, Cursor, or another coding agent:

```text
Run my clone of https://github.com/code-with-antonio/ai-teammates on Luxor sandboxes, using the "Grok AI Teammates on Luxor Agent Cloud" example from https://github.com/LuxorLabs/cookbook (examples/grok-ai-teammates-luxor).
1. Clone the cookbook next to my app, cd into examples/grok-ai-teammates-luxor, and run npm install.
2. The verify script needs a Luxor Agent Cloud API key (starts with tk_) in LUXORAI_AUTH_TOKEN. If it isn't set, stop and ask me to export it (keys come from https://app.luxor.ai). Never print the key or write it anywhere except my app's .env.local.
3. Run node verify.mjs and confirm it prints a line starting with ✓.
4. Apply the steps under "Swap it into the app" in the example's README.md to my app, then run npm run typecheck there.
5. If a step fails, use the Troubleshooting table in the README.
Then tell me which variables to add to my Trigger.dev environments.
```

## Quick start

You need:

- Node.js 20 or later.
- A Luxor Agent Cloud API key (`tk_...`) from [app.luxor.ai](https://app.luxor.ai).
- For the full app, the accounts its README lists: [Clerk](https://clerk.com) with Billing, [Neon](https://neon.com) Postgres and AI Gateway, and [Trigger.dev](https://trigger.dev). `verify.mjs` needs none of them.

### 1. Install

```bash
git clone https://github.com/LuxorLabs/cookbook.git
cd cookbook/examples/grok-ai-teammates-luxor
npm install
```

### 2. Set your API key

```bash
export LUXORAI_AUTH_TOKEN=tk_...   # LUXORAI_API_KEY also works
```

`verify.mjs` also accepts a key saved with `luxor login --api-key <key>`. `LUXORAI_WORKSPACE_ID` is optional.

### 3. Verify

```bash
node verify.mjs
```

```text
✓ grok-ai-teammates-luxor: bot sandbox → shell, files, remember/recall → desktop: keyboard, mouse, 5778-byte PNG → noVNC 200, websocket RFB 003.008 with token, 502 without → metered → pause → resume keeps file + desktop → delete
```

`verify.mjs` imports `lib/luxor.ts` and calls it the way the app does: it creates a bot sandbox, writes and lists files, appends a memory note and reads it back, starts the desktop (installing it, about a minute), types and clicks into an xterm, and checks the screenshot is a 1024-wide PNG. It then opens noVNC through the preview URL, checks the websocket reaches the VNC server with the token and is refused without it, pauses the sandbox, resumes it, and checks the file and desktop survived. It deletes the sandbox and its preview URL either way, and fails if either is left. It takes about 70 seconds.

### 4. Swap it into the app

From your clone of the app, with the cookbook cloned next to it:

```bash
EX=../cookbook/examples/grok-ai-teammates-luxor
cp $EX/lib/luxor.ts lib/
cp $EX/trigger/pause-idle.ts trigger/
mkdir -p scripts && cp $EX/build-desktop-image.mjs scripts/
rm lib/daytona.ts
perl -pi -e 's#"\@/lib/daytona"#"\@/lib/luxor"#; s#"\@daytona/sdk"#"\@/lib/luxor"#' \
  lib/sandbox-tools.ts trigger/chat.ts trigger/usage.ts actions/bot.ts actions/chat.ts
npm uninstall @daytona/sdk
npm install '@luxorai/sandbox@>=1.4.1'
npm run typecheck
```

| File | Change |
| --- | --- |
| The app's original sandbox module | Removed; `lib/luxor.ts` exports the same functions |
| `lib/sandbox-tools.ts` | Imports `Sandbox` and the helpers from `@/lib/luxor`; the tools are unchanged |
| `trigger/usage.ts`, `trigger/chat.ts`, `actions/bot.ts`, `actions/chat.ts` | Import from `@/lib/luxor` |
| `trigger/pause-idle.ts` | New: pauses bot sandboxes idle for 15 minutes |
| `scripts/build-desktop-image.mjs` | New, optional: bakes the desktop packages into an image |

In `.env.local`, replace the old sandbox provider's key with your Luxor Agent Cloud key:

```bash
LUXORAI_API_KEY=tk_...
TENKI_DESKTOP_IMAGE=   # optional, see below
```

The chat agent's tools and both scheduled tasks call Luxor Agent Cloud from Trigger.dev. `npx trigger.dev@4.7.3 dev` reads `.env.local`; before `deploy`, add the same variables to the project's production environment in Trigger.dev. Then follow the app's README from "Set up billing".

Without `TENKI_DESKTOP_IMAGE`, a bot installs the desktop packages the first time its desktop opens, which takes about a minute. To skip that, build an image once and set the variable to the ref it prints:

```bash
LUXORAI_API_KEY=tk_... node scripts/build-desktop-image.mjs
```

```text
TENKI_DESKTOP_IMAGE=<workspace>/ai-teammates-desktop@sha256:…
```

The build takes about 90 seconds. Bots created from the image start their desktop in about 2 seconds.

## How it works

| What the app does | How `lib/luxor.ts` does it |
| --- | --- |
| Create a bot's computer | `createAndWait({ sticky: true, tags: ["ai-teammates", "bot-<id>"], allowInbound: true })` |
| Start / stop it | `session.resume()` / `session.pause()` |
| Delete it | Delete the sandbox's preview URLs, then `session.close()` |
| List running computers for metering | `list({ tags: ["ai-teammates"] })`, filtered to states that hold a VM |
| Stop idle computers | `stopIdleSandboxes()` from `trigger/pause-idle.ts`, by `lastActivityAt` |
| Run a shell command | `exec(["bash", "-c", command])`, stdout and stderr combined |
| Read, write and list files | `cat`, a staged `writeFile` plus `mv`, and `find`, so any path works |
| Start the desktop | Starts Xvfb, openbox, x11vnc and websockify; installs them if missing |
| Mouse and keyboard | `xdotool` |
| Screenshot | ImageMagick `import -window root` |
| Desktop URL for the chat | A named preview URL bound to the sandbox's port 6080, plus a token |

- **Sticky, then paused.** Luxor Agent Cloud ends a sandbox after two hours unless it is sticky. A sticky sandbox runs until it is paused or deleted, so the app's own stop calls (the meter stops the sandboxes of users with no sandbox time left) and `trigger/pause-idle.ts` pause it. A paused sandbox keeps its memory and files, is not billed, and resumes in a few seconds on its bot's next tool call. Its desktop processes come back with it.
- **The desktop URL is the password.** Preview URLs are public, so websockify only lets in a connection carrying a 48-character random token. `getBotDesktopUrl()` writes a fresh token on every call and returns `wss://…/websockify?token=…`, which the app's noVNC client opens unchanged. A new call stops the old address from opening new connections; open ones stay up. The VNC server listens on localhost only.
- **Metering is unchanged.** `trigger/usage.ts` still charges each sandbox `listRunningSandboxIds()` returns for five minutes and calls `stopBotSandbox()` for owners out of hours. Creating, running, resuming and pausing sandboxes count as running.
- **Files outside `/home/tenki`.** The SDK's file API is confined to `/home/tenki`, so the file tools go through the shell and reach any path the `tenki` user can.

## Troubleshooting

| Problem | Fix |
| --- | --- |
| ``No token. Set LUXORAI_AUTH_TOKEN, or run `luxor login`.`` | `verify.mjs` found no key. Export one or run `luxor login --api-key <key>`. |
| `missing auth token - set LUXORAI_AUTH_TOKEN or LUXORAI_API_KEY` in the app or a Trigger.dev run | Add `LUXORAI_API_KEY` to `.env.local` and to the Trigger.dev environment the task runs in. |
| `The desktop did not start:` followed by apt output | The package install failed. The tail of `~/.desktop/desktop.log` in the sandbox is in the error; run it again, or build `TENKI_DESKTOP_IMAGE`. |
| The desktop panel shows "disconnected" right away | The token was replaced by a newer call, or the sandbox was paused. Reconnect: the app asks for a new URL each time. |
| `Sandbox … is TERMINATED` | The sandbox was deleted outside the app. Delete the bot and create it again. |
| `template name already exists in workspace` from `build-desktop-image.mjs` | A deleted template's name stays taken. Set `TEMPLATE_NAME` to a new name. |

## Notes

- The full app was not part of `verify.mjs`: it needs Clerk, Neon and Trigger.dev accounts and a model. `verify.mjs` covers every call the app makes into `lib/luxor.ts`.
- Screenshots carry no cursor (`showCursor` is ignored), and the desktop has openbox and xterm only. A bot can `sudo apt-get install` more; add it to `build-desktop-image.mjs` to keep it in the image.
- `lastActivityAt` moves on commands and tool calls, not on noVNC traffic, so a desktop someone is only watching pauses after 15 minutes without a tool call.
- `listRunningSandboxIds()` and `stopIdleSandboxes()` act on every sandbox tagged `ai-teammates` in the workspace. Use a separate workspace (`LUXORAI_WORKSPACE_ID`) per deployment.

## Related

- [Pause, snapshot, and resume](../snapshots-pause-resume/)
- [`@luxorai/sandbox` on npm](https://www.npmjs.com/package/@luxorai/sandbox)
