# Grok AI Teammates on Tenki

[Grok AI Teammates](https://github.com/code-with-antonio/ai-teammates) by [Code With Antonio](https://github.com/code-with-antonio) is an open-source chat app where every bot has a job and a Linux computer of its own: it runs shell commands, edits files, keeps notes, and drives a desktop you can watch from the chat. The app runs those computers on Daytona. This example swaps in [Tenki Sandboxes](https://tenki.cloud): one sticky sandbox per bot, its desktop streamed over noVNC on a named preview URL, paused when idle.

The upstream repository has no license file, so this example ships only replacement files and the steps to apply them to your own clone. The app's code stays in its repository.

## Set it up with a coding agent

Paste this into Claude Code, Codex, Cursor, or another coding agent:

```text
Move my clone of https://github.com/code-with-antonio/ai-teammates from Daytona to Tenki, using the "Grok AI Teammates on Tenki" example from https://github.com/LuxorLabs/cookbook (examples/grok-ai-teammates-tenki).
1. Clone the cookbook next to my app, cd into examples/grok-ai-teammates-tenki, and run npm install.
2. The verify script needs a Tenki API key (starts with tk_) in TENKI_AUTH_TOKEN. If it isn't set, stop and ask me to export it (keys come from https://app.tenki.cloud). Never print the key or write it anywhere except my app's .env.local.
3. Run node verify.mjs and confirm it prints a line starting with ✓.
4. Apply the steps under "Swap it into the app" in the example's README.md to my app, then run npm run typecheck there.
5. If a step fails, use the Troubleshooting table in the README.
Then tell me which variables to add to my Trigger.dev environments.
```

## Quick start

You need:

- Node.js 20 or later.
- A Tenki API key (`tk_...`) from [app.tenki.cloud](https://app.tenki.cloud).
- For the full app, the accounts its README lists: [Clerk](https://clerk.com) with Billing, [Neon](https://neon.com) Postgres and AI Gateway, and [Trigger.dev](https://trigger.dev). `verify.mjs` needs none of them.

### 1. Install

```bash
git clone https://github.com/LuxorLabs/cookbook.git
cd cookbook/examples/grok-ai-teammates-tenki
npm install
```

### 2. Set your API key

```bash
export TENKI_AUTH_TOKEN=tk_...   # TENKI_API_KEY also works
```

`verify.mjs` also accepts a key saved with `tenki login --api-key <key>`. `TENKI_WORKSPACE_ID` is optional.

### 3. Verify

```bash
node verify.mjs
```

```text
✓ grok-ai-teammates-tenki: bot sandbox → shell, files, remember/recall → desktop: keyboard, mouse, 5778-byte PNG → noVNC 200, websocket RFB 003.008 with token, 502 without → metered → pause → resume keeps file + desktop → delete
```

`verify.mjs` imports `lib/tenki.ts` and calls it the way the app does: it creates a bot sandbox, writes and lists files, appends a memory note and reads it back, starts the desktop (installing it, about a minute), types and clicks into an xterm, and checks the screenshot is a 1024-wide PNG. It then opens noVNC through the preview URL, checks the websocket reaches the VNC server with the token and is refused without it, pauses the sandbox, resumes it, and checks the file and desktop survived. It deletes the sandbox and its preview URL either way, and fails if either is left. It takes about 70 seconds.

### 4. Swap it into the app

From your clone of the app, with the cookbook cloned next to it:

```bash
EX=../cookbook/examples/grok-ai-teammates-tenki
cp $EX/lib/tenki.ts lib/
cp $EX/trigger/pause-idle.ts trigger/
mkdir -p scripts && cp $EX/build-desktop-image.mjs scripts/
rm lib/daytona.ts
perl -pi -e 's#"\@/lib/daytona"#"\@/lib/tenki"#; s#"\@daytona/sdk"#"\@/lib/tenki"#' \
  lib/sandbox-tools.ts trigger/chat.ts trigger/usage.ts actions/bot.ts actions/chat.ts
npm uninstall @daytona/sdk
npm install '@tenkicloud/sandbox@>=1.4.1'
npm run typecheck
```

| File | Change |
| --- | --- |
| `lib/daytona.ts` | Removed; `lib/tenki.ts` exports the same functions |
| `lib/sandbox-tools.ts` | Imports `Sandbox` and the helpers from `@/lib/tenki`; the tools are unchanged |
| `trigger/usage.ts`, `trigger/chat.ts`, `actions/bot.ts`, `actions/chat.ts` | Import from `@/lib/tenki` |
| `trigger/pause-idle.ts` | New: pauses bot sandboxes idle for 15 minutes |
| `scripts/build-desktop-image.mjs` | New, optional: bakes the desktop packages into an image |

In `.env.local`, replace `DAYTONA_API_KEY` with your Tenki key:

```bash
TENKI_API_KEY=tk_...
TENKI_DESKTOP_IMAGE=   # optional, see below
```

The chat agent's tools and both scheduled tasks call Tenki from Trigger.dev. `npx trigger.dev@4.7.3 dev` reads `.env.local`; before `deploy`, add the same variables to the project's production environment in Trigger.dev, where the app's README lists `DAYTONA_API_KEY`. Then follow the app's README from "Set up billing".

Without `TENKI_DESKTOP_IMAGE`, a bot installs the desktop packages the first time its desktop opens, which takes about a minute. To skip that, build an image once and set the variable to the ref it prints:

```bash
TENKI_API_KEY=tk_... node scripts/build-desktop-image.mjs
```

```text
TENKI_DESKTOP_IMAGE=<workspace>/ai-teammates-desktop@sha256:…
```

The build takes about 90 seconds. Bots created from the image start their desktop in about 2 seconds.

## How it works

| Daytona call in `lib/daytona.ts` | Tenki in `lib/tenki.ts` |
| --- | --- |
| `daytona.create({ labels: { botId } })` | `createAndWait({ sticky: true, tags: ["ai-teammates", "bot-<id>"], allowInbound: true })` |
| `sandbox.start()` on a stopped sandbox | `session.resume()` on a paused one |
| `sandbox.stop()` | `session.pause()` |
| `daytona.delete()` | Delete the sandbox's preview URLs, then `session.close()` |
| `daytona.list({ states: ["started", …] })` | `list({ tags: ["ai-teammates"] })`, filtered to states that hold a VM |
| Auto-stop after 15 idle minutes | `stopIdleSandboxes()` from `trigger/pause-idle.ts`, by `lastActivityAt` |
| `process.executeCommand` | `exec(["bash", "-c", command])`, stdout and stderr combined |
| `fs.downloadFile` / `uploadFile` / `listFiles` | `cat`, a staged `writeFile` plus `mv`, and `find`, so any path works |
| `computerUse.start()` | Starts Xvfb, openbox, x11vnc and websockify; installs them if missing |
| `computerUse.mouse.*`, `keyboard.*` | `xdotool` |
| `computerUse.screenshot.takeCompressed` | ImageMagick `import -window root` |
| `getSignedPreviewUrl(6080, 3600)` | A named preview URL bound to the sandbox's port 6080, plus a token |

- **Sticky, then paused.** Tenki ends a sandbox after two hours unless it is sticky. A sticky sandbox runs until it is paused or deleted, so the app's own stop calls (the meter stops the sandboxes of users with no sandbox time left) and `trigger/pause-idle.ts` pause it. A paused sandbox keeps its memory and files, is not billed, and resumes in a few seconds on its bot's next tool call. Its desktop processes come back with it.
- **The desktop URL is the password.** Preview URLs are public, so websockify only lets in a connection carrying a 48-character random token. `getBotDesktopUrl()` writes a fresh token on every call and returns `wss://…/websockify?token=…`, which the app's noVNC client opens unchanged. A new call stops the old address from opening new connections; open ones stay up. The VNC server listens on localhost only.
- **Metering is unchanged.** `trigger/usage.ts` still charges each sandbox `listRunningSandboxIds()` returns for five minutes and calls `stopBotSandbox()` for owners out of hours. Creating, running, resuming and pausing sandboxes count as running.
- **Files outside `/home/tenki`.** The SDK's file API is confined to `/home/tenki`, so the file tools go through the shell and reach any path the `tenki` user can.

## Troubleshooting

| Problem | Fix |
| --- | --- |
| ``No token. Set TENKI_AUTH_TOKEN, or run `tenki login`.`` | `verify.mjs` found no key. Export one or run `tenki login --api-key <key>`. |
| `missing auth token - set TENKI_AUTH_TOKEN or TENKI_API_KEY` in the app or a Trigger.dev run | Add `TENKI_API_KEY` to `.env.local` and to the Trigger.dev environment the task runs in. |
| `The desktop did not start:` followed by apt output | The package install failed. The tail of `~/.desktop/desktop.log` in the sandbox is in the error; run it again, or build `TENKI_DESKTOP_IMAGE`. |
| The desktop panel shows "disconnected" right away | The token was replaced by a newer call, or the sandbox was paused. Reconnect: the app asks for a new URL each time. |
| `Sandbox … is TERMINATED` | The sandbox was deleted outside the app. Delete the bot and create it again. |
| `template name already exists in workspace` from `build-desktop-image.mjs` | A deleted template's name stays taken. Set `TEMPLATE_NAME` to a new name. |

## Notes

- The full app was not part of `verify.mjs`: it needs Clerk, Neon and Trigger.dev accounts and a model. `verify.mjs` covers every call the app makes into `lib/tenki.ts`.
- Screenshots carry no cursor (`showCursor` is ignored), and the desktop has openbox and xterm only. A bot can `sudo apt-get install` more; add it to `build-desktop-image.mjs` to keep it in the image.
- `lastActivityAt` moves on commands and tool calls, not on noVNC traffic, so a desktop someone is only watching pauses after 15 minutes without a tool call.
- `listRunningSandboxIds()` and `stopIdleSandboxes()` act on every sandbox tagged `ai-teammates` in the workspace. Use a separate workspace (`TENKI_WORKSPACE_ID`) per deployment.

## Related

- [Trigger.dev](../trigger-dev-tenki/): run code in a Tenki sandbox from a Trigger.dev task
- [Daytona to Tenki](../daytona-to-tenki-migration/)
- [Pause, snapshot, and resume](../snapshots-pause-resume/)
- [`@tenkicloud/sandbox` on npm](https://www.npmjs.com/package/@tenkicloud/sandbox)
