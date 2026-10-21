# Pi Durable

Run [Pi](https://github.com/earendil-works/pi) Durable's agent tools in a Tenki sandbox. Pi's Durable harness checkpoints every conversation, model turn, and tool call to storage. Its `@earendil-works/pi-env` package runs tools on another machine through a small daemon, normally over SSH. This example runs that daemon in a Tenki sandbox with no SSH, so Pi checkpoints the agent's state and Tenki can pause and resume the machine. A read after a pause resumes the sandbox on its own.

pi-durable and pi-env are experimental upstream, and their APIs can change between releases. This example was built against 1.2.0.

## Quick start

You need:

- Node.js 22.19 or later (what the Pi packages declare). `verify.mjs` also runs on Node 20 with `EBADENGINE` warnings.
- A Tenki API key (`tk_...`) from [app.tenki.cloud](https://app.tenki.cloud).

### 1. Install

```bash
git clone https://github.com/LuxorLabs/cookbook.git
cd cookbook/examples/pi-durable-tenki
npm install
```

This installs `@earendil-works/pi-durable`, `pi-env`, and `chord` at `^1.2.0`, and `@tenkicloud/sandbox` 1.4.1 or later.

### 2. Set your API key

```bash
export TENKI_API_KEY=tk_...   # TENKI_AUTH_TOKEN also works
```

`run.mjs` and the bridge read the key from the environment only. `verify.mjs` also accepts a key saved with `tenki login --api-key <key>`.

### 3. Run

```bash
node run.mjs
```

```text
daemon up: pi-env 1.2.0 on linux/x86_64
exec -> Linux 6.18.29
pausing (snapshot memory + disk, free the VM) ...
resumed -> state the agent built up
```

The pause takes about a minute. The read after it resumes the sandbox, respawns the daemon in about 0.5 s, and finds the file. The script terminates the sandbox at the end.

### 4. Verify

```bash
node verify.mjs
```

```text
✓ pi-durable-tenki: boot + daemon → hello → exec → file round-trip → pause → same env resumes, file intact
```

`verify.mjs` checks that the daemon reports `linux`, `uname -s` prints `Linux`, a marker file round-trips, the sandbox reaches `PAUSED`, and a read on the same env returns the marker and leaves the sandbox `RUNNING`. It needs no model key, so it doesn't run the Durable harness or an agent turn.

## The demo

`run.mjs`:

```js
// Drive Pi Durable's ExecutionEnv surface on a Tenki sandbox, pause the
// sandbox mid-session, and watch the same env recover on the next call.
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { getOrThrow } from "@earendil-works/pi-durable/env";
import { createTenkiEnv } from "./tenki-env.mjs";

const { session, connection, env, dispose } = await createTenkiEnv();
try {
  const info = await connection.info();
  console.log(`daemon up: pi-env ${info.version} on ${info.os}/${info.arch}`);

  let out = "";
  getOrThrow(await env.exec(["uname", "-sr"], { onOutput: (t) => (out += t) }, BACKGROUND_CONTEXT));
  console.log(`exec -> ${out.trim()}`);

  getOrThrow(await env.writeFile("notes.txt", "state the agent built up\n", BACKGROUND_CONTEXT));

  console.log("pausing (snapshot memory + disk, free the VM) ...");
  await session.pause();

  // Same env object: this read resumes the sandbox and respawns the daemon.
  const back = getOrThrow(await env.readTextFile("notes.txt", BACKGROUND_CONTEXT));
  console.log(`resumed -> ${back.trim()}`);
} finally {
  await dispose();
}
```

## Use it in a Durable worker

`createTenkiEnv()` returns a `harnessEnv` for the harness's `env` option:

```js
import { Harness } from "@earendil-works/pi-durable";
import { createTenkiEnv } from "./tenki-env.mjs";

const tenkiEnv = await createTenkiEnv();
const harness = await Harness.open(storage, {
  models,
  registry,
  env: tenkiEnv.harnessEnv, // every tool call now runs in the sandbox
}, context);
// at shutdown: await tenkiEnv.dispose();
```

`storage`, `models`, `registry`, and `context` come from your Pi Durable setup ([quick start](https://github.com/earendil-works/pi/tree/main/packages/durable#quick-start)). Running an agent turn needs a model provider and key.

- Copy `tenki-env.mjs` and `bridge.mjs` into the same directory. The connection starts the bridge from there.
- `createTenkiEnv()` takes `{ cpuCores, memoryMb, onLog }` (defaults: 1 core, 1024 MB). `onLog` receives daemon and bridge diagnostics.
- Use one env id and one `Connection` per sandbox. In Pi, equal env ids mean the same files, and `edit`/`write` serialize by env id and path.
- Check a custom env against Pi's expectations with `registerEnvConformance()` from `@earendil-works/pi-durable/testing`.

## How the bridge works

pi-env's `Connection` spawns a local command and speaks its framed protocol over that process's stdio. Normally that's `ssh`. Here it's `bridge.mjs`, which starts the daemon in the sandbox and pipes its stdio over Tenki's exec data plane:

```js
#!/usr/bin/env node
// Spawned by pi-env's Connection as: node bridge.mjs <sessionId> serve --token <hex>
// Runs the daemon inside the Tenki sandbox and pipes its stdio through — the
// framed protocol rides Tenki's exec data plane, no SSH involved.
import { Readable, Writable } from "node:stream";
import { TenkiSandbox } from "@tenkicloud/sandbox";

const [sessionId, ...daemonArgs] = process.argv.slice(2);
const authToken = process.env.TENKI_AUTH_TOKEN || process.env.TENKI_API_KEY;

try {
  const client = new TenkiSandbox({ authToken });
  const session = await client.get(sessionId);
  const handle = session.run(["/home/tenki/pi-env", ...daemonArgs], {
    stdin: Readable.toWeb(process.stdin),
  });
  handle.stdout.pipeTo(Writable.toWeb(process.stdout)).catch(() => {});
  handle.stderr.pipeTo(Writable.toWeb(process.stderr)).catch(() => {});
  process.exit((await handle).exitCode ?? 1);
} catch (err) {
  // An unreachable sandbox becomes a clean spawn failure; pi-env retries on the next request.
  console.error(`bridge: ${err?.message ?? err}`);
  process.exit(1);
}
```

`tenki-env.mjs` uploads the static linux-x64 daemon from the pi-env package (2.4 MB) and wires a `RemoteExecutionEnv` through the bridge. The `command` option is re-run on every reconnect, so a paused sandbox is resumed before the bridge starts:

```js
  // The pi-env package ships a static linux-x64 daemon that runs on Tenki's stock image.
  const daemon = join(dirname(require.resolve("@earendil-works/pi-env")), "../bin/pi-env-linux-x64/pi-env");
  await session.writeFile("/home/tenki/pi-env", readFileSync(daemon));
  await session.exec(["chmod", "+x", "/home/tenki/pi-env"]);

  // pi-env recomputes `command` on every (re)connect, so a sandbox paused between
  // requests is resumed before the bridge spawns — the next call recovers on its own.
  const connection = new Connection({
    command: async () => {
      await session.refresh();
      if (session.state === "PAUSED") {
        await session.resume();
        await session.waitResumed();
      }
      return ["node", join(here, "bridge.mjs"), session.id];
    },
    onLog,
  });

  // Equal env ids mean the same files, so: one id (and one Connection) per sandbox.
  const env = new RemoteExecutionEnv({
    connection,
    id: `pi-env:tenki:${session.id}`,
    cwd: "/home/tenki",
  });
```

Daemon behavior to know, from pi-env's [protocol](https://github.com/earendil-works/pi/blob/main/packages/env/docs/protocol.md):

- The daemon exits when its stdin ends or after 30 s without traffic and kills every process it started. A dead bridge leaks nothing, but commands don't survive a pause or a dropped connection.
- A reconnect is a fresh daemon session. Handles opened before it, such as readers and running execs, fail cleanly instead of reaching the new daemon.

## Troubleshooting

| Problem | Fix |
| --- | --- |
| `missing auth token - set TENKI_AUTH_TOKEN or TENKI_API_KEY ...` | `run.mjs` reads only the environment. Export `TENKI_API_KEY`. |
| ``No token. Set TENKI_API_KEY, or run `tenki login`.`` | `verify.mjs` found no key. Export one or run `tenki login --api-key <key>`. |
| `invalid auth token - API keys and service tokens must start with tk_` | Create a `tk_` key at [app.tenki.cloud](https://app.tenki.cloud). |
| `npm warn EBADENGINE Unsupported engine` | Use Node 22.19 or later. On Node 20 it's only a warning. |
| `pi-env connection lost` from a handle opened before a pause | Handles belong to the old daemon session. Open a new one. |
| `bridge: <message>` in `onLog` | The bridge couldn't reach the sandbox. pi-env retries on the next request. |

## Related

- [Pi](https://github.com/earendil-works/pi), [`pi-durable`](https://github.com/earendil-works/pi/tree/main/packages/durable), and [`pi-env`](https://github.com/earendil-works/pi/tree/main/packages/env)
- [Pause, snapshot, and resume](../snapshots-pause-resume/): pause and resume with the SDK alone
- [`@tenkicloud/sandbox` on npm](https://www.npmjs.com/package/@tenkicloud/sandbox) and the [Tenki docs](https://tenki.cloud/docs)
