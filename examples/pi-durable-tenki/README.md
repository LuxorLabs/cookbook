# Pi Durable's execution env on Tenki

[Pi](https://github.com/earendil-works/pi) is an AI agent toolkit whose Durable harness (`@earendil-works/pi-durable`) commits every conversation, model turn, and tool call to storage before anything is shown — kill the worker mid-turn, reopen the storage, and it picks up where it stopped. Its `@earendil-works/pi-env` package runs an agent's tools on another machine through a small daemon; this example points that daemon at a disposable [Tenki](https://tenki.cloud) microVM. Two layers of durability: Pi checkpoints the agent's state, Tenki pauses and snapshots the machine's.

## The bridge (`bridge.mjs`)

pi-env normally reaches its daemon over SSH, but Tenki doesn't need SSH. pi-env's `Connection` spawns a local command (an argv) and speaks its framed protocol over that process's stdin and stdout pipes. So a ~20-line bridge can start the daemon inside the sandbox and carry that protocol over Tenki's exec data plane instead:

```js
const [sessionId, ...daemonArgs] = process.argv.slice(2);
const session = await new TenkiSandbox({ authToken }).get(sessionId);
const handle = session.run(["/home/tenki/pi-env", ...daemonArgs], {
	stdin: Readable.toWeb(process.stdin),
});
handle.stdout.pipeTo(Writable.toWeb(process.stdout)).catch(() => {});
handle.stderr.pipeTo(Writable.toWeb(process.stderr)).catch(() => {});
process.exit((await handle).exitCode ?? 1);
```

[`tenki-env.mjs`](tenki-env.mjs) does the rest: boot a microVM, upload the static linux-x64 daemon the pi-env package ships in `bin/` (2.4 MB, ~0.5 s), and return a `RemoteExecutionEnv` wired through the bridge. The sandbox is resumed lazily, in the `Connection`'s `command` option: an async function that pi-env re-runs on every (re)connect. If it finds the sandbox `PAUSED`, it resumes it before returning the bridge argv, so the next call recovers on its own.

## Hook it into a Durable worker

```js
import { Harness } from "@earendil-works/pi-durable";
import { createTenkiEnv } from "./tenki-env.mjs";

const tenkiEnv = await createTenkiEnv();
const harness = await Harness.open(storage, {
	models,
	registry,
	env: tenkiEnv.harnessEnv, // every tool call now runs in the microVM
}, context);
// at shutdown: await tenkiEnv.dispose();
```

The `env` option builds the environment for each tool call. In Pi, equal env `id`s mean the same files, so returning one `RemoteExecutionEnv` per sandbox keeps the agent's `read`/`write`/`edit`/`bash` on one filesystem. Running an agent turn needs a model provider and key (see Pi's quick start); the commands below don't.

## Run it

```bash
npm install
export TENKI_API_KEY=tk_...      # or `tenki login --api-key <key>` (stores it in ~/.config/tenki/config.yaml)
node run.mjs
```

```text
daemon up: pi-env 1.2.0 on linux/x86_64
exec -> Linux 6.18.29
pausing (snapshot memory + disk, free the VM) ...
resumed -> state the agent built up
```

The last line is the point: the read after `pause()` resumes the sandbox, respawns the daemon, and finds the file intact — no reconnect code at the call site.

## Verify

```bash
node verify.mjs   # ✓ pi-durable-tenki: boot + daemon → hello → exec → file round-trip → pause → same env resumes, file intact
```

`verify.mjs` reads the token from `TENKI_AUTH_TOKEN` / `TENKI_API_KEY` or `~/.config/tenki/config.yaml`, and asserts each step, including that the sandbox really reached `PAUSED` before the recovery.

## Notes

- Pausing takes about a minute (memory + disk snapshot); recovery on the next call is the resume plus ~0.5 s of bridge and daemon respawn.
- A reconnect is a fresh daemon session: handles opened before it (readers, running execs) are gone. pi-env's `RequestOptions.session` makes requests on such handles fail cleanly instead of reaching the wrong daemon.
- The daemon exits when its stdin ends or after 30 s without traffic, so a dead bridge leaks nothing in the sandbox.
- A custom env can self-check with `registerEnvConformance()` from `@earendil-works/pi-durable/testing`.
- Built against `@earendil-works/pi-durable` 1.2.0 and `@earendil-works/pi-env` 1.2.0 — marked experimental upstream, APIs can change between releases. Requires Node 20+ (the Tenki SDK's gRPC transport depends on it).
