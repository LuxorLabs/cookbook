# How to port a Daytona sandbox script to Tenki

Daytona's create, run, capture, and dispose loop runs on a live Tenki sandbox, with a call-by-call map for porting the rest of a script.

About 5 minutes to install, authenticate, and run the Tenki port.

This page runs the Tenki side. The Daytona code is reference, in `run.mjs`'s header comment and in the map below. The scripts run create, `exec`, and close. The file, env, working-directory, `get`, and `list` rows of the map are not run by either script.

## Why bother

[Daytona](https://daytona.io) and [Tenki](https://tenki.cloud) share the same core loop: create a disposable cloud sandbox, run a command, capture its output, dispose of it. Porting that loop to the official [`@tenkicloud/sandbox`](https://www.npmjs.com/package/@tenkicloud/sandbox) SDK is mostly renaming calls. Two changes need thought: Tenki's `exec` doesn't run your command through a shell, and its output comes back as bytes.

This example gives you a runnable port (`run.mjs`), a map from Daytona calls to Tenki calls, and a verify script that checks the port against a live sandbox.

## Install

You need Node.js 20 or later and a Tenki account.

```bash
git clone https://github.com/LuxorLabs/cookbook.git
cd cookbook/examples/daytona-to-tenki-migration
npm install
```

Every later command runs from this directory. `npm install` pulls one direct dependency, `@tenkicloud/sandbox` 1.4.1 or later.

## Authenticate

Create an API key at https://app.tenki.cloud. Keys start with `tk_`. Export it:

```bash
export TENKI_AUTH_TOKEN=tk_...
```

`TENKI_API_KEY` works too. `run.mjs` passes `TENKI_AUTH_TOKEN` to the SDK; when that's unset, the SDK falls back to `TENKI_API_KEY`. `verify.mjs` also falls back to the key that `tenki login --api-key <key>` stores in `~/.config/tenki/config.yaml`. `run.mjs` doesn't read that file, so it needs the environment variable.

`TENKI_WORKSPACE_ID` is optional. A workspace API key implies its workspace, and CI runs `verify.mjs` with only `TENKI_API_KEY` set. Leave it unset unless you use a service credential that needs an explicit scope.

## Use it

```bash
node run.mjs
```

It prints:

```
hello from tenki · exit 0
```

`run.mjs` is the whole port. Its header comment is the Daytona script it replaces, and each step has a comment naming the Daytona call it stands in for:

```js
// The Tenki port of a typical Daytona script: create -> run a command -> capture output -> dispose.
// Daytona (for reference):
//   import { Daytona } from "@daytonaio/sdk";
//   const daytona = new Daytona({ apiKey: process.env.DAYTONA_API_KEY });   // or implicit DAYTONA_API_KEY
//   const sandbox = await daytona.create();
//   const r = await sandbox.process.executeCommand("echo hello from daytona"); // runs via a shell
//   console.log(r.result.trim(), "· exit", r.exitCode);
//   await daytona.delete(sandbox);
import { TenkiSandbox, stdoutText } from "@tenkicloud/sandbox";

// Daytona: new Daytona({ apiKey }) (or implicit DAYTONA_API_KEY). Tenki: pass the token explicitly.
const tenki = new TenkiSandbox({ authToken: process.env.TENKI_AUTH_TOKEN });

// Daytona: daytona.create(). Tenki: createAndWait() boots the sandbox and waits until it's ready.
const sandbox = await tenki.createAndWait({
  cpuCores: 1,
  memoryMb: 1024,
  workspaceId: process.env.TENKI_WORKSPACE_ID,
});

try {
  // Daytona's process.executeCommand("echo ...") runs through a shell. Tenki's exec() runs a bare
  // binary + args (no shell splitting) — wrap shell syntax in `sh -c` yourself.
  const result = await sandbox.exec("sh", { args: ["-c", "echo hello from tenki"] });

  // Daytona: result.result is a string. Tenki: result.stdout is bytes — decode with stdoutText().
  console.log(stdoutText(result).trim(), "· exit", result.exitCode); // hello from tenki · exit 0
} finally {
  // Daytona: await daytona.delete(sandbox). Tenki: close() terminates the sandbox (so does `await using`).
  await sandbox.close();
}
```

## Map your Daytona calls to Tenki

The Daytona column was checked against `@daytonaio/sdk` 0.224.1 and the Tenki column against `@tenkicloud/sandbox` 1.4.1. Daytona has renamed the package `@daytona/sdk` with the same API, so if your code imports `@daytona/sdk`, the same rows apply under that name.

| Concept | Daytona (`@daytonaio/sdk`) | Tenki (`@tenkicloud/sandbox`) |
| --- | --- | --- |
| Install | `npm i @daytonaio/sdk` | `npm i @tenkicloud/sandbox` |
| Import | `import { Daytona } from "@daytonaio/sdk"` | `import { TenkiSandbox, stdoutText } from "@tenkicloud/sandbox"` |
| Auth | `new Daytona({ apiKey })` (or implicit `DAYTONA_API_KEY`) | `new TenkiSandbox({ authToken })` (or implicit `TENKI_AUTH_TOKEN` / `TENKI_API_KEY`) |
| Create | `await daytona.create()` | `await tenki.createAndWait({ cpuCores, memoryMb, workspaceId })` (`workspaceId` optional) |
| Run a command | `await sandbox.process.executeCommand("ls -la")` (shell) | `await sandbox.exec("ls", { args: ["-la"] })` (no shell, see below) |
| Run a code snippet | `await sandbox.process.codeRun("print(6 * 7)")` | `await sandbox.exec("python3", { args: ["-c", "print(6 * 7)"] })` |
| stdout / stderr | `r.result` (string) | `stdoutText(r)` / `stderrText(r)` (decode the byte fields) |
| Exit code | `r.exitCode` | `r.exitCode` |
| Env vars | `executeCommand(cmd, cwd, env)` or `create({ envVars })` | `exec(cmd, { env })` or `createAndWait({ env })` |
| Working dir | `executeCommand(cmd, cwd)` | `exec(cmd, { cwd })` |
| Write a file | `await sandbox.fs.uploadFile(Buffer.from(data), path)` | `await sandbox.writeFile(path, data)` (path under `/home/tenki`) |
| Read a file | `await sandbox.fs.downloadFile(path)` (Buffer) | `await sandbox.readFile(path)` (`Uint8Array`, path under `/home/tenki`) |
| Sandbox ID | `sandbox.id` | `sandbox.id` |
| Reconnect | `await daytona.get(id)` | `await tenki.get(id)` |
| List sandboxes | `for await (const s of daytona.list())` (async iterator) | `await tenki.list()` (array) |
| Dispose | `await daytona.delete(sandbox)` | `await sandbox.close()` (or `await using`, Node 24+) |

The other differences to know:

- **Output is bytes.** `ExecResult.stdout` and `.stderr` are `Uint8Array`. Decode them with `stdoutText(r)` / `stderrText(r)`. Daytona hands you a `result` string; Tenki's result has no `result` field.
- **Auth.** Daytona reads `DAYTONA_API_KEY` implicitly or through `new Daytona({ apiKey })`. Tenki takes `authToken` on the client, or reads `TENKI_AUTH_TOKEN` / `TENKI_API_KEY` when you don't pass one. The key must start with `tk_`. `workspaceId` on `createAndWait` is optional, because a workspace API key implies its workspace.
- **Disposal and billing.** `await sandbox.close()` terminates the sandbox, like Daytona's `daytona.delete(sandbox)`. Sandboxes are [billed per second](https://tenki.cloud/docs/pricing). A sandbox you don't close keeps running, and billing, until it reaches its lifetime cap (sticky sandboxes have none and run until terminated). Pass `maxDurationMs` to `createAndWait` to set that cap yourself.
- **Outbound network is on by default.** Pass `allowOutbound: false` to `createAndWait` to isolate a sandbox.
- **File methods stay in `/home/tenki`.** `writeFile` and `readFile` are confined to `/home/tenki`, the sandbox's working directory. Relative paths resolve there. An absolute path outside it, such as `/tmp/...`, fails. A shell command run with `exec` can write anywhere.
- **`await using` and Node version.** `Session` is an `AsyncDisposable`, so you can write `await using sandbox = await tenki.createAndWait(...)` and let the scope terminate it. Top-level `await using` needs Node 24 or later; Node 22 can't parse it. `run.mjs` and `verify.mjs` call `close()` in a `finally` block instead, so they run on Node 20, which CI uses.

## The one gotcha: `exec` doesn't use a shell

Daytona's `process.executeCommand("echo $HOME && ls")` runs your string through a shell, so pipes, globs, `&&`, and `$VARS` work. Tenki's `exec(command, { args })` runs a bare binary with an argument array, and nothing in it is interpreted. To port a shell command, ask for a shell with `sh -c`. From `verify.mjs`:

```js
  // Daytona: sandbox.process.executeCommand("...") runs via a shell. Tenki: exec() runs a bare
  // binary + args, so port a shell command by wrapping it in `sh -c`.
  const shell = await sandbox.exec("sh", { args: ["-c", "echo hello-from-tenki"] });
```

Daytona's other runner, `process.codeRun("print(6 * 7)")`, sends a code snippet to the sandbox's language runtime. On Tenki, call the interpreter as a bare binary. No shell is needed. From `verify.mjs`:

```js
  // Daytona: sandbox.process.codeRun("print(6 * 7)") runs a code snippet. Tenki: run the
  // interpreter directly as a bare binary + args (no shell needed).
  const py = await sandbox.exec("python3", { args: ["-c", "print(6 * 7)"] });
```

## Check it works

```bash
node verify.mjs
```

On success it prints one line. The eight characters in parentheses are the start of the sandbox ID:

```
✓ daytona-to-tenki-migration: create (<id>…) → exec sh + python3 → "hello-from-tenki" / 42 → dispose
```

`verify.mjs` creates a live sandbox, runs `echo` through `sh -c` and `python3` as a bare binary, checks each exit code and decoded stdout, then closes the sandbox in a `finally` block. It exits non-zero on any failure. CI runs it on Node 20. It proves the Tenki side of the port works. It doesn't run any Daytona code, doesn't call the file, env, `get`, or `list` methods in the map, and prints the `✓` line before `close()` runs, so a failed close doesn't fail the check.

## Troubleshooting

**``No token. Set TENKI_AUTH_TOKEN, or run `tenki login`.``** `verify.mjs` found no key in `TENKI_AUTH_TOKEN`, `TENKI_API_KEY`, or `~/.config/tenki/config.yaml`. Export a `tk_` key, or run `tenki login --api-key <key>`.

**`missing auth token - set TENKI_AUTH_TOKEN or TENKI_API_KEY or use authToken option`.** The SDK found no key when `run.mjs` created its client. `run.mjs` reads only the environment, not `~/.config/tenki/config.yaml`, so a `tenki login` alone isn't enough. Export `TENKI_AUTH_TOKEN` or `TENKI_API_KEY`.

**`invalid auth token - API keys and service tokens must start with tk_`.** The value you passed isn't a Tenki API key. Create one at https://app.tenki.cloud.

**Pipes, `&&`, globs, or `$VARS` in a ported command don't work.** `exec` runs a bare binary with arguments and no shell. Wrap the command in `sh -c`, as `verify.mjs` does.

**`r.result` is `undefined`, or stdout comes back as bytes.** Tenki's `ExecResult` has `stdout` and `stderr` as `Uint8Array` and no `result` field. Use `stdoutText(r)` / `stderrText(r)`.

**`permission_denied … path outside workdir` from `writeFile` or `readFile`.** The SDK's file methods are confined to `/home/tenki`. Use a path under `/home/tenki` (relative paths resolve there), or write elsewhere with a shell command through `exec`.

## FAQ

**When shouldn't I use this?** When your Daytona code is Python: this example is Node only. Tenki's Python SDK is `tenki` (`pip install tenki`, `from tenki import …`). Also when your script depends on Daytona features beyond the rows in the map, which this example doesn't cover. And don't read a passing `verify.mjs` as proof of the whole map: it runs create, `exec`, and close only.

**What happens if my script exits without calling `close()`?** The sandbox keeps running, and billing, until it reaches its lifetime cap (sticky sandboxes have none and run until terminated). Find it with `await tenki.list()` (it returns every non-terminated sandbox in the workspace), or `await tenki.get(id)` if you logged the ID, and call `close()` on it. Pass `maxDurationMs` to `createAndWait` to set the cap yourself on future sandboxes.

## Related

- [`@tenkicloud/sandbox` on npm](https://www.npmjs.com/package/@tenkicloud/sandbox), the SDK this port uses
- [`@daytonaio/sdk` on npm](https://www.npmjs.com/package/@daytonaio/sdk), its renamed successor [`@daytona/sdk`](https://www.npmjs.com/package/@daytona/sdk), and [daytona.io](https://daytona.io)
- [Tenki docs](https://tenki.cloud/docs) and [tenki.cloud](https://tenki.cloud)
- [E2B to Tenki](../e2b-to-tenki-migration/), the same port from E2B's SDK
- [Modal to Tenki](../modal-to-tenki-migration/), the same loop ported from Modal to the Python SDK
