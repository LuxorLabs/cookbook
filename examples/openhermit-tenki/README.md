# How to run OpenHermit agents on Tenki sandboxes

**Audience:** operators who run an OpenHermit gateway, or are setting one up, and want each agent's shell and workspace in its own Tenki sandbox instead of a Docker container managed by the gateway.
**Time:** ~5 minutes for the Tenki check in this folder. In CI, its `npm install` and live run take about 15 seconds. Running an agent through OpenHermit comes on top: a source checkout and its `npm install`, plus a PostgreSQL database for the setup wizard.
**Outcome:** `node verify.mjs` prints a `✓` line from a live Tenki sandbox, and an OpenHermit agent runs its shell commands, file tools and skill syncs in its own sticky Tenki sandbox that survives gateway restarts.

> **Honesty note:** OpenHermit's latest npm release (`0.10.0`) does not include the Tenki backend, which merged after it. Since [openhermit#313](https://github.com/HCF-STUDIOS/openhermit/pull/313), the backend also needs `@tenkicloud/sandbox` 1.4 or newer. Until the next release ships, you run OpenHermit from a source checkout (Step 5). This folder doesn't contain OpenHermit: `verify.mjs` runs the Tenki SDK calls the backend is built on, so it tells you your key and the Tenki side work, not that your gateway does.

[OpenHermit](https://github.com/HCF-STUDIOS/openhermit) deploys fleets of AI agents as production services. A gateway holds durable state in PostgreSQL, and each agent gets a **sandbox** for its shell and workspace files. Since [openhermit#239](https://github.com/HCF-STUDIOS/openhermit/pull/239), `tenki` is a first-class sandbox type alongside `host`, `docker`, `e2b` and `daytona`: each agent's workspace becomes one sticky [Tenki](https://tenki.cloud) sandbox that survives gateway restarts.

## Prerequisites

- A Tenki `tk_` API key. Create one at https://app.tenki.cloud.
- Node.js 20 or newer. The check runs on Node 20 in CI, and OpenHermit's `engines` field asks for `>=20`.
- For OpenHermit itself: git, and either a PostgreSQL server or Docker. The setup wizard asks for a `DATABASE_URL`, or offers to start a local PostgreSQL (`postgres:16-alpine`) with Docker.
- For the agent's model: an OpenRouter API key. New OpenHermit agents default to OpenRouter's `google/gemini-3-flash-preview`. `verify.mjs` doesn't need a model key.

## Step 1 — Get the example

```bash
git clone https://github.com/LuxorLabs/cookbook.git
cd cookbook/examples/openhermit-tenki
```

Steps 2 to 4 run from this directory. Steps 5 to 8 run in an OpenHermit checkout.

## Step 2 — Install

```bash
npm install
```

The only dependency in `package.json` is the Tenki SDK:

```json
  "dependencies": {
    "@tenkicloud/sandbox": ">=1.4.1"
  }
```

## Step 3 — Authenticate

```bash
export TENKI_API_KEY=tk_...
```

Or store the key once with `tenki login --api-key <key>`, which writes it to `~/.config/tenki/config.yaml`. `verify.mjs` uses the first key it finds in `TENKI_AUTH_TOKEN`, then `TENKI_API_KEY`, then that file.

You don't need a workspace ID: Tenki infers the workspace from a workspace API key. Set `TENKI_WORKSPACE_ID` only to pin the check to one workspace.

This step covers the check only. The OpenHermit gateway reads its key from its own environment file, in Step 6.

## Step 4 — Check the Tenki side works

```bash
node verify.mjs
```

No gateway or database needed. On success it prints:

```
✓ openhermit-tenki: sticky session → sh -c exec with env (hermit 42) → timeout keeps partial output → skill file sync → reattach by id → dispose
```

[`verify.mjs`](verify.mjs) runs the exact Tenki SDK calls the backend is built on, against the live API. It boots a sticky session and runs an `sh -c` command with an environment variable passed through, the way the backend runs every agent command:

```js
const client = new TenkiSandbox({ authToken });
const text = (bytes) => new TextDecoder().decode(bytes);
let session;
try {
  // 1) boot a sticky session, as the backend's ensure() does
  session = await client.createAndWait({
    cpuCores: 1,
    memoryMb: 1024,
    sticky: true,
    metadata: { agentId: "cookbook-openhermit-verify" },
    workspaceId,
  });

  // 2) exec the way TenkiExecBackend.exec() does: sh -c, cwd agent_home, env passed
  //    through, timeout_ms handed to the SDK's guest-enforced timeout
  const r1 = await session.run(["sh", "-c", 'echo "$GREETING $(python3 -c "print(6*7)")"'], {
    cwd: "/home/tenki",
    env: { GREETING: "hermit" },
    timeoutMs: 300_000,
  });
  if (!(r1.exitCode === 0 && !r1.timedOut && text(r1.stdout).trim() === "hermit 42")) {
    throw new Error(`exec: exit ${r1.exitCode}, stdout ${JSON.stringify(text(r1.stdout))}, stderr ${JSON.stringify(text(r1.stderr))}`);
  }
```

It then runs a command that times out after 3 seconds and checks that its partial output is kept, and round-trips a skill file with `mkdir` and `writeFile`. Last, it **reattaches by session id**, which is what the gateway does after a restart, and reads the skill file back from the reattached session:

```js
  // 4) reattach by id — what the gateway does after a restart (readySession: resume if
  //    paused, wait until RUNNING)
  const again = await client.get(session.id);
  if (again.state === "PAUSED") await again.resume();
  if (again.state !== "RUNNING") await again.waitReady(180_000);
  const r2 = await again.run(["sh", "-c", "cat skills/demo.md"], { cwd: "/home/tenki" });
  if (!text(r2.stdout).includes("demo skill")) throw new Error("reattached session lost workspace state");
```

A `finally` block then disposes the session, even when a check fails.

This proves your key works and that the Tenki behaviors the backend relies on hold against the live API. It doesn't start a gateway, touch PostgreSQL or call a model, so it doesn't test your OpenHermit deployment. The backend's internals (state rows, the skill dirty flag) are covered by OpenHermit's own test suite: [`apps/agent/test/tenki-backend.test.ts`](https://github.com/HCF-STUDIOS/openhermit/blob/main/apps/agent/test/tenki-backend.test.ts) for the backend, and [`apps/agent/test/skill-pending-sync.test.ts`](https://github.com/HCF-STUDIOS/openhermit/blob/main/apps/agent/test/skill-pending-sync.test.ts) for the skill dirty flag.

## Step 5 — Get OpenHermit from source

```bash
cd ~    # anywhere outside the cookbook clone
git clone https://github.com/HCF-STUDIOS/openhermit && cd openhermit && npm install
```

Clone it outside the cookbook clone, so it doesn't end up nested inside `examples/openhermit-tenki`. Steps 6 to 8 run from this checkout. They use `npm run dev:cli --`, which runs the `hermit` CLI from source, as the repo's Development section describes. Once a release after `0.10.0` includes the Tenki backend, you can `npm install -g openhermit` instead and type `hermit` wherever these steps say `npm run dev:cli --`.

The checkout already depends on the Tenki SDK (`^1.4.0` in `apps/agent/package.json`), so there's nothing extra to install. It loads only when an agent uses the `tenki` backend.

## Step 6 — Set up the gateway with your Tenki key

```bash
npm run dev:cli -- setup                            # DATABASE_URL, tokens

echo 'TENKI_API_KEY=tk_...' >> ~/.openhermit/gateway/.env
npm run dev:cli -- gateway start
```

`setup` is an interactive wizard. It writes `DATABASE_URL`, the gateway's admin token and its secrets to `~/.openhermit/gateway/.env`.

The agent runtime needs `TENKI_API_KEY` (or `TENKI_AUTH_TOKEN`) in the **gateway's** environment, `~/.openhermit/gateway/.env`, not per agent. The gateway loads that file when it starts, so add the key before `gateway start`, or restart the gateway after you add it. The gateway doesn't read `~/.config/tenki/config.yaml`, so `tenki login` alone isn't enough here.

## Step 7 — Put an agent on Tenki

```bash
npm run dev:cli -- agents create main --no-sandbox  # skip the default Docker sandbox
npm run dev:cli -- sandbox add --agent main --type tenki \
  --config '{"timeout_ms": 300000}'
npm run dev:cli -- config secrets set OPENROUTER_API_KEY sk-... --agent main
npm run dev:cli -- agents start main
npm run dev:cli -- chat --agent main                # the agent's shell now runs on Tenki
```

**The agent needs a model key.** `setup` doesn't configure a model provider, and a new agent defaults to OpenRouter's `google/gemini-3-flash-preview`, so without `OPENROUTER_API_KEY` it can't run a turn and never reaches the sandbox. The `config secrets set` line stores the key as a per-agent secret. You can put `OPENROUTER_API_KEY` in `~/.openhermit/gateway/.env` next to `TENKI_API_KEY` instead, before `gateway start`. To use another provider, set `model.provider` and `model.model` with `config set`, as OpenHermit's README shows.

**`--no-sandbox` matters.** Without it, `agents create` auto-provisions the gateway's default sandbox preset (Docker), and the Tenki `sandbox add` then conflicts on the `default` alias.

`agents start` prints a `[deprecated]` warning on current OpenHermit. It only pre-hydrates the agent's runner. A new agent already accepts traffic, and its runner hydrates on demand when you chat, so you can skip it.

Config keys (all optional; `--config` can be omitted entirely):

| Key | Default | Meaning |
| --- | --- | --- |
| `cpu_cores` / `memory_mb` / `disk_size_gb` | `2` / `4096` / `10` | sandbox size |
| `agent_home` | `/home/tenki` | workspace mount point and default `cwd` |
| `timeout_ms` | `300000` | guest-enforced per-command timeout; on expiry exit 137, partial stdout/stderr kept |
| `workspace_id` | inferred from the key | explicit Tenki workspace |
| `base_url` | Tenki cloud | self-hosted / staging endpoint |

Tenki confines the SDK's file I/O to `/home/tenki`, so keep `agent_home` under it.

### Put every new agent on Tenki instead

Operators can also register the same `--config` JSON as a gateway sandbox preset. The gateway keeps its config in its database, so set it with `gateway config set`, then restart the gateway:

```bash
npm run dev:cli -- gateway config set sandboxPresets.tenki-default \
  '{"type":"tenki","config":{"timeout_ms":300000}}'
npm run dev:cli -- gateway config set autoProvisionSandbox tenki-default
npm run dev:cli -- gateway stop && npm run dev:cli -- gateway start
```

Set the preset first: the gateway rejects an `autoProvisionSandbox` that names a preset it doesn't know. After the restart, every new agent gets the Tenki sandbox automatically. To choose it per agent instead, register the preset and restart without the `autoProvisionSandbox` line, then pass `--sandbox tenki-default` when you create each new agent, for example `npm run dev:cli -- agents create second --sandbox tenki-default` (`main` from Step 7 already exists). Neither path needs `--no-sandbox`.

OpenHermit's sandbox-model docs still show presets in `gateway.json`. The gateway reads that file only when its database has no config yet: it imports the file once and renames it to `gateway.json.imported`, and later edits to a `gateway.json` are ignored.

## Step 8 — Check the agent is on Tenki

```bash
npm run dev:cli -- sandbox list --agent main
```

You should see one sandbox with alias `default` and type `tenki`. Its status reads `pending` until the backend's first successful `ensure()`, which happens by the agent's first command at the latest, and `provisioned` after that. Commands the agent runs from then on execute in `agent_home` (`/home/tenki` by default) inside the sandbox.

## What the backend does with it

- **One sticky sandbox per agent.** The backend creates the session with `sticky: true` and the agent's ID in its metadata, persists the session id, and after a gateway restart reattaches with `client.get(id)`. It resumes a paused VM instead of recreating it, workspace intact.
- **A new, empty sandbox only when the old one is gone.** If `client.get` reports the session expired, not found or terminated, `ensure()` creates a new session. Any other error, a bad key for example, is rethrown, so it doesn't spawn a replacement.
- **Commands run as `sh -c`** in `agent_home`, with per-agent pass-through secrets injected as env vars on every exec.
- **Skills sync as file uploads** over Tenki's data plane, staged and then swapped in. A sync requested while the sandbox is paused only sets a dirty flag; the next `ensure()` re-pushes the enabled skills from the database.
- **Pause, not terminate.** When it shuts a sandbox down, the backend pauses it rather than terminating it. Pausing is free on Tenki, and `ensure()` resumes the VM on the agent's next command. Tenki itself doesn't pause idle sandboxes, so OpenHermit pauses it in these cases:
  - 5 minutes after the agent's last shell command, by default. That's the agent config's `exec.lifecycle` block (`stop: "idle"`, `idle_timeout_minutes: 5`), and each command restarts the timer.
  - When the gateway evicts an idle runner, after 30 minutes by default, skipping one that a live WebSocket client or a long-running operation still holds. `OPENHERMIT_EVICTION_TTL_MINUTES` in the gateway's environment changes the threshold, and `0` turns eviction off.
  - When you disable the agent.
  - When the agent's runner stops for any other reason: `agents stop`, `agents restart`, or the gateway shutting down (`gateway stop` sends SIGTERM and force-kills after 5 seconds).

  OpenHermit's [lifecycle docs](https://github.com/HCF-STUDIOS/openhermit/blob/main/docs/sandbox-model.md#lifecycle-per-backend-behavior) also list `stop: "session"`, to pause when the session ends. Nothing in current OpenHermit calls that session-end path, so setting `stop: "session"` only turns the 5-minute pause off.

## Troubleshooting

**❌ ``No token. Set TENKI_AUTH_TOKEN, or run `tenki login`.``** `verify.mjs` found no key in `TENKI_AUTH_TOKEN`, `TENKI_API_KEY` or `~/.config/tenki/config.yaml`. Export a `tk_` key from https://app.tenki.cloud, or store it with `tenki login --api-key <key>`.

**❌ `Invalid sandbox type: tenki`.** You're running the published `openhermit` 0.10.0, whose CLI accepts only `host`, `docker`, `e2b` and `daytona`. Run the CLI from a source checkout (Step 5).

**❌ `Sandbox alias "default" already exists for this agent.`** The agent was created without `--no-sandbox`, so it already has the default Docker sandbox. Remove that sandbox with `npm run dev:cli -- sandbox remove --agent main default`, then run the `sandbox add` command again. A removed alias can be reused.

**❌ `TENKI_API_KEY environment variable is not set. Add it to ~/.openhermit/gateway/.env to use the tenki backend.`** The gateway process has neither `TENKI_API_KEY` nor `TENKI_AUTH_TOKEN`. Add the key to `~/.openhermit/gateway/.env`, then restart the gateway with `npm run dev:cli -- gateway stop` and `npm run dev:cli -- gateway start`. A key exported after the gateway started, or stored only by `tenki login`, doesn't reach it. Keeping it in `~/.openhermit/gateway/.env` means every restart picks it up.

**❌ `Missing API key for provider "openrouter".`** The agent's model provider has no key, either as an agent secret or in the gateway's environment. Run `npm run dev:cli -- config secrets set OPENROUTER_API_KEY sk-... --agent main`, or add `OPENROUTER_API_KEY` to `~/.openhermit/gateway/.env` and restart the gateway.

**❌ A command exits 137 with `Command timed out after 300000ms`.** The command ran past `timeout_ms`. Its partial stdout and stderr are kept. OpenHermit has no command to change an existing sandbox's config, so set `timeout_ms` high enough when you first run `sandbox add`. Before you remove it, copy the sandbox's External ID from the admin UI's Sandboxes tab (see the FAQ's cleanup entry), because a removed sandbox no longer appears there. Then remove the sandbox and add it again with a new `--config`. This creates a new sandbox row. Once the agent's runner restarts, the agent gets a new, empty sandbox, and the old one stays paused until you terminate it with that ID.

**❌ A command exits 137 with `… no response within 5000ms grace period`.** The command ran past `timeout_ms` and no result arrived within five more seconds, so the backend aborted the stream. No partial output is available in this case. The backend drops its session handle and reconnects on the next command.

**❌ A command exits 1 with an SDK error in stderr.** A transport-level failure, such as a dropped connection. The backend drops its cached session handle, and the next command reconnects to the same sandbox, or creates a new one if it's gone.

**❌ `path "…" is outside the Tenki workdir "…"`.** An agent file tool targeted a path outside `agent_home`. The file tools work only under `agent_home`; shell commands can write anywhere in the VM.

## FAQ

**When shouldn't I use this?**

- **You need an npm-installed OpenHermit.** No release includes the backend yet.
- **Agents must not reach the network.** Tenki sandboxes have outbound network on by default, and the backend has no config key to turn it off.
- **A workspace must outlive its sandbox.** If the session expires or is terminated, `ensure()` starts a new, empty one.
- **You want sandboxes to clean up after themselves.** A sticky session has no lifetime cap (the SDK discards `maxDurationMs` for `sticky: true`), the backend pauses an agent's sandbox but never terminates it, and `sandbox remove` only soft-deletes OpenHermit's sandbox row (its status flips to `deleted`), so the VM stays. To terminate it, copy its session id from the **External ID** column of the admin UI's Sandboxes tab before you remove the sandbox, then call `close()` on the session that `client.get(id)` from `@tenkicloud/sandbox` returns. In a source checkout, build the admin UI first with `npm run build:ui -w @openhermit/gateway`; by default the gateway serves it at http://127.0.0.1:4000/admin/.

**What happens when the gateway restarts?**
The backend reads the session id it persisted, calls `client.get(id)`, resumes the VM if it's paused, waits for it to be running, and carries on with the same workspace. Step 4's reattach check exercises the same calls.

**Do I pay while an agent is idle?**
Not once the VM is paused, because pausing is free on Tenki. Until then it's running. See [What the backend does with it](#what-the-backend-does-with-it) for when OpenHermit pauses it.

**Do I need `tenki login`?**
Only for `verify.mjs`, if you'd rather not export a key. The gateway reads `TENKI_API_KEY` or `TENKI_AUTH_TOKEN` from its own environment and nothing else.

**Which SDK version?**
`@tenkicloud/sandbox` 1.4 or newer, since openhermit#313. OpenHermit pins `^1.4.0`; this folder installs `>=1.4.1`.

## Related

- [OpenHermit](https://github.com/HCF-STUDIOS/openhermit), and [openhermit#239](https://github.com/HCF-STUDIOS/openhermit/pull/239), the PR that added the Tenki backend
- [openhermit#313](https://github.com/HCF-STUDIOS/openhermit/pull/313), which moved the backend to SDK 1.4 and the guest-enforced timeout
- OpenHermit's [sandbox model](https://github.com/HCF-STUDIOS/openhermit/blob/main/docs/sandbox-model.md) docs, and the backend's source, [`apps/agent/src/core/backends/tenki.ts`](https://github.com/HCF-STUDIOS/openhermit/blob/main/apps/agent/src/core/backends/tenki.ts)
- [`@tenkicloud/sandbox`](https://www.npmjs.com/package/@tenkicloud/sandbox) on npm, and the [Tenki docs](https://tenki.cloud/docs)
- [`../snapshots-pause-resume/`](../snapshots-pause-resume/): the pause and resume loop the backend relies on, on its own
- [`../deerflow-tenki/`](../deerflow-tenki/): another agent platform with a built-in Tenki sandbox provider
