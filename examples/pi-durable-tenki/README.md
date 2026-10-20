# How to run Pi Durable's agent tools in a Tenki sandbox

A Pi `ExecutionEnv` backed by a Tenki sandbox survives a pause. The sandbox is paused mid-session, and the next file read on the same env resumes it and finds the file intact.

About 3 minutes. `npm install` takes seconds. `run.mjs` and `verify.mjs` each spend about a minute on the sandbox pause.

`run.mjs` and `verify.mjs` drive the execution env directly and need only a Tenki API key. Running an agent turn through the Durable harness also needs a model provider and key. See [Pi Durable's quick start](https://github.com/earendil-works/pi/tree/main/packages/durable#quick-start).

## Why bother

[Pi](https://github.com/earendil-works/pi) is an AI agent toolkit. Its Durable harness commits every conversation, model turn, and tool call to storage before anything is shown: kill the worker mid-turn, reopen the storage, and it picks up where it stopped. Its `@earendil-works/pi-env` package runs an agent's tools on another machine through a small daemon, which it normally reaches over SSH.

This example points that daemon at a disposable [Tenki](https://tenki.cloud) sandbox, without SSH. That gives you two layers of durability: Pi checkpoints the agent's state, and Tenki pauses and snapshots the machine's.

## Install

```bash
git clone https://github.com/LuxorLabs/cookbook.git
cd cookbook/examples/pi-durable-tenki
npm install
```

Every later command runs from this directory.

`package.json` installs `@earendil-works/pi-durable`, `@earendil-works/pi-env` and `@earendil-works/chord` at `^1.2.0`, and `@tenkicloud/sandbox` at `>=1.4.1`. The example was built against pi-durable 1.2.0 and pi-env 1.2.0. **Both are marked experimental upstream, and their APIs can change between releases.**

Use Node 22.19 or newer, which is what the Pi packages declare in `engines`. On Node 20, `npm install` prints `EBADENGINE` warnings for them, but the verify script still passes (the cookbook's CI runs it on Node 20).

## Authenticate

Create a `tk_` API key at https://app.tenki.cloud and export it:

```bash
export TENKI_API_KEY=tk_...
```

`TENKI_AUTH_TOKEN` works too. `run.mjs` (through `tenki-env.mjs` and `bridge.mjs`) reads the key only from those two variables. `verify.mjs` also falls back to `~/.config/tenki/config.yaml`, where `tenki login --api-key <key>` stores it. So `tenki login` on its own is enough for the verify step, but **not for `run.mjs`**.

## Use it

### Run the demo

```bash
node run.mjs
```

[`run.mjs`](run.mjs) boots a sandbox, runs a command and writes a file through Pi's `ExecutionEnv` surface, pauses the sandbox, then reads the file back through the same env object:

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

You should see:

```text
daemon up: pi-env 1.2.0 on linux/x86_64
exec -> Linux 6.18.29
pausing (snapshot memory + disk, free the VM) ...
resumed -> state the agent built up
```

The first line reports the daemon's pi-env version, so a newer 1.x install prints a different number.

The last line is the point: the read after `pause()` resumes the sandbox, respawns the daemon, and finds the file intact, with no reconnect code at the call site. Pausing takes about a minute (memory + disk snapshot). Recovery on the next call is the resume plus about 0.5 s of bridge and daemon respawn. The `finally` block calls `dispose()`, which closes the connection and terminates the sandbox.

### Plug it into a Durable worker

`createTenkiEnv()` in [`tenki-env.mjs`](tenki-env.mjs) returns a `harnessEnv` function for the harness's `env` option. The hookup in your worker looks like this (it isn't one of the example's files):

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

`storage`, `models`, `registry` and `context` come from your own Pi Durable setup, as in Pi Durable's quick start. The `env` option builds the environment for each tool call. In Pi, equal env `id`s mean the same files, so returning one `RemoteExecutionEnv` per sandbox keeps the agent's `read`/`write`/`edit`/`bash` on one filesystem.

If you copy `tenki-env.mjs` into your own project, **keep `bridge.mjs` in the same directory**: the connection starts it from there. `createTenkiEnv()` takes `{ cpuCores, memoryMb, onLog }`, with defaults of 1 core and 1024 MB. `onLog` receives the daemon's and the bridge's diagnostic output.

## How the bridge works

pi-env's `Connection` spawns a local command (an argv) and speaks its framed protocol over that process's stdin and stdout pipes. Normally that command is `ssh`. Here it's [`bridge.mjs`](bridge.mjs), a 24-line script that starts the daemon inside the sandbox and carries the protocol over Tenki's exec data plane instead:

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

[`tenki-env.mjs`](tenki-env.mjs) does the rest. It boots a sandbox, uploads the static linux-x64 daemon that the pi-env package ships in `bin/` (2.4 MB, about 0.5 s), and returns a `RemoteExecutionEnv` wired through the bridge. The sandbox is resumed lazily, in the `Connection`'s `command` option: an async function that pi-env re-runs on every (re)connect. If it finds the sandbox `PAUSED`, it resumes it before returning the bridge argv, so the next call recovers on its own. From `tenki-env.mjs`:

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

Two daemon behaviors from pi-env's [protocol](https://github.com/earendil-works/pi/blob/main/packages/env/docs/protocol.md) matter here:

- The daemon exits when its stdin ends or after 30 s without traffic, and kills every process group it started, so a dead bridge leaks nothing in the sandbox.
- A reconnect is a fresh daemon session: handles opened before it (readers, running execs) are gone. pi-env's `RequestOptions.session` makes requests on such handles fail cleanly instead of reaching the wrong daemon.

## Check it works

```bash
node verify.mjs
```

```text
✓ pi-durable-tenki: boot + daemon → hello → exec → file round-trip → pause → same env resumes, file intact
```

[`verify.mjs`](verify.mjs) asserts each step: the daemon's hello reports `linux`, `uname -s` exits 0 and prints `Linux`, a marker file round-trips, the sandbox really reaches `PAUSED`, and a read on the same env object brings the marker back and leaves the sandbox `RUNNING`. On the first failed step it prints a `✗` line and exits non-zero. It takes about a minute, most of it the pause. It needs no model key, so it doesn't exercise the Durable harness or an agent turn.

## Troubleshooting

**`missing auth token - set TENKI_AUTH_TOKEN or TENKI_API_KEY or use authToken option`.** `run.mjs` reads the key only from the environment, not from `~/.config/tenki/config.yaml`. Export `TENKI_API_KEY` in the shell you run it from.

**``No token. Set TENKI_API_KEY, or run `tenki login`.``** `verify.mjs` found neither variable and no key in `~/.config/tenki/config.yaml`. Export `TENKI_API_KEY`, or run `tenki login --api-key <key>`.

**`invalid auth token - API keys and service tokens must start with tk_`.** The Tenki SDK accepts only `tk_` keys. Create one at https://app.tenki.cloud.

**`npm warn EBADENGINE Unsupported engine` during `npm install`.** The Pi packages declare Node `>=22.19.0`. On Node 20 these are warnings only, and the verify script still passes. Switch to Node 22.19 or newer to clear them.

**`pi-env connection lost` from a handle (such as a reader) opened before a pause.** The reconnect started a fresh daemon session, and handles belong to the daemon that opened them, so requests on them fail instead of reaching the new one. Open a new handle after the reconnect.

**`bridge: <message>` in the `onLog` output.** The bridge couldn't reach the sandbox, so it exited with code 1 and that daemon start failed cleanly. pi-env tries again on the next request.

## FAQ

**When shouldn't I use this?** When you need a stable API: pi-durable and pi-env are experimental upstream, and their APIs can change between releases. When a command must keep running across a pause or a dropped connection: the daemon kills what it started when its stdin ends, and handles don't survive a reconnect. When pauses must be quick: a pause takes about a minute. And when the agent's tools can run on the worker's own host: Pi's `NodeExecutionEnv` does that without a VM.

**Does pausing lose the agent's files?** No. A paused Tenki sandbox keeps its memory and disk, and pausing is free. `verify.mjs` asserts that a file written before `pause()` reads back intact afterwards.

**Why does the env id include the sandbox id?** In Pi, equal env ids mean the same files at the same paths, and `edit` and `write` serialize changes to one file by env id and path. One id, and one `Connection`, per sandbox keeps that true.

**How do I check a custom env against what Pi expects?** Use `registerEnvConformance()` from `@earendil-works/pi-durable/testing`.

## Related

- [Pi](https://github.com/earendil-works/pi), with the [`pi-durable`](https://github.com/earendil-works/pi/tree/main/packages/durable) and [`pi-env`](https://github.com/earendil-works/pi/tree/main/packages/env) packages
- [pi-env protocol](https://github.com/earendil-works/pi/blob/main/packages/env/docs/protocol.md): frames, liveness, reconnects, and operations
- [`@tenkicloud/sandbox`](https://www.npmjs.com/package/@tenkicloud/sandbox), the Tenki SDK the bridge uses
- [Tenki docs](https://tenki.cloud/docs)
- [`../snapshots-pause-resume/`](../snapshots-pause-resume/): pause and resume a Tenki sandbox with the SDK alone
