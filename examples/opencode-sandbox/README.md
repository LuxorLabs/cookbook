# OpenCode on Tenki (headless server on a public URL)

Boot a disposable [Tenki Sandbox](https://tenki.cloud/products/sandbox) microVM with [OpenCode](https://opencode.ai) and a Git checkout already inside it, start the agent's headless server, and expose it on a public HTTPS URL — a coding agent, and its web UI, running on a machine you can throw away. No install step: `enableOpenCode` bakes the CLI into the guest.

## The code (`run.mjs`)

```js
import { TenkiSandbox } from "@tenkicloud/sandbox";
import { randomBytes } from "node:crypto";

const REPO = "https://github.com/sindresorhus/yocto-queue";
const PORT = 4096;
const PASSWORD = randomBytes(24).toString("hex"); // this URL is public; see the note below

const tenki = new TenkiSandbox({ authToken: process.env.TENKI_AUTH_TOKEN });

// enableOpenCode bakes the CLI into the guest — nothing to npm install.
// openCodeProvider.apiKey lands in the guest as OPENCODE_API_KEY.
await using sandbox = await tenki.createAndWait({
  cpuCores: 2,
  memoryMb: 4096,
  enableOpenCode: true,
  openCodeProvider: { apiKey: process.env.OPENAI_API_KEY },
  allowInbound: true,
  cloneRepoUrl: REPO,
  workspaceId: process.env.TENKI_WORKSPACE_ID,
});

// --hostname 0.0.0.0 is load-bearing: the default 127.0.0.1 is unreachable from the gateway.
// setsid + redirected stdio keeps the server running after this exec() returns.
await sandbox.exec("sh", {
  args: ["-c", `cd repo && setsid opencode serve --port ${PORT} --hostname 0.0.0.0 >/tmp/opencode.log 2>&1 </dev/null & sleep 5`],
  env: { OPENCODE_SERVER_PASSWORD: PASSWORD },
});

const { previewUrl } = await sandbox.exposePort(PORT);
// Auth is HTTP Basic — any username, the password above. A Bearer token is rejected.
const auth = { Authorization: "Basic " + Buffer.from(`opencode:${PASSWORD}`).toString("base64") };

const project = await (await fetch(`${previewUrl}/project/current`, { headers: auth })).json();
console.log(`${project.worktree} (${project.vcs}) is live at ${previewUrl}/app`);
```

Open the printed `/app` URL in a browser and you are looking at OpenCode's own UI, driving a repo inside the microVM. The same URL serves the JSON API — `/session`, `/agent`, `/project/current` — so a script can drive it just as easily.

## Run it

```bash
npm install
export TENKI_AUTH_TOKEN=...      # from `tenki login` (~/.config/tenki/config.yaml)
export TENKI_WORKSPACE_ID=...
export OPENAI_API_KEY=sk-...     # or any provider OpenCode supports, via openCodeProvider
node run.mjs                     # -> /home/tenki/repo (git) is live at https://....sb.tenki.sh/app
```

`run.mjs` uses top-level `await using`, which needs Node 24+.

Verify the Tenki half without a model key — this is what CI runs:

```bash
node verify.mjs   # boot → serve → exposePort → assert 401 unauthed, then 200 + the checkout
```

## Notes

- **Set `OPENCODE_SERVER_PASSWORD`, always.** Without it the server logs `OPENCODE_SERVER_PASSWORD is not set; server is unsecured` and answers every caller — and `exposePort` has just put it on the public internet, so that is an open coding agent with a shell. With it set, unauthenticated requests get `401`. Auth is HTTP **Basic** (any username, that password); a `Bearer` token is rejected. `verify.mjs` asserts the `401` precisely so this cannot regress unnoticed.
- **Port 7681 is spoken for.** Tenki's own `ttyd` console listens there, and `exposePort(7681)` fails with `[invalid_argument] port 7681 cannot be exposed as a preview`. Pick any other port for your server.
- **`--hostname 0.0.0.0` is required.** `opencode serve` defaults to `127.0.0.1`, which the gateway cannot reach, so the preview URL would just hang.
- `enableOpenCode: true` puts `opencode` (1.17.20 at the time of writing) at `/usr/local/bin/opencode` before the sandbox reports ready — no `npm install`, no custom image. `openCodeProvider.apiKey` and `.baseUrl` arrive in the guest as `OPENCODE_API_KEY` and `OPENCODE_PROVIDER_BASE_URL`.
- `cloneRepoUrl` checks out to `./repo`, so the server is started with `cd repo` — that is what makes `/project/current` report `worktree: /home/tenki/repo` with `vcs: git` instead of an empty directory.
- For the same agent driven as a one-shot CLI instead of a server, `opencode run "<task>"` works too — the shape used by [claude-code-sandbox](../claude-code-sandbox/) and [codex-sandbox](../codex-sandbox/).
