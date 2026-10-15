# OpenHermit agents on Tenki sandboxes

[OpenHermit](https://github.com/HCF-STUDIOS/openhermit) deploys fleets of AI agents as production services — a gateway holds durable state in PostgreSQL, and each agent gets a **sandbox** for its shell and workspace files. Since [openhermit#239](https://github.com/HCF-STUDIOS/openhermit/pull/239), `tenki` is a first-class sandbox type alongside `host`, `docker`, `e2b`, and `daytona`: each agent's workspace becomes one sticky [Tenki](https://tenki.cloud) microVM that survives gateway restarts.

## Point an agent at Tenki

> OpenHermit's latest npm release (`0.10.0`) does not include the Tenki backend, which merged after it. Since [openhermit#313](https://github.com/HCF-STUDIOS/openhermit/pull/313), the backend also needs `@tenkicloud/sandbox` 1.4 or newer. Until the next release ships, run from a source checkout — `git clone https://github.com/HCF-STUDIOS/openhermit && cd openhermit && npm install`, then substitute `npm run dev:cli --` wherever `hermit` appears below (see the repo's Development section).

```bash
hermit setup                                        # DATABASE_URL, tokens

echo 'TENKI_API_KEY=tk_...' >> ~/.openhermit/gateway/.env
hermit gateway start

hermit agents create main --no-sandbox              # skip the default Docker sandbox
hermit sandbox add --agent main --type tenki \
  --config '{"timeout_ms": 300000}'
hermit agents start main
hermit chat --agent main                            # the agent's shell now runs on Tenki
```

`--no-sandbox` matters: without it, `agents create` auto-provisions the gateway's default sandbox preset (Docker), and the Tenki `sandbox add` then conflicts on the `default` alias.

Config keys (all optional; `--config` can be omitted entirely):

| Key | Default | Meaning |
| --- | --- | --- |
| `cpu_cores` / `memory_mb` / `disk_size_gb` | `2` / `4096` / `10` | microVM size |
| `agent_home` | `/home/tenki` | workspace mount point and default `cwd` |
| `timeout_ms` | `300000` | guest-enforced per-command timeout; on expiry exit 137, partial stdout/stderr kept |
| `workspace_id` | token's own scope | explicit Tenki workspace |
| `base_url` | Tenki cloud | self-hosted / staging endpoint |

Operators can also register the same `--config` JSON as a preset in `gateway.json` (`"sandboxPresets": { "tenki-default": { "type": "tenki", "config": { ... } } }`). Setting `"autoProvisionSandbox": "tenki-default"` then puts every new agent on Tenki automatically; to choose it per agent instead, use `hermit agents create main --sandbox tenki-default`. Neither path needs `--no-sandbox`.

## What the backend does with it

- **One sticky microVM per agent.** The backend creates the session with `sticky: true`, persists the session id, and after a gateway restart reattaches with `client.get(id)` — resuming a paused VM instead of recreating it, workspace intact.
- **Commands run as `sh -c`** in `agent_home`, with per-agent pass-through secrets injected as env vars on every exec.
- **Skills sync as file uploads** over Tenki's data plane, staged and then swapped in. A sync requested while the sandbox is paused only sets a dirty flag; the next `ensure()` re-pushes the enabled skills from the database.

## Verify

```bash
npm install
node verify.mjs
```

No gateway or database needed: [`verify.mjs`](verify.mjs) runs the exact Tenki SDK calls the backend is built on against the live API. It boots a sticky session, runs an `sh -c` exec with env pass-through, runs a command that times out and keeps its partial output, round-trips a skill file, **reattaches by session id**, and disposes the session. The backend's internals (state rows, the skill dirty flag) are covered by OpenHermit's own test suite.

## Notes

- The agent runtime requires `TENKI_API_KEY` (or `TENKI_AUTH_TOKEN`) in the **gateway's** environment (`~/.openhermit/gateway/.env`), not per agent.
- Sticky sessions pause rather than terminate when idle; pausing is free on Tenki, and `ensure()` resumes them transparently on the next command.
- Tenki confines file I/O to `/home/tenki` — keep `agent_home` under it.
