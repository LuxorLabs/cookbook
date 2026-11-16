# E2B to Luxor Agent Cloud

Port an [E2B](https://e2b.dev) sandbox script to Luxor Agent Cloud. The core loop is the same on both: create a sandbox, run a command, read the output, dispose. This folder has a runnable Luxor Agent Cloud port, an API map, and the behavior differences you will hit.

The one change that breaks most ports: E2B's `commands.run` passes your string to a shell, and Luxor Agent Cloud's `exec` runs a binary with an argument array and no shell. Wrap commands that use pipes, globs, `&&`, or `$VARS` in `sh -c`. See [`exec` doesn't use a shell](#exec-doesnt-use-a-shell).

## Set it up with a coding agent

Paste this into Claude Code, Codex, Cursor, or another coding agent:

```text
Help me move my E2B sandbox code to Luxor Agent Cloud, using the guide at https://github.com/LuxorLabs/cookbook/tree/main/examples/e2b-to-luxor-migration.
1. Clone https://github.com/LuxorLabs/cookbook, cd into examples/e2b-to-luxor-migration, and run npm install (Node.js 20 or later).
2. The scripts need a Luxor Agent Cloud API key (starts with tk_) in LUXORAI_AUTH_TOKEN. If it isn't set, stop and ask me to export it (keys come from https://app.luxor.ai). Never print the key or write it to a file.
3. Run node run.mjs and confirm it prints "hello from luxor · exit 0", then run node verify.mjs.
4. Read the API map and "Other differences" in that README.md. Then find every E2B call in my project and port it to @luxorai/sandbox. Wrap any command string that relies on a shell (pipes, &&, globs, $VARS) in sh -c, decode stdout/stderr with stdoutText/stderrText, check exitCode instead of catching CommandExitError, and make sure every sandbox is closed.
5. Show me the diff before you change anything you're unsure about.
```

## Quick start

You need:

- Node.js 20 or later. The scripts use `try`/`finally`, not `await using`.
- A Luxor Agent Cloud API key (`tk_...`) from [app.luxor.ai](https://app.luxor.ai).

### 1. Install

```bash
git clone https://github.com/LuxorLabs/cookbook.git
cd cookbook/examples/e2b-to-luxor-migration
npm install
```

This installs `@luxorai/sandbox` 1.5.2 or later. It does not install `e2b`; the E2B code here is for comparison.

### 2. Set your API key

```bash
export LUXORAI_AUTH_TOKEN=tk_...   # LUXORAI_API_KEY also works
```

`run.mjs` reads the key from the environment only. `verify.mjs` also accepts a key saved with `luxor login --api-key <key>`. `LUXORAI_WORKSPACE_ID` is optional.

### 3. Run the port

```bash
node run.mjs
```

```text
hello from luxor · exit 0
```

### 4. Verify

```bash
node verify.mjs
```

```text
✓ e2b-to-luxor-migration: create (01a13d9d…) → exec sh + python3 → "hello-from-luxor" / 42 → dispose
```

The characters in parentheses start your sandbox's ID. `verify.mjs` runs `echo hello-from-luxor` through `sh -c` and `python3 -c "print(6 * 7)"` as a bare binary, asserts both outputs and exit codes, then closes the sandbox.

## The port

`run.mjs`, with each E2B equivalent in a comment:

```js
// The Luxor Agent Cloud port of a typical E2B script: create -> run a command -> capture output -> dispose.
// E2B (for reference):
//   import { Sandbox } from "e2b";
//   const sandbox = await Sandbox.create();                       // reads E2B_API_KEY
//   const r = await sandbox.commands.run("echo hello from e2b");  // runs via a shell
//   console.log(r.stdout.trim(), "· exit", r.exitCode);
//   await sandbox.kill();
import { LuxorSandbox, stdoutText } from "@luxorai/sandbox";

// E2B: auth is implicit via E2B_API_KEY. Luxor Agent Cloud: pass the token explicitly.
const luxor = new LuxorSandbox({ authToken: process.env.LUXORAI_AUTH_TOKEN || process.env.TENKI_AUTH_TOKEN });

// E2B: Sandbox.create(). Luxor Agent Cloud: createAndWait() boots the sandbox and waits until it's ready.
const sandbox = await luxor.createAndWait({
  cpuCores: 1,
  memoryMb: 1024,
  workspaceId: process.env.LUXORAI_WORKSPACE_ID || process.env.TENKI_WORKSPACE_ID,
});

try {
  // E2B's commands.run("echo ...") runs through a shell. Luxor Agent Cloud's exec() runs a bare
  // binary + args (no shell splitting) — wrap shell syntax in `sh -c` yourself.
  const result = await sandbox.exec("sh", { args: ["-c", "echo hello from luxor"] });

  // E2B: result.stdout is a string. Luxor Agent Cloud: result.stdout is bytes — decode with stdoutText().
  console.log(stdoutText(result).trim(), "· exit", result.exitCode); // hello from luxor · exit 0
} finally {
  // E2B: await sandbox.kill(). Luxor Agent Cloud: close() terminates the sandbox (so does `await using`).
  await sandbox.close();
}
```

## API map

The E2B column matches the `e2b` 2.56.0 JavaScript SDK.

| Concept | E2B (`e2b`) | Luxor Agent Cloud (`@luxorai/sandbox`) |
| --- | --- | --- |
| Install | `npm i e2b` | `npm i @luxorai/sandbox` |
| Import | `import { Sandbox } from "e2b"` | `import { LuxorSandbox, stdoutText, stderrText } from "@luxorai/sandbox"` |
| Auth | `E2B_API_KEY`, read implicitly | `new LuxorSandbox({ authToken })`; without it, the SDK reads `LUXORAI_AUTH_TOKEN`, then `LUXORAI_API_KEY` |
| Create | `await Sandbox.create()` | `await luxor.createAndWait({ cpuCores, memoryMb })` (`workspaceId` optional) |
| Run a command | `await sandbox.commands.run("ls -la")` (shell) | `await sandbox.exec("ls", { args: ["-la"] })` (no shell) |
| stdout / stderr | `r.stdout` / `r.stderr` (strings) | `stdoutText(r)` / `stderrText(r)` (decode bytes) |
| Exit code | `r.exitCode`; non-zero throws `CommandExitError` | `r.exitCode`; non-zero does not throw |
| Env vars | `commands.run(cmd, { envs })` | `exec(cmd, { env })` or `createAndWait({ env })` |
| Working dir | `commands.run(cmd, { cwd })` | `exec(cmd, { cwd })` |
| Write a file | `await sandbox.files.write(path, data)` | `await sandbox.writeFile(path, data)` (under `/home/tenki` only) |
| Read a file | `await sandbox.files.read(path)` (string by default) | `await sandbox.readFile(path)` (`Uint8Array`, under `/home/tenki` only) |
| Sandbox ID | `sandbox.sandboxId` | `sandbox.id` |
| Reconnect | `await Sandbox.connect(id)` | `await luxor.get(id)` |
| List sandboxes | `Sandbox.list()` paginator, `await paginator.nextItems()` | `await luxor.list()` |
| Timeout | `Sandbox.create({ timeoutMs })` | `createAndWait({ maxDurationMs })` (lifetime cap) |
| No outbound network | `Sandbox.create({ allowInternetAccess: false })` | `createAndWait({ allowOutbound: false })` |
| Dispose | `await sandbox.kill()` | `await sandbox.close()` (or `await using` on Node 24+) |

## `exec` doesn't use a shell

```js
// E2B
await sandbox.commands.run("echo $HOME && ls /tmp");

// Luxor Agent Cloud — ask for a shell explicitly
await sandbox.exec("sh", { args: ["-c", "echo $HOME && ls /tmp"] });

// Luxor Agent Cloud — a single binary needs no shell at all
await sandbox.exec("python3", { args: ["-c", "print(6 * 7)"] });
```

## Other differences

- **Output is bytes.** `stdout`, `stderr`, and `readFile` return `Uint8Array`. Use `stdoutText()`/`stderrText()` or a `TextDecoder`.
- **A non-zero exit doesn't throw.** Check `r.exitCode`. A `catch` for `CommandExitError` no longer runs.
- **Keys start with `tk_`.** SDK 1.x accepts nothing else.
- **File methods are confined to `/home/tenki`.** Commands run with `exec` can write anywhere.
- **Outbound network is on by default.** Pass `allowOutbound: false` to isolate a sandbox.
- **Set a lifetime cap if you relied on `timeoutMs`.** Luxor Agent Cloud doesn't pause idle sandboxes, and a sandbox keeps running (and billing per second) if your process dies before `close()`. Pass `maxDurationMs` with the same value. `run.mjs` doesn't set one.

## Troubleshooting

| Problem | Fix |
| --- | --- |
| ``No token. Set LUXORAI_AUTH_TOKEN, or run `luxor login`.`` | `verify.mjs` found no key. Export one or run `luxor login --api-key <key>`. |
| `missing auth token - set LUXORAI_AUTH_TOKEN or LUXORAI_API_KEY ...` | `run.mjs` reads only the environment. Export the key. |
| `invalid auth token - API keys and service tokens must start with tk_` | Create a `tk_` key at [app.luxor.ai](https://app.luxor.ai). |
| `TypeError: r.stdout.trim is not a function` | Decode with `stdoutText(r)`. |
| A ported shell command doesn't run | Wrap it: `sandbox.exec("sh", { args: ["-c", "<command>"] })`. |
| `permission_denied … path outside workdir` | Keep SDK file paths under `/home/tenki`. |
| `SyntaxError` at `await using` | Use Node 24, or `try`/`finally` with `close()` as `run.mjs` does. |

This guide maps the JavaScript SDKs. Luxor Agent Cloud's Python SDK is [`tenki`](https://pypi.org/project/tenki/). To keep both providers behind one interface instead of porting, see [ComputeSDK](../computesdk-luxor/).

## Related

- [Modal to Luxor Agent Cloud](../modal-to-luxor-migration/) and [Daytona to Luxor Agent Cloud](../daytona-to-luxor-migration/)
- [ComputeSDK](../computesdk-luxor/): one interface in front of Luxor Agent Cloud, E2B, and other providers
- [Work with files](../files-in-a-sandbox/)
- [`@luxorai/sandbox` on npm](https://www.npmjs.com/package/@luxorai/sandbox) and the [Luxor Agent Cloud docs](https://luxor.ai/docs)
