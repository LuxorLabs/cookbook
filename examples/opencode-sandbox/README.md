# How to run OpenCode's web UI on a public URL from a disposable sandbox

**Audience:** developers who use the [OpenCode](https://opencode.ai) coding agent, or want to try it, and would rather point a browser at it on a throwaway machine than run it on their own. You need Node and a terminal.
**Time:** ~5 minutes. In CI, `npm install` takes under a second and `node verify.mjs` about 70 seconds. `run.mjs` boots the same way, then stays up until you press Ctrl-C.
**Outcome:** a password-protected public HTTPS URL that serves OpenCode's web UI and JSON API, working on a checkout of [sindresorhus/yocto-queue](https://github.com/sindresorhus/yocto-queue) inside a [Tenki Sandbox](https://tenki.cloud/products/sandbox) microVM. The sandbox and the URL end when you press Ctrl-C, or after two hours at the latest.

> **Honesty note:** neither script sends OpenCode a prompt, and CI runs only `verify.mjs`, with no model key. The server, the URL, the password, and OpenCode picking up `OPENAI_API_KEY` are tested. The agent reaching a model with your key is not.

## Why bother

`opencode serve` gives whoever reaches it an agent with a shell. Here that shell is in a Tenki microVM that exists only for this run, with the repo already cloned. There is no install step: `enableOpenCode` bakes the CLI into the guest. The script starts the headless server and exposes it on a public HTTPS URL, and that one URL serves both OpenCode's own UI at `/app` and its JSON API, so a person or a script can drive the agent.

## Install

```bash
git clone https://github.com/LuxorLabs/cookbook.git
cd cookbook/examples/opencode-sandbox
npm install
```

Every later command runs from this directory. The only dependency is `@tenkicloud/sandbox` 1.4.1 or later. You don't install OpenCode on your machine. Use Node 20 or later: CI runs `verify.mjs` on Node 20, and neither script uses `await using`, so neither needs Node 24.

## Authenticate

You need a Tenki API key, which starts with `tk_`. Create one at https://app.tenki.cloud.

```bash
export TENKI_AUTH_TOKEN=tk_...   # or TENKI_API_KEY, which is what CI sets
export OPENAI_API_KEY=sk-...     # only run.mjs reads this
```

- `run.mjs` passes `TENKI_AUTH_TOKEN` to the SDK, and the SDK falls back to `TENKI_API_KEY` when that's unset. It does not read `~/.config/tenki/config.yaml`, so export one of the two even if you've run `tenki login`.
- `verify.mjs` also accepts a key stored by `tenki login --api-key <key>` in `~/.config/tenki/config.yaml`.
- `TENKI_WORKSPACE_ID` is optional. Tenki infers the workspace from a workspace API key, and both scripts pass it through if you set it.
- `run.mjs` puts `OPENAI_API_KEY` in the environment of the one `exec` that starts `opencode serve`, where OpenCode's built-in openai provider reads it. Don't pass an OpenAI key as the SDK's `openCodeProvider.apiKey`: that arrives in the guest as `OPENCODE_API_KEY`, which OpenCode reads as the key for its own hosted models.

## Use it

```bash
node run.mjs
```

When the server answers, the script prints three lines and stays in the foreground:

```
/home/tenki/repo (git) is live at https://<preview-host>/app
user: opencode, password: <48 hex characters>
Ctrl-C to terminate the sandbox.
```

Open the `/app` URL in a browser and you are looking at OpenCode's own UI, driving the repo inside the microVM. The browser asks for a username and password: enter the printed username, **`opencode`**, and the printed password. OpenCode checks both. The username must match `OPENCODE_SERVER_USERNAME`, which defaults to `opencode`, and neither script sets it. The password is new on every run.

Press Ctrl-C to terminate the sandbox, and the URL with it.

This is the whole of `run.mjs`:

```js
// A headless OpenCode server in a disposable Tenki sandbox, reachable over HTTPS:
// boot with the agent and a repo already inside, serve, expose, then drive it from here.
import { TenkiSandbox, WaitReadyFailedError } from "@tenkicloud/sandbox";
import { randomBytes } from "node:crypto";

const REPO = "https://github.com/sindresorhus/yocto-queue";
const PORT = 4096;
const PASSWORD = randomBytes(24).toString("hex"); // this URL is public; see the note below

const tenki = new TenkiSandbox({ authToken: process.env.TENKI_AUTH_TOKEN });

// enableOpenCode bakes the CLI into the guest — nothing to npm install.
// No `await using` here: it would terminate the sandbox at the end of this scope and the
// URL below would 404 before you could open it. maxDurationMs caps it instead.
// createAndWait does not clean up after itself: a VM that is provisioned but never gets
// ready comes back as WaitReadyFailedError, half-born and billing, with its session attached.
const sandbox = await tenki.createAndWait({
  cpuCores: 2,
  memoryMb: 4096,
  enableOpenCode: true,
  allowInbound: true,
  cloneRepoUrl: REPO,
  maxDurationMs: 2 * 60 * 60_000,
  workspaceId: process.env.TENKI_WORKSPACE_ID,
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

What each part is doing:

- `enableOpenCode: true` puts `opencode` at `/usr/local/bin/opencode` before the sandbox reports ready. There is no `npm install` and no custom image.
- `cloneRepoUrl` checks the repo out to `./repo`, so the server is started with `cd repo`. That is what makes `/project/current` report `worktree: /home/tenki/repo` with `vcs: git` instead of an empty directory. To work on another public repo, change `REPO`.
- The `.catch` on `createAndWait` handles a sandbox that was provisioned but never became ready. `createAndWait` doesn't clean that up itself: it throws `WaitReadyFailedError` with the half-created sandbox, which is still billing, attached as `e.session`, and the script disposes it.
- The `try`/`catch` after it disposes the sandbox if anything later throws. Without it, a failed run would leave the sandbox up until its two-hour cap.
- `exec("sh", { args: ["-c", …] })` is there because `exec` runs a binary with no shell, and starting the server needs `cd`, `&&` and redirects. `setsid` plus redirected stdio keeps the server running after this `exec()` returns, and `sleep 5` gives it a moment to start.
- `--hostname 0.0.0.0` is required. `opencode serve` defaults to `127.0.0.1`, which the Tenki gateway can't reach, so the preview URL would hang.
- `exposePort(PORT)` returns the public `previewUrl`. Any port works except 7681 (see Troubleshooting).
- The fetch loop retries `/project/current` 15 times, 2 seconds apart, because the gateway can take a few seconds to route a fresh URL.

The same URL also serves OpenCode's JSON API (`/session`, `/agent`, `/project/current`), so a script can drive the agent with the same Basic auth header the fetch loop uses.

## Keep the public URL locked

`exposePort` puts the server on the public internet, so set `OPENCODE_SERVER_PASSWORD`, always.

- Without it, the server logs `OPENCODE_SERVER_PASSWORD is not set; server is unsecured` and answers every caller. Behind a public URL, that is an open coding agent with a shell.
- With it set, unauthenticated requests get `401`. `run.mjs` generates a fresh random password on every run and passes it through `ExecOptions.env` to the one `exec` that starts `opencode serve`.
- Auth is HTTP **Basic**, with username `opencode` and that password. A `Bearer` token is rejected.
- `verify.mjs` asserts the `401` precisely so that losing the password can't regress unnoticed.

## Why the script stays in the foreground

**This example deliberately does not use `await using`.** It would terminate the sandbox at the end of the script's scope, and the URL the script printed would return `404` before you could open it. The sandbox has to outlive that point, so:

- the script disposes the sandbox on `SIGINT`, which is what Ctrl-C sends;
- `maxDurationMs: 2 * 60 * 60_000` caps the sandbox at two hours, so a forgotten sandbox still terminates itself;
- `setInterval(() => {}, 1 << 30)` holds the process open. It needs a ref'd handle like this one: an unsettled top-level `await` makes Node exit with code 13 and `Detected unsettled top-level await`.

Only Ctrl-C disposes the sandbox. If the process ends some other way, for example you close the terminal, the sandbox and its URL keep running, still behind the password, until the two-hour cap.

## Check it works

`verify.mjs` checks the Tenki half without a model key. This is what CI runs.

```bash
node verify.mjs
```

It prints:

```
✓ opencode-sandbox: create + clone → opencode 1.17.20 reads OPENAI_API_KEY → serve → exposePort → 401 unauthed, 200 → /home/tenki/repo → dispose
```

The version in the middle is whichever OpenCode `enableOpenCode` baked into the sandbox; CI saw 1.17.20. The check proves that the sandbox boots with `opencode` already installed and yocto-queue cloned into `./repo`, that OpenCode lists its `openai/` models when `OPENAI_API_KEY` holds a (dummy) key, that `opencode serve` starts on `0.0.0.0`, that the preview URL serves `/project/current` for that checkout with the password, and that it returns `401` without it. It doesn't load the `/app` UI, and with no model key it doesn't run the agent.

## Troubleshooting

**❌ ``No token. Set TENKI_AUTH_TOKEN, or run `tenki login`.``** `verify.mjs` found no key in `TENKI_AUTH_TOKEN`, `TENKI_API_KEY` or `~/.config/tenki/config.yaml`. Export `TENKI_AUTH_TOKEN`, or run `tenki login --api-key <key>`.

**❌ `missing auth token - set TENKI_AUTH_TOKEN or TENKI_API_KEY or use authToken option`.** `run.mjs` doesn't read `~/.config/tenki/config.yaml`, so a key stored by `tenki login` isn't enough for it. Export `TENKI_AUTH_TOKEN` or `TENKI_API_KEY`.

**❌ `invalid auth token - API keys and service tokens must start with tk_`.** The SDK accepts only `tk_` keys. Create an API key at https://app.tenki.cloud and export that.

**❌ `session <id> created but not ready within wait budget`.** The sandbox was created but didn't become ready in time, and `createAndWait` threw `WaitReadyFailedError`. Both scripts dispose that sandbox before rethrowing, so nothing is left running. Run the script again.

**❌ `opencode serve never answered; see /tmp/opencode.log in the sandbox`.** `/project/current` didn't return `200` in 15 tries 2 seconds apart. `run.mjs` disposes the sandbox when it throws, so the log goes with it. If you changed the serve command, check that it still passes `--hostname 0.0.0.0` and starts from `repo`.

**❌ The preview URL hangs.** The server is listening on `127.0.0.1`, OpenCode's default, which the gateway can't reach. Pass `--hostname 0.0.0.0`, as both scripts do.

**❌ `[invalid_argument] port 7681 cannot be exposed as a preview`.** Tenki's own `ttyd` console listens on port 7681. Pick any other port for your server; the scripts use 4096.

**❌ The browser keeps asking for the password.** OpenCode checks the username as well as the password. Use `opencode` as the username, whatever `run.mjs` prints, and the password from this run; each run makes a new one.

**❌ The URL returns `404`.** The sandbox is gone: you pressed Ctrl-C, the script threw, it reached the two-hour cap, or you added `await using`. Run `node run.mjs` again for a new sandbox, URL and password.

**❌ `node run.mjs` exits with code 13 and `Detected unsettled top-level await`.** You replaced the `setInterval` at the end with an `await` that never settles. Put the `setInterval` back.

**❌ `opencode --version said "..."`.** `opencode --version` in the sandbox didn't print a plain `x.y.z` version: either the CLI isn't there, or it printed something else, which the message shows. Check that `enableOpenCode: true` is still in the `createAndWait` options.

**❌ `opencode models lists no openai/ models with OPENAI_API_KEY set`.** The OpenCode in the sandbox no longer reads `OPENAI_API_KEY` for its openai provider. Find the variable it reads now in OpenCode's [provider docs](https://opencode.ai/docs/providers) and update the `env` of the `exec` that starts `opencode serve`.

**❌ `401` in the browser with the right password.** The username is wrong. Enter `opencode`, not any other name.

**❌ `unauthenticated request returned <n>, expected 401`.** The server answered a request with no password, so it isn't protected. Check that `OPENCODE_SERVER_PASSWORD` is still in the `env` of the `exec` that starts `opencode serve`.

## FAQ

**When shouldn't I use this?** When the server must not be reachable from the internet at all: the URL is public and only the password stands in front of it. When you need CI to prove the agent works with your model key: it proves the Tenki side only (see the honesty note). When you need a pinned OpenCode version: you get whichever version `enableOpenCode` bakes in, and `verify.mjs` only checks that `opencode --version` prints `x.y.z`. And when the session must run unattended or longer than two hours: the script has to stay in the foreground, and `maxDurationMs` ends the sandbox at two hours.

**Can a script drive the agent instead of a browser?** Yes. The URL serves OpenCode's JSON API, and every request needs the same `Authorization: Basic` header that `run.mjs` builds. OpenCode's [server docs](https://opencode.ai/docs/server) list the endpoints and say the server publishes its OpenAPI spec at `/doc`.

**Can I use my own repository?** Change `REPO` at the top of `run.mjs`. `cloneRepoUrl` checks it out to `./repo` either way. For a private repo, `createAndWait` also takes a `githubToken` option, which this example doesn't use.

**Can I run the agent once instead of as a server?** Yes. `opencode run "<task>"` works too. That's the one-shot shape [claude-code-sandbox](../claude-code-sandbox/) and [codex-sandbox](../codex-sandbox/) use for their agents.

## Related

- [OpenCode](https://opencode.ai) and its [server docs](https://opencode.ai/docs/server)
- [Tenki Sandbox](https://tenki.cloud/products/sandbox), the [Tenki docs](https://tenki.cloud/docs), and the SDK: [`@tenkicloud/sandbox` on npm](https://www.npmjs.com/package/@tenkicloud/sandbox)
- [expose-a-port](../expose-a-port/): the `exposePort` preview URL on its own, with a plain HTTP server
- [codex-sandbox](../codex-sandbox/): a coding agent run headless on the same repo, returning a diff
