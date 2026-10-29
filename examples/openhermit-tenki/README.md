# OpenHermit

Give each of your OpenHermit agents its own cloud machine that keeps its files between conversations and costs nothing while idle.

[OpenHermit](https://github.com/HCF-STUDIOS/openhermit) runs AI agents as always-on services. A server called the **gateway** manages them and stores their settings and history in PostgreSQL. Each agent gets a **sandbox**, the machine where its shell commands run, its file tools read and write, and its **skills** (instruction files it can load) live. By default that's a Docker container on the gateway's machine.

OpenHermit's `tenki` sandbox type makes it a Tenki VM instead. Each agent keeps one VM for its whole life: OpenHermit pauses it when the agent goes quiet and resumes it on the next command, and it reconnects to the same VM after a gateway restart, so the agent's files are always where it left them.

The steps below set up OpenHermit with a Tenki-backed agent. This folder's `verify.mjs` is a quicker check that your Tenki key works and the backend's Tenki calls succeed, without installing OpenHermit.

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

The Tenki backend was added after OpenHermit's latest npm release (`0.10.0`), so run OpenHermit from source until the next release.

### 1. Install OpenHermit from source

```bash
git clone https://github.com/HCF-STUDIOS/openhermit && cd openhermit && npm install
```

The checkout already depends on `@tenkicloud/sandbox` `^1.4.0`. `npm run dev:cli --` runs the `hermit` CLI from source. Once a release includes the backend, `npm install -g openhermit` and type `hermit` instead.

### 2. Set your API key

The gateway reads the key from its own settings file, not your shell or `tenki login`:

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

- `--no-sandbox` skips the default Docker sandbox, so the Tenki one becomes the agent's `default`.
- Without a model key the agent can't reply. You can put `OPENROUTER_API_KEY` in the gateway's `.env` instead.
- `agents start` prints a `[deprecated]` warning and can be skipped; the agent starts on its first message anyway.

### 4. Verify

```bash
npm run dev:cli -- sandbox list --agent main
```

You see one sandbox named `default` with type `tenki`. Its status reads `pending` until the agent runs its first command, which creates the VM, then `provisioned`.

To check your Tenki key and the backend's Tenki calls without a gateway, database, or model key, run this folder's check:

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
| `agent_home` | `/home/tenki` | where the agent's files go, and the folder commands start in |
| `timeout_ms` | `300000` | time limit for each command, enforced inside the sandbox; a command that runs over exits with code 137 and keeps the output it printed |
| `workspace_id` | inferred from the key | explicit Tenki workspace |
| `base_url` | Tenki cloud | a different Tenki API endpoint |

Keep `agent_home` under `/home/tenki`, where Tenki confines the SDK's file I/O. OpenHermit can't change an existing sandbox's config, so set `timeout_ms` when you add it.

### Put every new agent on Tenki

Save the Tenki settings as a named **preset** on the gateway, make it the default for new agents, then restart:

```bash
npm run dev:cli -- gateway config set sandboxPresets.tenki-default \
  '{"type":"tenki","config":{"timeout_ms":300000}}'
npm run dev:cli -- gateway config set autoProvisionSandbox tenki-default
npm run dev:cli -- gateway stop && npm run dev:cli -- gateway start
```

Set the preset before `autoProvisionSandbox`, which must name a known preset. To choose per agent instead, skip the `autoProvisionSandbox` line and pass `--sandbox tenki-default` to `agents create`. The gateway stores config in its database; a `gateway.json` is imported once and then ignored.

## How the backend works

- **One long-lived sandbox per agent.** The backend creates the sandbox with Tenki's `sticky: true` option, which keeps it able to pause and resume, and saves its id. After a gateway restart it reconnects with `client.get(id)` and resumes it if paused. It creates a new, empty sandbox only when the old one has expired or been deleted.
- **Commands run through `sh -c`** in `agent_home`, with the secrets you've given the agent as environment variables. A command that runs past `timeout_ms` exits with code 137 and keeps the output it printed.
- **Skills are uploaded as files** and swapped in all at once. If skills change while the sandbox is paused, the backend uploads them the next time the sandbox is used.
- **Pause, not delete.** Pausing is free, and the next command resumes the VM. OpenHermit pauses the sandbox 5 minutes after the agent's last command (`exec.lifecycle`), when the gateway unloads an idle agent (after 30 minutes, `OPENHERMIT_EVICTION_TTL_MINUTES`), when you disable the agent, or when it stops.

`verify.mjs` makes the same Tenki calls. It starts a long-lived sandbox and runs a command the way the backend does:

```js
const client = new TenkiSandbox({ authToken });
const text = (bytes) => new TextDecoder().decode(bytes);
let session;
try {
  // 1) start a long-lived ("sticky") sandbox, as the backend does for each agent
  session = await client.createAndWait({
    cpuCores: 1,
    memoryMb: 1024,
    sticky: true,
    metadata: { agentId: "cookbook-openhermit-verify" },
    workspaceId,
  });

  // 2) run a command the way the backend does: through sh -c, in agent_home, with the
  //    agent's environment variables, and with a time limit enforced inside the sandbox
  const r1 = await session.run(["sh", "-c", 'echo "$GREETING $(python3 -c "print(6*7)")"'], {
    cwd: "/home/tenki",
    env: { GREETING: "hermit" },
    timeoutMs: 300_000,
  });
  if (!(r1.exitCode === 0 && !r1.timedOut && text(r1.stdout).trim() === "hermit 42")) {
    throw new Error(`exec: exit ${r1.exitCode}, stdout ${JSON.stringify(text(r1.stdout))}, stderr ${JSON.stringify(text(r1.stderr))}`);
  }
```

It then checks that a timed-out command keeps its partial output, writes a skill file, and reconnects by id as the gateway does after a restart:

```js
  // 4) reconnect by id, as the gateway does after a restart: resume the sandbox if it's
  //    paused, wait until it's running, and check the files are still there
  const again = await client.get(session.id);
  if (again.state === "PAUSED") await again.resume();
  if (again.state !== "RUNNING") await again.waitReady(180_000);
  const r2 = await again.run(["sh", "-c", "cat skills/demo.md"], { cwd: "/home/tenki" });
  if (!text(r2.stdout).includes("demo skill")) throw new Error("reattached session lost workspace state");
```

A `finally` block deletes the sandbox. The backend's own tests are upstream in [`tenki-backend.test.ts`](https://github.com/HCF-STUDIOS/openhermit/blob/main/apps/agent/test/tenki-backend.test.ts).

## Things to know

- **Sandboxes don't clean up after themselves.** They have no lifetime cap, the backend never deletes them, and `sandbox remove` only marks the sandbox `deleted` in OpenHermit's database. Before removing a sandbox, copy its **External ID** from the admin UI's Sandboxes tab (http://127.0.0.1:4000/admin/, after `npm run build:ui -w @openhermit/gateway`), then `close()` the session that `client.get(id)` returns.
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
