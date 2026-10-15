# An agent runs a full-stack app on Tenki

Stand up a backend API + frontend + seeded database inside one [Tenki](https://tenki.cloud) microVM, call the endpoints, change the data, and open the live UI — the loop an AI agent runs when you ask it to build and drive an app.

Every step maps to a [Tenki MCP](https://www.npmjs.com/package/@tenkicloud/mcp) tool, so Claude (or any MCP agent) can run the same steps itself through the MCP server, with no bespoke backend of yours orchestrating them:

| Step | This example | Agent does it with |
| --- | --- | --- |
| Boot an isolated environment | `createAndWait({ allowInbound: true })` | `tenki_create_sandbox` |
| Ship the app in | `sandbox.writeFile(...)` | `tenki_write_file` |
| Seed the data | `exec python3 seed.py` | `tenki_exec` |
| Start the server | `exec sh -c "setsid python3 server.py &"` | `tenki_exec` |
| Hit the endpoints | GET/POST/PATCH `/api/tasks` | `tenki_exec` (curl/python) |
| Expose the UI | `sandbox.exposePort(8000)` | `tenki_expose_port` |

## Run it

```bash
npm install
export TENKI_AUTH_TOKEN=tk_...      # from `tenki login` (~/.config/tenki/config.yaml)
export TENKI_WORKSPACE_ID=...
node run.mjs                       # leaves the sandbox up so you can open the URL
```

`run.mjs` prints a public HTTPS preview URL — open it and you'll see the task list, served from the microVM. `verify.mjs` does the same end-to-end and asserts every step (that's what CI runs), then terminates the sandbox.

## The app

Stdlib-only Python (`http.server` + `sqlite3`) so it boots with no install step:

- `GET /` — the frontend (HTML + JS that fetches the API)
- `GET /api/tasks` · `POST /api/tasks` · `PATCH /api/tasks/<id>` · `GET /api/health`
- `seed.py` — creates `app.db` with 5 tasks; the data behind the backend

Swap in FastAPI/Express/Next and Postgres and the shape is identical — the sandbox doesn't care.

## Multiple services

One sandbox can run several processes (API, worker, DB) that talk to each other over `localhost`, which is usually what you want. For true per-service isolation, run one sandbox per service, `exposePort()` each, and pass the URLs as config; sandboxes reach each other over those public URLs. That traffic goes through the public gateway, not a private mesh, so set `allowOutbound: true` on any sandbox that calls another.

## Notes

- Networking is off by default: `allowInbound` to receive traffic (needed for `exposePort`), `allowOutbound` to make external calls.
- Detach long-running servers (`setsid … &`) so they outlive the `exec` that started them.
- File I/O is confined to `/home/tenki`; use relative paths.
- The sandbox is disposable and billed per second. To keep the seeded state for later runs, snapshot it and resume — see [snapshots-pause-resume](../snapshots-pause-resume/).
- Products used: **Tenki Sandbox**. More at [tenki.cloud](https://tenki.cloud).
