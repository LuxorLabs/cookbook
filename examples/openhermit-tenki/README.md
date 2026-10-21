# OpenHermit

Run [OpenHermit](https://github.com/HCF-STUDIOS/openhermit) agents on Tenki sandboxes. OpenHermit deploys fleets of AI agents as services, with a gateway that keeps state in PostgreSQL. With its `tenki` sandbox type, each agent's shell commands, file tools, and skills run in one sticky Tenki sandbox that survives gateway restarts. This folder holds a check of the Tenki side, not OpenHermit itself.

## Set it up with a coding agent

Paste this into Claude Code, Codex, Cursor, or another coding agent:

```text
Set up OpenHermit with its agents on Tenki sandboxes, following https://github.com/LuxorLabs/cookbook/tree/main/examples/openhermit-tenki.
1. Clone https://github.com/HCF-STUDIOS/openhermit outside any other repo, check that Node.js is 20 or later, and run npm install.
2. Ask me to run npm run dev:cli -- setup myself, since it is an interactive wizard that asks for a database.
3. The gateway needs TENKI_API_KEY (a Tenki key starting with tk_, from https://app.tenki.cloud) in ~/.openhermit/gateway/.env, and the agent needs OPENROUTER_API_KEY. Ask me to add both myself. Never ask me to paste a key to you, print one, or write one to a file.
4. Start the gateway, then create an agent on Tenki with the agents create main --no-sandbox and sandbox add --type tenki commands from the README.
5. Run npm run dev:cli -- sandbox list --agent main and confirm a tenki sandbox with alias default.
6. If a step fails, use the Troubleshooting table in the example's README.md.
```

## Quick start

You need:

- Node.js 20 or later and git.
- A Tenki API key (`tk_...`) from [app.tenki.cloud](https://app.tenki.cloud).
- PostgreSQL, or Docker so the setup wizard can start one.
- An [OpenRouter](https://openrouter.ai) API key for the agent's model (`google/gemini-3-flash-preview` by default).

The Tenki backend merged after OpenHermit's latest npm release (`0.10.0`), so run OpenHermit from source until the next release.

### 1. Install OpenHermit from source

```bash
git clone https://github.com/HCF-STUDIOS/openhermit && cd openhermit && npm install
```

The checkout already depends on `@tenkicloud/sandbox` `^1.4.0`. `npm run dev:cli --` runs the `hermit` CLI from source. Once a release includes the backend, `npm install -g openhermit` and type `hermit` instead.

### 2. Set your API key

The gateway reads the key from its own env file, not your shell or `tenki login`:

```bash
npm run dev:cli -- setup                            # DATABASE_URL, tokens

echo 'TENKI_API_KEY=tk_...' >> ~/.openhermit/gateway/.env
npm run dev:cli -- gateway start
```

`setup` is an interactive wizard that writes `DATABASE_URL`, the admin token, and secrets to `~/.openhermit/gateway/.env`. Add the key before `gateway start`, or restart the gateway after.

### 3. Put an agent on Tenki

```bash
npm run dev:cli -- agents create main --no-sandbox  # skip the default Docker sandbox
npm run dev:cli -- sandbox add --agent main --type tenki \
  --config '{"timeout_ms": 300000}'
npm run dev:cli -- config secrets set OPENROUTER_API_KEY sk-... --agent main
npm run dev:cli -- agents start main
npm run dev:cli -- chat --agent main                # the agent's shell now runs on Tenki
```

- `--no-sandbox` skips the default Docker sandbox, which would otherwise take the `default` alias.
- Without a model key the agent can't run a turn. You can put `OPENROUTER_API_KEY` in the gateway's `.env` instead.
- `agents start` prints a `[deprecated]` warning and can be skipped; the runner starts on demand.

### 4. Verify

```bash
npm run dev:cli -- sandbox list --agent main
```

You see one sandbox with alias `default` and type `tenki`. Its status reads `pending` until the agent's first command, then `provisioned`.

To check the Tenki side without a gateway, database, or model, run this folder's check:

```bash
git clone https://github.com/LuxorLabs/cookbook.git
cd cookbook/examples/openhermit-tenki
npm install
export TENKI_API_KEY=tk_...   # TENKI_AUTH_TOKEN or a `tenki login` key also work
node verify.mjs
```

```
✓ openhermit-tenki: sticky session → sh -c exec with env (hermit 42) → timeout keeps partial output → skill file sync → reattach by id → dispose
```

## Sandbox config

Pass these to `sandbox add --config`. All are optional.

| Key | Default | Meaning |
| --- | --- | --- |
| `cpu_cores` / `memory_mb` / `disk_size_gb` | `2` / `4096` / `10` | sandbox size |
| `agent_home` | `/home/tenki` | workspace mount point and default `cwd` |
| `timeout_ms` | `300000` | guest-enforced per-command timeout; on expiry exit 137, partial stdout/stderr kept |
| `workspace_id` | inferred from the key | explicit Tenki workspace |
| `base_url` | Tenki cloud | self-hosted / staging endpoint |

Keep `agent_home` under `/home/tenki`, where Tenki confines the SDK's file I/O. OpenHermit can't change an existing sandbox's config, so set `timeout_ms` when you add it.

### Put every new agent on Tenki

Register a gateway preset, then restart:

```bash
npm run dev:cli -- gateway config set sandboxPresets.tenki-default \
  '{"type":"tenki","config":{"timeout_ms":300000}}'
npm run dev:cli -- gateway config set autoProvisionSandbox tenki-default
npm run dev:cli -- gateway stop && npm run dev:cli -- gateway start
```

Set the preset before `autoProvisionSandbox`, which must name a known preset. To choose per agent instead, skip the `autoProvisionSandbox` line and pass `--sandbox tenki-default` to `agents create`. The gateway stores config in its database; a `gateway.json` is imported once and then ignored.

## How the backend works

- **One sticky sandbox per agent.** It creates the session with `sticky: true`, stores its id, and after a gateway restart reattaches with `client.get(id)`, resuming it if paused. It creates a new, empty sandbox only when the old one has expired or been terminated.
- **Commands run as `sh -c`** in `agent_home`, with the agent's pass-through secrets as env vars. A command past `timeout_ms` exits 137 with its partial output kept.
- **Skills sync as file uploads**, staged and swapped in. A sync while paused sets a dirty flag, and the next `ensure()` re-pushes them.
- **Pause, not terminate.** Pausing is free, and the next command resumes the VM. OpenHermit pauses the sandbox 5 minutes after the agent's last command (`exec.lifecycle`), when the gateway evicts an idle runner (30 minutes, `OPENHERMIT_EVICTION_TTL_MINUTES`), when you disable the agent, or when its runner stops.

`verify.mjs` makes the same SDK calls. It boots a sticky session and runs a command the way the backend does:

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

It then checks that a timed-out command keeps its partial output, writes a skill file, and reattaches by id as the gateway does after a restart:

```js
  // 4) reattach by id — what the gateway does after a restart (readySession: resume if
  //    paused, wait until RUNNING)
  const again = await client.get(session.id);
  if (again.state === "PAUSED") await again.resume();
  if (again.state !== "RUNNING") await again.waitReady(180_000);
  const r2 = await again.run(["sh", "-c", "cat skills/demo.md"], { cwd: "/home/tenki" });
  if (!text(r2.stdout).includes("demo skill")) throw new Error("reattached session lost workspace state");
```

A `finally` block disposes the session. The backend's own tests are upstream in [`tenki-backend.test.ts`](https://github.com/HCF-STUDIOS/openhermit/blob/main/apps/agent/test/tenki-backend.test.ts).

## Things to know

- **Sandboxes don't clean up after themselves.** Sticky sessions have no lifetime cap, the backend never terminates them, and `sandbox remove` only marks OpenHermit's row `deleted`. Before removing a sandbox, copy its **External ID** from the admin UI's Sandboxes tab (http://127.0.0.1:4000/admin/, after `npm run build:ui -w @openhermit/gateway`), then `close()` the session that `client.get(id)` returns.
- **Outbound network is on**, and the backend has no setting to turn it off.

## Troubleshooting

| Problem | Fix |
| --- | --- |
| ``No token. Set TENKI_AUTH_TOKEN, or run `tenki login`.`` | `verify.mjs` found no key. Export one or run `tenki login --api-key <key>`. |
| `Invalid sandbox type: tenki` | You're on npm `openhermit` 0.10.0. Run the CLI from source. |
| `Sandbox alias "default" already exists for this agent.` | Run `npm run dev:cli -- sandbox remove --agent main default`, then `sandbox add` again. |
| `TENKI_API_KEY environment variable is not set. …` | Add the key to `~/.openhermit/gateway/.env` and restart the gateway. |
| `Missing API key for provider "openrouter".` | Set `OPENROUTER_API_KEY` as an agent secret or in the gateway's `.env`. |
| Exit 137 with `Command timed out after 300000ms` | Remove the sandbox (after copying its External ID) and add it with a higher `timeout_ms`. |
| Exit 137 with `… no response within 5000ms grace period` | No partial output; the backend reconnects on the next command. |
| Exit 1 with an SDK error in stderr | A dropped connection. The next command reconnects. |
| `path "…" is outside the Tenki workdir "…"` | File tools work only under `agent_home`. |

## Related

- [OpenHermit](https://github.com/HCF-STUDIOS/openhermit), [openhermit#239](https://github.com/HCF-STUDIOS/openhermit/pull/239) (the Tenki backend), and its [sandbox model](https://github.com/HCF-STUDIOS/openhermit/blob/main/docs/sandbox-model.md) docs
- [`@tenkicloud/sandbox` on npm](https://www.npmjs.com/package/@tenkicloud/sandbox) and the [Tenki docs](https://tenki.cloud/docs)
- [Pause, snapshot, and resume](../snapshots-pause-resume/): the pause and resume loop the backend relies on
- [DeerFlow](../deerflow-tenki/): another agent platform with a Tenki sandbox provider
