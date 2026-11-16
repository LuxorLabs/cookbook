# OpenCode

Run [OpenCode](https://opencode.ai)'s headless server in a Luxor sandbox and expose it on a password-protected public HTTPS URL. The sandbox boots with OpenCode installed and [sindresorhus/yocto-queue](https://github.com/sindresorhus/yocto-queue) cloned. One URL serves OpenCode's web UI at `/app` and its JSON API, so a person or a script can drive the agent. The sandbox and URL end when you press Ctrl-C, or after two hours.

## Set it up with a coding agent

Paste this into Claude Code, Codex, Cursor, or another coding agent:

```text
Set up the Luxor Agent Cloud "OpenCode" example from https://github.com/LuxorLabs/cookbook, which serves OpenCode's web UI from a disposable Luxor sandbox on a password-protected URL.
1. Clone the repo, cd into examples/opencode-sandbox, and run npm install (Node.js 20 or later).
2. It needs LUXORAI_AUTH_TOKEN (a Luxor Agent Cloud key starting with tk_, from https://app.luxor.ai) and OPENAI_API_KEY in the environment. If either is missing, stop and ask me to export it. Never print the keys or write them to a file.
3. Run node verify.mjs and confirm the ✓ line.
4. Start node run.mjs in the background (it stays running until Ctrl-C), then give me the /app URL, the username opencode, and the password it prints.
5. If a step fails, use the Troubleshooting table in the example's README.md.
Remind me the sandbox stops on Ctrl-C or after two hours, and stop it for me when I say I'm done.
```

## Quick start

You need:

- Node.js 20 or later.
- A Luxor Agent Cloud API key (`tk_...`) from [app.luxor.ai](https://app.luxor.ai).
- An OpenAI API key, so the agent can call a model. You don't install OpenCode locally.

### 1. Install

```bash
git clone https://github.com/LuxorLabs/cookbook.git
cd cookbook/examples/opencode-sandbox
npm install
```

### 2. Set your keys

```bash
export LUXORAI_AUTH_TOKEN=tk_...   # LUXORAI_API_KEY also works
export OPENAI_API_KEY=sk-...
```

`run.mjs` reads the Luxor Agent Cloud key from the environment only. `verify.mjs` also accepts a key saved with `luxor login --api-key <key>`. `LUXORAI_WORKSPACE_ID` is optional.

### 3. Run

```bash
node run.mjs
```

```
/home/tenki/repo (git) is live at https://<preview-host>/app
user: opencode, password: <48 hex characters>
Ctrl-C to terminate the sandbox.
```

Open the `/app` URL and sign in with username `opencode` and the printed password, which is new on every run. Press Ctrl-C to terminate the sandbox and the URL.

### 4. Verify

```bash
node verify.mjs
```

```
✓ opencode-sandbox: create + clone → opencode 1.17.20 reads OPENAI_API_KEY → serve → exposePort → 401 unauthed, 200 → /home/tenki/repo → dispose
```

`verify.mjs` checks that OpenCode is installed and lists `openai/` models when `OPENAI_API_KEY` is set (to a dummy value), that `opencode serve` answers `/project/current` for the checkout with the password, and that it returns `401` without it. It needs no real model key and doesn't load `/app` or run the agent.

## The script

`run.mjs`:

```js
// A headless OpenCode server in a disposable Luxor sandbox, reachable over HTTPS:
// boot with the agent and a repo already inside, serve, expose, then drive it from here.
import { LuxorSandbox, WaitReadyFailedError } from "@luxorai/sandbox";
import { randomBytes } from "node:crypto";

const REPO = "https://github.com/sindresorhus/yocto-queue";
const PORT = 4096;
const PASSWORD = randomBytes(24).toString("hex"); // this URL is public; see the note below

const luxor = new LuxorSandbox({ authToken: process.env.LUXORAI_AUTH_TOKEN || process.env.TENKI_AUTH_TOKEN });

// enableOpenCode bakes the CLI into the guest — nothing to npm install.
// No `await using` here: it would terminate the sandbox at the end of this scope and the
// URL below would 404 before you could open it. maxDurationMs caps it instead.
// createAndWait does not clean up after itself: a VM that is provisioned but never gets
// ready comes back as WaitReadyFailedError, half-born and billing, with its session attached.
const sandbox = await luxor.createAndWait({
  cpuCores: 2,
  memoryMb: 4096,
  enableOpenCode: true,
  allowInbound: true,
  cloneRepoUrl: REPO,
  maxDurationMs: 2 * 60 * 60_000,
  workspaceId: process.env.LUXORAI_WORKSPACE_ID || process.env.TENKI_WORKSPACE_ID,
}).catch(async (e) => {
  if (e instanceof WaitReadyFailedError) await e.session[Symbol.asyncDispose]();
  throw e;
});

// From here on a throw must dispose the sandbox, or it runs until its two-hour cap.
try {
  // --hostname 0.0.0.0 is load-bearing: the default 127.0.0.1 is unreachable from the gateway.
  // setsid + redirected stdio keeps the server running after this exec() returns.
  await sandbox.exec("sh", {
    args: ["-c", `cd repo && setsid opencode serve --port ${PORT} --hostname 0.0.0.0 >/tmp/opencode.log 2>&1 </dev/null & sleep 5`],
    // OpenCode's built-in openai provider reads OPENAI_API_KEY. (openCodeProvider.apiKey would
    // arrive as OPENCODE_API_KEY, the key for OpenCode's own hosted models, not OpenAI's.)
    // An env value of undefined arrives as an empty string, so pass the key only if you have it.
    env: {
      OPENCODE_SERVER_PASSWORD: PASSWORD,
      ...(process.env.OPENAI_API_KEY && { OPENAI_API_KEY: process.env.OPENAI_API_KEY }),
    },
  });

  const { previewUrl } = await sandbox.exposePort(PORT);
  // Auth is HTTP Basic — username opencode (OPENCODE_SERVER_USERNAME's default), the password above.
  // A Bearer token is rejected.
  const auth = { Authorization: "Basic " + Buffer.from(`opencode:${PASSWORD}`).toString("base64") };

  // The gateway can take a few seconds to route a fresh URL, so retry the first fetch.
  let project;
  for (let i = 0; i < 15 && !project; i++) {
    try {
      const res = await fetch(`${previewUrl}/project/current`, { headers: auth });
      if (res.status === 200) project = await res.json();
    } catch { /* gateway warming up */ }
    if (!project) await new Promise((r) => setTimeout(r, 2000));
  }
  if (!project) throw new Error("opencode serve never answered; see /tmp/opencode.log in the sandbox");

  console.log(`${project.worktree} (${project.vcs}) is live at ${previewUrl}/app`);
  console.log(`user: opencode, password: ${PASSWORD}\nCtrl-C to terminate the sandbox.`);
} catch (e) {
  await sandbox[Symbol.asyncDispose]();
  throw e;
}

process.on("SIGINT", async () => {
  await sandbox[Symbol.asyncDispose]();
  process.exit(0);
});
setInterval(() => {}, 1 << 30); // hold the event loop open; an unsettled await would exit 13
```

- **`enableOpenCode: true`** installs `opencode` at `/usr/local/bin/opencode` before the sandbox is ready. No custom image or `npm install`.
- **`cloneRepoUrl`** checks the repo out to `./repo`. The server starts there, so `/project/current` reports the git worktree. Change `REPO` for another public repo, or pass `githubToken` for a private one.
- **`--hostname 0.0.0.0` is required.** OpenCode defaults to `127.0.0.1`, which the gateway can't reach.
- **`OPENAI_API_KEY` goes in the `exec` env.** Don't use the SDK's `openCodeProvider.apiKey`; it arrives as `OPENCODE_API_KEY`, the key for OpenCode's own hosted models.
- **Failures clean up.** A sandbox that never becomes ready comes back as `WaitReadyFailedError` with the session attached, and the script disposes it. Any later throw disposes it too.

To drive the agent from a script, call the JSON API (`/session`, `/agent`, `/project/current`) with the same Basic auth header. OpenCode's [server docs](https://opencode.ai/docs/server) list the endpoints, and the OpenAPI spec is at `/doc`. For a one-shot run instead of a server, use `opencode run "<task>"`, as [Claude Code](../claude-code-sandbox/) and [Codex](../codex-sandbox/) do with their CLIs.

## Keep the URL locked

The URL is public, so always set `OPENCODE_SERVER_PASSWORD`. Without it, OpenCode logs `server is unsecured` and answers anyone: an open coding agent with a shell. With it, unauthenticated requests get `401`. Auth is HTTP Basic with username `opencode` (the `OPENCODE_SERVER_USERNAME` default); Bearer tokens are rejected. `verify.mjs` asserts the `401` so this can't regress unnoticed.

## Why the script stays in the foreground

`run.mjs` doesn't use `await using`, which would terminate the sandbox as soon as the script reached the end and turn the URL into a `404`. Instead:

- Ctrl-C (`SIGINT`) disposes the sandbox.
- `maxDurationMs` caps it at two hours if the process ends any other way, such as closing the terminal.
- `setInterval(() => {}, 1 << 30)` keeps the process alive. An unsettled top-level `await` would exit with code 13.

## Troubleshooting

| Problem | Fix |
| --- | --- |
| ``No token. Set LUXORAI_AUTH_TOKEN, or run `luxor login`.`` | `verify.mjs` found no key. Export one or run `luxor login --api-key <key>`. |
| `missing auth token - set LUXORAI_AUTH_TOKEN or LUXORAI_API_KEY ...` | `run.mjs` reads only the environment. Export the key. |
| `invalid auth token - API keys and service tokens must start with tk_` | Create a `tk_` key at [app.luxor.ai](https://app.luxor.ai). |
| `session <id> created but not ready within wait budget` | The sandbox was already disposed. Run again. |
| `opencode serve never answered; see /tmp/opencode.log in the sandbox` | If you changed the serve command, keep `--hostname 0.0.0.0` and `cd repo`. |
| The preview URL hangs | The server is on `127.0.0.1`. Pass `--hostname 0.0.0.0`. |
| `port 7681 cannot be exposed as a preview` | 7681 is Luxor Agent Cloud's console. Use another port. |
| The browser keeps asking for a password, or returns `401` | Use username `opencode` and this run's password. |
| The URL returns `404` | The sandbox is gone. Run `node run.mjs` again. |
| Exit code 13, `Detected unsettled top-level await` | Restore the `setInterval` at the end. |
| `opencode --version said "..."` | Keep `enableOpenCode: true` in `createAndWait`. |
| `opencode models lists no openai/ models with OPENAI_API_KEY set` | OpenCode reads a different variable now. Check its [provider docs](https://opencode.ai/docs/providers). |
| `unauthenticated request returned <n>, expected 401` | Keep `OPENCODE_SERVER_PASSWORD` in the serve `exec` env. |

The OpenCode version is whatever `enableOpenCode` installs (1.17.20 in CI).

## Related

- [Claude Code](../claude-code-sandbox/) and [Codex](../codex-sandbox/): headless coding agents that return a diff
- [Expose a port](../expose-a-port/): preview URLs on their own
- [OpenCode](https://opencode.ai) and its [server docs](https://opencode.ai/docs/server)
- [Luxor Sandbox](https://luxor.ai/products/sandbox) and the [Luxor Agent Cloud docs](https://luxor.ai/docs)
