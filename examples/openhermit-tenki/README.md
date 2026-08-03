# OpenHermit agents on Tenki sandboxes

[OpenHermit](https://github.com/HCF-STUDIOS/openhermit) deploys fleets of AI agents as production services — a gateway holds durable state in PostgreSQL, and each agent gets a **sandbox** for its shell and workspace files. Since [openhermit#239](https://github.com/HCF-STUDIOS/openhermit/pull/239), `tenki` is a first-class sandbox type alongside `host`, `docker`, `e2b`, and `daytona`: each agent's workspace becomes one sticky [Tenki](https://tenki.cloud) microVM that survives gateway restarts.

## Point an agent at Tenki

```bash
npm install -g openhermit
hermit setup                                        # DATABASE_URL, tokens

echo 'TENKI_API_KEY=tk_...' >> ~/.openhermit/gateway/.env
hermit gateway start

hermit agents create main
hermit sandbox add --agent main --type tenki \
  --config '{"project_id": "default"}'
hermit agents start main
hermit chat --agent main                            # the agent's shell now runs on Tenki
```

Config keys (all optional except `project_id`, which OpenHermit's schema still requires — current Tenki no longer scopes sandboxes by project, so any identifier satisfies it):

| Key | Default | Meaning |
| --- | --- | --- |
| `cpu_cores` / `memory_mb` / `disk_size_gb` | `2` / `4096` / `10` | microVM size |
| `agent_home` | `/home/tenki` | workspace mount point and default `cwd` |
| `timeout_ms` | `300000` | per-command timeout (exit 137 on expiry) |
| `workspace_id` | token's own scope | explicit Tenki workspace |
| `base_url` | Tenki cloud | self-hosted / staging endpoint |

Operators can also register the same blob as a preset in `gateway.json` (`"sandboxPresets": { "tenki-default": { "type": "tenki", "config": { ... } } }`) and set `"autoProvisionSandbox": "tenki-default"` so every new agent lands on Tenki automatically.

## What the backend does with it

- **One sticky microVM per agent.** The backend creates the session with `sticky: true`, persists the session id, and after a gateway restart reattaches with `client.get(id)` — resuming a paused VM instead of recreating it, workspace intact.
- **Commands run as `sh -c`** in `agent_home`, with per-agent pass-through secrets injected as env vars on every exec.
- **Skills sync as file uploads** over Tenki's data plane; syncs queued while the sandbox is unreachable replay when it reattaches.

## Verify

```bash
npm install
node verify.mjs
```

No gateway or database needed: [`verify.mjs`](verify.mjs) drives the exact Tenki surface the backend is built on — boot a sticky session → `sh -c` exec with env pass-through → skill-file round-trip → **reattach by session id** → dispose — against the live API. The backend's internals (state rows, replay queues) are covered by OpenHermit's own test suite.

## Notes

- The agent runtime requires `TENKI_API_KEY` (or `TENKI_AUTH_TOKEN`) in the **gateway's** environment (`~/.openhermit/gateway/.env`), not per agent.
- Sticky sessions pause rather than terminate when idle; pausing is free on Tenki, and `ensure()` resumes them transparently on the next command.
- Tenki confines file I/O to `/home/tenki` — keep `agent_home` under it.
