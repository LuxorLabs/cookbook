# Pi Durable

Give a long-running AI agent a cloud machine for its commands and files, and pause that machine for free whenever the agent is idle.

[Pi](https://github.com/earendil-works/pi) is an open-source toolkit for building AI agents. Two of its packages matter here:

- **Pi Durable** (`@earendil-works/pi-durable`) runs agents that survive crashes and restarts. It saves every conversation, model reply, and tool call to storage as it happens, so if the process dies mid-task, reopening the storage picks up where it stopped.
- **pi-env** (`@earendil-works/pi-env`) lets that agent's tools (running commands, reading and writing files) act on another machine instead of yours. It copies a small helper program, the **daemon**, to that machine and talks to it, normally over SSH.

This example makes the other machine a Tenki sandbox and replaces SSH with Tenki's own API. Pi keeps the agent's memory safe in storage, and Tenki can pause the sandbox between tasks, which saves its memory and disk and stops billing. The next time the agent touches the sandbox, it resumes on its own.

The demo needs no model key: it runs a command and writes a file the way an agent's tools would, pauses the sandbox, and reads the file back.

Pi Durable and pi-env are experimental, and their APIs can change between releases. This example was built against 1.2.0.

## Set it up with a coding agent

Paste this into Claude Code, Codex, Cursor, or another coding agent:

```text
Set up the Tenki "Pi Durable" example from https://github.com/LuxorLabs/cookbook.
1. Clone the repo, cd into examples/pi-durable-tenki, check that Node.js is 22.19 or later, and run npm install.
2. It needs TENKI_API_KEY (a Tenki key starting with tk_, from https://app.tenki.cloud) in the environment. If it isn't set, stop and ask me to export it. Never print the key or write it to a file.
3. Run node run.mjs (the pause takes about a minute) and confirm the last line is "resumed -> state the agent built up", then run node verify.mjs.
4. If a step fails, use the Troubleshooting table in the example's README.md.
Then show me how to plug tenki-env.mjs and bridge.mjs into my Pi Durable worker through the harness env option.
```

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

The pause takes about a minute. The read after it resumes the sandbox, restarts the daemon in about 0.5 s, and finds the file. The script deletes the sandbox at the end.

### 4. Verify

```bash
node verify.mjs
```

```text
✓ pi-durable-tenki: boot + daemon → hello → exec → file round-trip → pause → same env resumes, file intact
```

`verify.mjs` checks that the daemon reports `linux`, `uname -s` prints `Linux`, a file written to the sandbox reads back the same, the sandbox reaches `PAUSED`, and a read afterwards returns the file and leaves the sandbox `RUNNING`. It needs no model key, so it doesn't run a real agent.

## How it works

1. **`tenki-env.mjs`** starts a sandbox, copies the pi-env daemon into it, and returns an **env**: the object Pi's tools call to run commands and read or write files.
2. **pi-env** talks to the daemon by starting a local command and sending messages through that command's input and output. Normally the command is `ssh`. Here it's **`bridge.mjs`**, which starts the daemon inside the sandbox through Tenki's API and passes the messages back and forth.
3. Before each connection, `tenki-env.mjs` checks whether the sandbox is paused and resumes it if so. That's why a call after a pause just works.

A few terms you'll see in the code:

- **`env.exec()`, `env.writeFile()`, `env.readTextFile()`** are what Pi's tools call. Each returns a result object, and `getOrThrow()` unwraps it or throws the error.
- **`BACKGROUND_CONTEXT`** is the context argument every env call takes. Inside an agent, Pi supplies its own; a standalone script like this one passes this default.
- **`harnessEnv`** is the same env in the shape Pi Durable's `Harness` expects (see [Use it in a Durable worker](#use-it-in-a-durable-worker)).

## The demo

`run.mjs`:

```js
// Run commands and write a file in a Tenki sandbox through Pi Durable's env
// interface, pause the sandbox, and show the next call picks up where it left off.
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

In a real agent, Pi Durable's `Harness` runs the conversation and calls tools. Pass it `harnessEnv` as its `env` option, and every tool call runs in the sandbox:

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
- Use one env id and one `Connection` per sandbox. Pi assumes two envs with the same id share files, and it orders `edit` and `write` calls by env id and path.
- Check a custom env against Pi's expectations with `registerEnvConformance()` from `@earendil-works/pi-durable/testing`.

## How the bridge works

pi-env's `Connection` starts a local command and exchanges messages with the daemon through that command's standard input and output. Normally the command is `ssh`. Here it's `bridge.mjs`, which starts the daemon in the sandbox with Tenki's command API and connects the two streams:

```js
#!/usr/bin/env node
// pi-env starts this script as: node bridge.mjs <sessionId> serve --token <hex>
// It starts the pi-env daemon inside the Tenki sandbox and connects the daemon's
// input and output to this process's, using Tenki's command API instead of SSH.
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
  // If the sandbox can't be reached, exit with an error; pi-env tries again on the next request.
  console.error(`bridge: ${err?.message ?? err}`);
  process.exit(1);
}
```

`tenki-env.mjs` uploads the daemon (a 2.4 MB Linux program that ships inside the pi-env package) and creates a `RemoteExecutionEnv` that connects through the bridge. pi-env calls the `command` option on every reconnect, so a paused sandbox is resumed before the bridge starts:

```js
  // The pi-env package ships a static linux-x64 daemon that runs on Tenki's stock image.
  const daemon = join(dirname(require.resolve("@earendil-works/pi-env")), "../bin/pi-env-linux-x64/pi-env");
  await session.writeFile("/home/tenki/pi-env", readFileSync(daemon));
  await session.exec(["chmod", "+x", "/home/tenki/pi-env"]);

  // pi-env calls `command` every time it (re)connects. Resuming a paused sandbox here
  // means the next call after a pause just works, with no extra code in the agent.
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

  // Pi treats two envs with the same id as sharing files, so use one id (and one Connection) per sandbox.
  const env = new RemoteExecutionEnv({
    connection,
    id: `pi-env:tenki:${session.id}`,
    cwd: "/home/tenki",
  });
```

Daemon behavior to know, from pi-env's [protocol](https://github.com/earendil-works/pi/blob/main/packages/env/docs/protocol.md):

- The daemon exits when its connection closes or after 30 s with no messages, and stops every process it started. Nothing is left running if the bridge dies, but a running command doesn't survive a pause or a dropped connection.
- A reconnect starts a new daemon. Anything opened before it, such as a file reader or a running command, fails with an error instead of reaching the new daemon.

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
