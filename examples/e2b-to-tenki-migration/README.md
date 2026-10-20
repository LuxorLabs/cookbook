# How to migrate an E2B sandbox script to Tenki

**Audience:** JavaScript developers with Node.js code on E2B's `e2b` SDK who want to run it on Tenki.
**Time:** ~5 minutes, most of it creating an API key. In CI, `npm install` plus `node verify.mjs` takes about 5 seconds.
**Outcome:** `node run.mjs` runs a command in a Tenki sandbox and prints `hello from tenki · exit 0`, `node verify.mjs` prints a `✓` line, and you have an API map for porting the rest of your E2B code.

> **Honesty note:** Tenki's `exec` runs a binary with an argument array and no shell. E2B's `commands.run` passes your string to a shell. A ported command that uses pipes, globs, `&&` or `$VARS` has to be wrapped in `sh -c`, or it won't do what it did on E2B. See [The one gotcha](#the-one-gotcha-exec-doesnt-shell-split).

## Why bother

Moving code from [E2B](https://e2b.dev) to [Tenki](https://tenki.cloud) is a small, mechanical change. Both give you a disposable cloud sandbox with the same core loop: create, run a command, capture output, dispose. On Tenki you run that loop with the official [`@tenkicloud/sandbox`](https://www.npmjs.com/package/@tenkicloud/sandbox) SDK.

This example gives you a runnable Tenki port of a typical E2B script, an API map, and the behavior differences you'll hit while porting.

## Install

```bash
git clone https://github.com/LuxorLabs/cookbook.git
cd cookbook/examples/e2b-to-tenki-migration
npm install
```

Every later command runs from this directory.

`package.json` installs one dependency, `@tenkicloud/sandbox` 1.4.1 or newer. It doesn't install `e2b`. The E2B code on this page is there for comparison, and nothing in the example runs it.

You need Node.js 20 or newer. CI runs `verify.mjs` on Node 20, and the SDK's `@connectrpc/connect-node` dependency declares `>=20`. `run.mjs` and `verify.mjs` dispose of the sandbox with `try`/`finally` and `close()` rather than `await using`, so they don't need Node 24.

## Authenticate

You need a Tenki `tk_` API key. Create one at https://app.tenki.cloud, then export it:

```bash
export TENKI_AUTH_TOKEN=tk_...
```

`run.mjs` passes `process.env.TENKI_AUTH_TOKEN` to `new TenkiSandbox()`. If that variable is unset, the SDK falls back to `TENKI_API_KEY`, so either name works. `run.mjs` doesn't read `~/.config/tenki/config.yaml`, where `tenki login --api-key <key>` stores your key. `verify.mjs` does.

You don't need `TENKI_WORKSPACE_ID`. Tenki infers the workspace from a workspace API key. `run.mjs` passes `TENKI_WORKSPACE_ID` as `workspaceId` if you set it, which only matters for service credentials that need an explicit scope.

## Use it

`run.mjs` is the Tenki port. Its header comment is the E2B script it replaces, and each step has a comment with the E2B equivalent:

```js
// The Tenki port of a typical E2B script: create -> run a command -> capture output -> dispose.
// E2B (for reference):
//   import { Sandbox } from "e2b";
//   const sandbox = await Sandbox.create();                       // reads E2B_API_KEY
//   const r = await sandbox.commands.run("echo hello from e2b");  // runs via a shell
//   console.log(r.stdout.trim(), "· exit", r.exitCode);
//   await sandbox.kill();
import { TenkiSandbox, stdoutText } from "@tenkicloud/sandbox";

// E2B: auth is implicit via E2B_API_KEY. Tenki: pass the token explicitly.
const tenki = new TenkiSandbox({ authToken: process.env.TENKI_AUTH_TOKEN });

// E2B: Sandbox.create(). Tenki: createAndWait() boots the sandbox and waits until it's ready.
const sandbox = await tenki.createAndWait({
  cpuCores: 1,
  memoryMb: 1024,
  workspaceId: process.env.TENKI_WORKSPACE_ID,
});

try {
  // E2B's commands.run("echo ...") runs through a shell. Tenki's exec() runs a bare
  // binary + args (no shell splitting) — wrap shell syntax in `sh -c` yourself.
  const result = await sandbox.exec("sh", { args: ["-c", "echo hello from tenki"] });

  // E2B: result.stdout is a string. Tenki: result.stdout is bytes — decode with stdoutText().
  console.log(stdoutText(result).trim(), "· exit", result.exitCode); // hello from tenki · exit 0
} finally {
  // E2B: await sandbox.kill(). Tenki: close() terminates the sandbox (so does `await using`).
  await sandbox.close();
}
```

Run it:

```bash
node run.mjs
```

```text
hello from tenki · exit 0
```

`createAndWait()` boots a sandbox with 1 CPU core and 1024 MB of memory and waits until it's ready. `exec` runs `echo` through `sh -c`, `stdoutText()` decodes the output bytes, and the `finally` block terminates the sandbox even if a step throws.

## Port your own script

### API map

The E2B column matches the `e2b` 2.56.0 JavaScript SDK on npm.

| Concept | E2B (`e2b`) | Tenki (`@tenkicloud/sandbox`) |
| --- | --- | --- |
| Install | `npm i e2b` | `npm i @tenkicloud/sandbox` |
| Import | `import { Sandbox } from "e2b"` | `import { TenkiSandbox, stdoutText, stderrText } from "@tenkicloud/sandbox"` |
| Auth | `E2B_API_KEY` env var, read implicitly | `new TenkiSandbox({ authToken })`; with no `authToken`, the SDK reads `TENKI_AUTH_TOKEN`, then `TENKI_API_KEY` |
| Create | `await Sandbox.create()` | `await tenki.createAndWait({ cpuCores, memoryMb })` (`workspaceId` optional) |
| Run a command | `await sandbox.commands.run("ls -la")` (shell) | `await sandbox.exec("ls", { args: ["-la"] })` (no shell, see [the gotcha](#the-one-gotcha-exec-doesnt-shell-split)) |
| stdout / stderr | `r.stdout` / `r.stderr` (strings) | `stdoutText(r)` / `stderrText(r)` (decode the byte fields) |
| Exit code | `r.exitCode`; a non-zero exit throws `CommandExitError` | `r.exitCode`; a non-zero exit doesn't throw |
| Env vars | `commands.run(cmd, { envs })` | `exec(cmd, { env })` or `createAndWait({ env })` |
| Working dir | `commands.run(cmd, { cwd })` | `exec(cmd, { cwd })` |
| Write a file | `await sandbox.files.write(path, data)` | `await sandbox.writeFile(path, data)` (under `/home/tenki` only) |
| Read a file | `await sandbox.files.read(path)` (a string by default) | `await sandbox.readFile(path)` (a `Uint8Array`, under `/home/tenki` only) |
| Sandbox ID | `sandbox.sandboxId` | `sandbox.id` |
| Reconnect | `await Sandbox.connect(id)` | `await tenki.get(id)` |
| List sandboxes | `Sandbox.list()` returns a paginator; read pages with `await paginator.nextItems()` | `await tenki.list()` |
| Sandbox timeout | `Sandbox.create({ timeoutMs })` | `createAndWait({ maxDurationMs })` (lifetime cap) |
| Turn off outbound network | `Sandbox.create({ allowInternetAccess: false })` | `createAndWait({ allowOutbound: false })` |
| Dispose | `await sandbox.kill()` | `await sandbox.close()` (or `await using`, Node 24+) |

### The one gotcha: `exec` doesn't shell-split

This is the change that bites most ports. E2B's `commands.run("echo $HOME && ls")` runs your string through a shell, so pipes, globs, `&&` and `$VARS` work. Tenki's `exec(command, { args })` runs a bare binary plus its argument array, and nothing is interpreted.

```js
// E2B
await sandbox.commands.run("echo $HOME && ls /tmp");

// Tenki — ask for a shell explicitly
await sandbox.exec("sh", { args: ["-c", "echo $HOME && ls /tmp"] });

// Tenki — a single binary needs no shell at all
await sandbox.exec("python3", { args: ["-c", "print(6 * 7)"] });
```

`verify.mjs` runs both Tenki forms, `sh -c` and a bare `python3`, against a live sandbox.

### Other differences

- **Output is bytes.** `ExecResult.stdout` and `.stderr` are `Uint8Array`. Use `stdoutText(r)` / `stderrText(r)` to get strings, where E2B hands you strings directly. `readFile` returns a `Uint8Array` too, where E2B's `files.read` returns a string by default.
- **A non-zero exit doesn't throw.** E2B's `commands.run` throws `CommandExitError` when the command exits non-zero. Tenki's `exec` resolves with the result, so check `r.exitCode`, as `verify.mjs` does. If your E2B code relies on catching `CommandExitError`, that `catch` no longer runs.
- **Auth is a `tk_` key.** E2B reads `E2B_API_KEY` implicitly. Tenki takes an `authToken` on the client and, when you leave it out, reads `TENKI_AUTH_TOKEN` or `TENKI_API_KEY`. SDK 1.x accepts only keys that start with `tk_`. `workspaceId` is optional.
- **File methods are confined to `/home/tenki`**, the sandbox's working directory. Shell commands run with `exec` can write anywhere.
- **Outbound network is on by default.** To isolate a sandbox, pass `createAndWait({ allowOutbound: false })`.
- **Disposal.** `await sandbox.close()` terminates the sandbox and maps to E2B's `sandbox.kill()`. The `Session` object that `createAndWait()` returns is an `AsyncDisposable`, so you can also write `await using sandbox = await tenki.createAndWait(...)` and the sandbox is terminated when the scope exits. Top-level `await using` needs Node 24; Node 22 can't parse it. Either way, the sandbox is a sandbox billed per second. If your process dies before it disposes of the sandbox, the sandbox keeps running, because Tenki doesn't pause idle sandboxes. `maxDurationMs` caps a sandbox's lifetime, and `run.mjs` doesn't set it. If your E2B code relied on `timeoutMs` to clean up, pass `createAndWait({ maxDurationMs })` with the same value, as in the API map's Sandbox timeout row.

## Check it works

```bash
node verify.mjs
```

When it passes, it prints a line like this one from CI. The 8 characters in parentheses are the start of your sandbox's ID.

```text
✓ e2b-to-tenki-migration: create (01a13d9d…) → exec sh + python3 → "hello-from-tenki" / 42 → dispose
```

`verify.mjs` is the check CI runs. It creates a sandbox and checks that it got an ID, runs `echo hello-from-tenki` through `sh -c` and asserts exit code 0 and that output, runs `python3 -c "print(6 * 7)"` as a bare binary and asserts `42`, then closes the sandbox in a `finally` block. If creating the sandbox or either `exec` check fails, it prints `✗ <message>` and exits non-zero. A missing or non-`tk_` key fails earlier, with the messages listed under [Troubleshooting](#troubleshooting). It reads the key from `TENKI_AUTH_TOKEN`, then `TENKI_API_KEY`, then the `auth_token` in `~/.config/tenki/config.yaml`. CI runs it on Node 20 with only `TENKI_API_KEY` set.

A pass proves your key works and that create, both `exec` forms and output decoding work against the live API. It doesn't prove disposal: `verify.mjs` calls `close()` after printing the `✓` line and ignores any error from it. It also doesn't install or run E2B, doesn't run `run.mjs`, and doesn't exercise the map's file, env, working-directory, reconnect or list entries.

## Troubleshooting

- ❌ **``No token. Set TENKI_AUTH_TOKEN, or run `tenki login`.``** `verify.mjs` found no key in `TENKI_AUTH_TOKEN`, `TENKI_API_KEY`, or `~/.config/tenki/config.yaml`. Export a `tk_` key, or run `tenki login --api-key <key>`.
- ❌ **`missing auth token - set TENKI_AUTH_TOKEN or TENKI_API_KEY or use authToken option` from `node run.mjs`.** Neither variable is set in this shell, and `run.mjs` doesn't read `~/.config/tenki/config.yaml`, so `tenki login` alone isn't enough. Export the key in the shell you run it from.
- ❌ **`invalid auth token - API keys and service tokens must start with tk_`.** SDK 1.x accepts only `tk_` API keys. Create one at https://app.tenki.cloud.
- ❌ **`TypeError: r.stdout.trim is not a function`.** `ExecResult.stdout` and `.stderr` are `Uint8Array`, not strings as in E2B. Decode them with `stdoutText(r)` / `stderrText(r)`.
- ❌ **A shell command ported from `commands.run` doesn't run under `exec`.** `exec` treats the string as the name of the binary and runs it with no shell, so pipes, `&&`, globs and `$VARS` aren't interpreted. Wrap it as `sandbox.exec("sh", { args: ["-c", "<command>"] })`, or pass the binary and an `args` array.
- ❌ **`permission_denied … path outside workdir` from `writeFile` or `readFile`.** Tenki's file methods are confined to `/home/tenki`. Keep the path under `/home/tenki`, or write the file with an `exec` shell command instead.
- ❌ **`SyntaxError` at `await using`.** Top-level `await using` needs Node 24, and Node 22 can't parse it. Use `try`/`finally` with `close()`, as `run.mjs` does, or run on Node 24.

## FAQ

**When shouldn't I use this?** When your E2B code is Python: this example maps only the JavaScript SDKs. Tenki's Python SDK is `tenki` on PyPI (`pip install tenki`). Also when you want to keep E2B as an option alongside Tenki rather than replace it. [`../computesdk-tenki/`](../computesdk-tenki/) runs code on Tenki through ComputeSDK, which has providers for both, so your sandbox code stays the same when you switch. The map covers only the calls listed above. For anything else, check the [Tenki docs](https://tenki.cloud/docs).

## Related

- [E2B](https://e2b.dev)
- [`@tenkicloud/sandbox` on npm](https://www.npmjs.com/package/@tenkicloud/sandbox)
- [Tenki](https://tenki.cloud) and the [Tenki docs](https://tenki.cloud/docs)
- [`../computesdk-tenki/`](../computesdk-tenki/): one ComputeSDK interface in front of Tenki, E2B and other providers.
- [`../files-in-a-sandbox/`](../files-in-a-sandbox/): `writeFile`, `readFile` and `list` with the Tenki SDK.
