# Run a full-stack app

Run a task-list app in one Tenki sandbox: a JSON API, an HTML frontend, and a SQLite database seeded with 5 tasks. The script ships the code in, seeds the data, starts the server, calls the API, and exposes the frontend on a public HTTPS URL. Each step maps to a tool in the [Tenki MCP server](https://www.npmjs.com/package/@tenkicloud/mcp), so an agent such as Claude Code can run the same loop itself.

## Set it up with a coding agent

Paste this into Claude Code, Codex, Cursor, or another coding agent:

```text
Set up the Tenki "Run a full-stack app" example from https://github.com/LuxorLabs/cookbook.
1. Clone the repo, cd into examples/agent-fullstack-app, and run npm install (Node.js 20 or later).
2. The scripts need a Tenki API key (starts with tk_) in TENKI_AUTH_TOKEN. If it isn't set, stop and ask me to export it (keys come from https://app.tenki.cloud). Never print the key or write it to a file.
3. Run node run.mjs from that directory. Give me the preview URL it prints and the "terminate now:" command, and remind me the sandbox runs until I terminate it or for 2 hours.
4. Run node verify.mjs and confirm the ✓ line.
5. If a step fails, use the Troubleshooting table in the example's README.md.
Then show me how to swap app/server.py for my own app and keep the same flow.
```

## Quick start

You need:

- Node.js 20 or later. The app runs on the sandbox's own `python3`, so you don't need Python locally.
- A Tenki API key (`tk_...`) from [app.tenki.cloud](https://app.tenki.cloud).

### 1. Install

```bash
git clone https://github.com/LuxorLabs/cookbook.git
cd cookbook/examples/agent-fullstack-app
npm install
```

### 2. Set your API key

```bash
export TENKI_AUTH_TOKEN=tk_...   # TENKI_API_KEY also works
```

`run.mjs` reads the key from the environment only. `verify.mjs` also accepts a key saved with `tenki login --api-key <key>`. `TENKI_WORKSPACE_ID` is optional.

### 3. Run

Run it from this directory, since `run.mjs` reads `app/server.py` and `app/seed.py` by relative path:

```bash
node run.mjs
```

It prints `seeded 5 tasks into /home/tenki/app.db`, one line per API call (`GET /api/health`, `GET /api/tasks`, `POST /api/tasks`, `PATCH /api/tasks/1`), the preview URL, and `GET 200 · frontend served`. Open the URL to see the task list.

`run.mjs` leaves the sandbox running so you can open the URL. It stops after 2 hours (`maxDurationMs`). To stop it sooner, paste the `terminate now:` command it prints last. If any step fails, the script terminates the sandbox itself.

### 4. Verify

```bash
node verify.mjs
```

```
✓ agent-fullstack-app: seed 5 → serve → health ok → POST → PATCH → 6 tasks → bad body 400 → frontend 200 → public POST 403 at <preview-host>
```

`verify.mjs` runs the same steps and asserts each one, including a `400` for a non-object body and a `403` for a write sent through the public URL. It always terminates its sandbox. It calls the SDK directly, so it needs no model key.

## How it works

Create the sandbox with inbound traffic allowed and a lifetime cap:

```js
// allowInbound: the gateway routes public traffic to the sandbox (for the preview URL).
// This script deliberately leaves the sandbox running so you can open the URL, so
// set a billing guard: it self-terminates after 2 hours.
const sandbox = await tenki.createAndWait({
  cpuCores: 1,
  memoryMb: 1024,
  allowInbound: true,
  maxDurationMs: 2 * 60 * 60_000,
  workspaceId: process.env.TENKI_WORKSPACE_ID,
});
```

Then ship the app in, seed it, and start the server:

```js
  // 1. Ship the app into the sandbox (agent: tenki_write_file).
  await sandbox.writeFile("server.py", readFileSync(new URL("app/server.py", import.meta.url), "utf8"));
  await sandbox.writeFile("seed.py", readFileSync(new URL("app/seed.py", import.meta.url), "utf8"));

  // 2. Seed the data that powers the backend (agent: tenki_exec).
  const seeded = await sandbox.exec("python3", { args: ["/home/tenki/seed.py"] });
  console.log(stdoutText(seeded).trim());

  // 3. Start the server detached so it outlives this exec() call.
  await sandbox.exec("sh", {
    args: ["-c", "cd /home/tenki && setsid python3 server.py >/tmp/app.log 2>&1 </dev/null & sleep 1"],
  });
```

Step 4 calls the API from inside the sandbox with `python3 -c` and `urllib`. Step 5 exposes the port:

```js
  // 5. Expose the frontend so a human (or the agent) can open the live UI.
  const { previewUrl } = await sandbox.exposePort(PORT);
```

Things to know:

- **SDK file methods are confined to `/home/tenki`.** `writeFile("server.py", …)` lands at `/home/tenki/server.py`. Commands run with `exec` can write anywhere, so the log goes to `/tmp/app.log`.
- **`exec(cmd, { args })` runs a binary with no shell.** Use `sh -c` for `cd`, `&&`, redirects, and `&`.
- **Detach servers with `setsid … &`** so they outlive the `exec` that started them.
- **Networking is on by default in SDK 1.x.** `allowInbound: true` is set explicitly because the preview URL needs it. Pass `allowOutbound: false` to cut a sandbox off.

## The app

Stdlib-only Python (`http.server` and `sqlite3`), so there's no install step. `app/server.py` listens on port 8000:

| Route | What it does |
| --- | --- |
| `GET /` | The frontend (HTML and JS that fetch `/api/tasks`) |
| `GET /api/tasks` | List tasks |
| `POST /api/tasks` | Create a task: `{"title": "...", "status": "todo"}` |
| `PATCH /api/tasks/<id>` | Update its status: `{"status": "done"}` |
| `GET /api/health` | `{"ok": true, "tasks": N}` |

`POST` and `PATCH` are accepted only from `127.0.0.1`, inside the sandbox. Writes through the preview URL arrive from Tenki's gateway and get `403`. A body that isn't a JSON object gets `400`. The frontend renders titles as text. `app/seed.py` creates `/home/tenki/app.db` with 5 tasks.

The app has no auth, so anyone with the URL can read every task. The SQLite file is gone when the sandbox terminates unless you [snapshot it](../snapshots-pause-resume/) first.

Swap in FastAPI, Express, or Next with Postgres and the shape stays the same. To split services, run several processes in one sandbox over `localhost`, or one sandbox per service with its own `exposePort()` URL.

## Let an agent run it

Each step has a matching Tenki MCP tool:

| Step | This example | Agent does it with |
| --- | --- | --- |
| Boot an isolated environment | `createAndWait({ allowInbound: true })` | `tenki_create_sandbox` |
| Ship the app in | `sandbox.writeFile(...)` | `tenki_write_file` |
| Seed the data | `exec python3 seed.py` | `tenki_exec` |
| Start the server | `exec sh -c "setsid python3 server.py &"` | `tenki_exec` |
| Hit the endpoints | GET/POST/PATCH `/api/tasks` | `tenki_exec` |
| Expose the UI | `sandbox.exposePort(8000)` | `tenki_expose_port` |

Add the server to Claude Code ([tenki-mcp README](https://github.com/LuxorLabs/tenki-mcp)):

```bash
claude mcp add tenki --env TENKI_API_KEY=tk_your_key_here -- npx -y @tenkicloud/mcp
```

The local server needs Node 22 or later. For Claude Desktop and Cursor, see [MCP server](../mcp-tenki-sandbox/).

`tenki_create_sandbox` treats inbound networking as off unless the agent passes `allow_inbound: true`, which the preview URL needs. Have it pass `max_duration_seconds` too, for the same lifetime cap.

## Troubleshooting

| Error | Fix |
| --- | --- |
| ``No token. Set TENKI_AUTH_TOKEN, or run `tenki login`.`` | `verify.mjs` found no key. Export one or run `tenki login --api-key <key>`. |
| `missing auth token - set TENKI_AUTH_TOKEN or TENKI_API_KEY ...` | `run.mjs` reads only the environment. Export the key. |
| `invalid auth token - API keys and service tokens must start with tk_` | Create a `tk_` key at [app.tenki.cloud](https://app.tenki.cloud). |
| `ENOENT: no such file or directory, open 'app/server.py'` | Run `run.mjs` from `examples/agent-fullstack-app`. |
| `permission_denied … path outside workdir` | Keep SDK file paths under `/home/tenki`, or write with `exec`. |
| `InboundDisabledError` | Create the sandbox with `allowInbound: true` (or `allow_inbound: true` in MCP). |

## Related

- [tenki-mcp](https://github.com/LuxorLabs/tenki-mcp) and [`@tenkicloud/mcp`](https://www.npmjs.com/package/@tenkicloud/mcp)
- [Expose a port](../expose-a-port/)
- [Pause, snapshot, and resume](../snapshots-pause-resume/)
- [MCP server](../mcp-tenki-sandbox/)
- [`@tenkicloud/sandbox` on npm](https://www.npmjs.com/package/@tenkicloud/sandbox) and the [Tenki docs](https://tenki.cloud/docs)
