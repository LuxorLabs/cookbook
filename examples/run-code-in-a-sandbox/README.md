# How to run code in a disposable Tenki sandbox from Node.js

**Audience:** Node.js developers who want to run a command in a throwaway microVM with the `@tenkicloud/sandbox` SDK.
**Time:** ~5 minutes, most of it creating an API key. The script boots, runs, and disposes of a sandbox in a few seconds.
**Outcome:** `python3` runs inside a live Tenki sandbox, its exit code and output print on your machine as `exit 0 -> 42`, and the sandbox is terminated when the script ends.

> **Honesty note:** `run.mjs` needs Node.js 24 or later, because it uses top-level `await using`, which Node 22 can't parse. `verify.mjs` uses `try`/`finally` instead, so it runs on older versions. CI runs it on Node 20.

## Why bother

This is the core Tenki loop: boot a disposable microVM, run code in it, get the output, throw it away. With the official [`@tenkicloud/sandbox`](https://www.npmjs.com/package/@tenkicloud/sandbox) SDK it takes about 15 lines, and the code runs in the sandbox, not on your machine.

## Install

```bash
git clone https://github.com/LuxorLabs/cookbook.git
cd cookbook/examples/run-code-in-a-sandbox
npm install
```

Every later command runs from this directory. `npm install` pulls one dependency, `@tenkicloud/sandbox` 1.4.1 or later.

## Authenticate

Create an API key at https://app.tenki.cloud. Keys start with `tk_`. Export it:

```bash
export TENKI_AUTH_TOKEN=tk_...
```

`TENKI_API_KEY` works too: `run.mjs` passes `TENKI_AUTH_TOKEN` to the SDK, and when that's unset the SDK falls back to `TENKI_API_KEY`. `verify.mjs` also falls back to the key that `tenki login --api-key <key>` stores in `~/.config/tenki/config.yaml`. `run.mjs` doesn't read that file, so it needs the environment variable.

`TENKI_WORKSPACE_ID` is optional. Both scripts pass it to `createAndWait` when it's set. Leave it unset and Tenki infers the workspace from your workspace API key.

## Use it

```bash
node run.mjs
```

It prints:

```
exit 0 -> 42
```

This is all of `run.mjs`:

```js
// Run code in a disposable Tenki sandbox: boot -> exec -> print -> auto-dispose.
// The core Tenki loop, with the official @tenkicloud/sandbox SDK.
import { TenkiSandbox, stdoutText } from "@tenkicloud/sandbox";

const tenki = new TenkiSandbox({ authToken: process.env.TENKI_AUTH_TOKEN });

// `await using` auto-terminates the sandbox when this scope ends (Session is AsyncDisposable).
await using sandbox = await tenki.createAndWait({
  cpuCores: 1,
  memoryMb: 1024,
  workspaceId: process.env.TENKI_WORKSPACE_ID,
});

// exec(command, { args }) runs a bare binary + its args (no shell splitting).
const result = await sandbox.exec("python3", { args: ["-c", "print(6 * 7)"] });

console.log(`exit ${result.exitCode} -> ${stdoutText(result).trim()}`); // exit 0 -> 42
```

It asks for a sandbox with 1 CPU core and 1024 MB of memory, waits until it's ready, runs `python3 -c "print(6 * 7)"` inside it, and prints the exit code and stdout.

## Commands and cleanup

**`exec` runs a binary, not a shell line.** `sandbox.exec(command, { args })` runs one binary with the arguments you pass, with no shell splitting. Pipes, `&&`, globs, and variable expansion need a shell, so start one yourself: `sandbox.exec("sh", { args: ["-c", "echo hi && ls"] })`.

**A failing command doesn't throw.** `exec` resolves to an `ExecResult` with `exitCode`, `stdout`, and `stderr` whatever the exit code, so check `exitCode` yourself, as `verify.mjs` does. `stdout` and `stderr` are bytes. `stdoutText(result)` decodes `stdout` to a trimmed string, and `stderrText(result)` does the same for `stderr`. Both are exported from `@tenkicloud/sandbox`.

**The sandbox is disposable.** It boots in about 2 seconds and is billed per second. `createAndWait` returns a `Session`, which is an `AsyncDisposable`, so `await using` terminates the sandbox when the script's scope ends. To dispose of it explicitly, call `await sandbox[Symbol.asyncDispose]()`, as `verify.mjs` does in a `finally` block. That pattern works on Node versions that can't parse `await using`.

## Check it works

```bash
node verify.mjs
```

On success it prints one line:

```
✓ run-code-in-a-sandbox: create → exec python3 → 42 → dispose
```

`verify.mjs` boots a live sandbox, runs `python3 -c "print(6 * 7)"`, and fails unless the exit code is 0 and stdout is `42`. It exits non-zero on any failure and disposes of the sandbox in a `finally` block. CI runs it on Node 20 with only `TENKI_API_KEY` set. It proves your key, sandbox boot, and `exec` work against live Tenki. It doesn't run `run.mjs` or its `await using`, and it prints the `✓` line before disposing, so a failed dispose doesn't fail the check.

## Troubleshooting

**A `SyntaxError` from `run.mjs`.** Node.js older than 24 can't parse top-level `await using`. Run `run.mjs` on Node 24 or later. `verify.mjs` runs on older versions.

**``No token. Set TENKI_AUTH_TOKEN, or run `tenki login`.``** `verify.mjs` found no key in `TENKI_AUTH_TOKEN`, `TENKI_API_KEY`, or `~/.config/tenki/config.yaml`. Export a `tk_` key, or run `tenki login --api-key <key>`.

**`missing auth token - set TENKI_AUTH_TOKEN or TENKI_API_KEY or use authToken option`.** The SDK found no key when `run.mjs` created its client. `run.mjs` reads only the environment, not `~/.config/tenki/config.yaml`, so `tenki login` alone isn't enough. Export `TENKI_AUTH_TOKEN` or `TENKI_API_KEY`.

**`invalid auth token - API keys and service tokens must start with tk_`.** The value you exported isn't a Tenki API key. Create one at https://app.tenki.cloud.

**`✗ unexpected result: exit <code>, stdout "<text>"` from `verify.mjs`.** The key worked and the sandbox booted, but `python3 -c "print(6 * 7)"` didn't exit 0 with `42` on stdout. The exit code and stdout in the message are what the command returned.

## FAQ

**When shouldn't I use this?** When you can't run Node 24 or later, because `run.mjs` won't parse; copy the `try`/`finally` pattern from `verify.mjs` instead. When your code is Python: use [`run-code-python`](../run-code-python/), which does the same loop with the `tenki` SDK (`pip install tenki`). When anything in the sandbox has to outlive the script: `run.mjs` terminates the sandbox at the end, and its memory and disk go with it. Pausing keeps both; see [`snapshots-pause-resume`](../snapshots-pause-resume/). And don't read a passing `verify.mjs` as coverage of `run.mjs`'s `await using`, because it doesn't run it.

**Do I need `TENKI_WORKSPACE_ID`?** No. A workspace API key implies its workspace, and CI runs `verify.mjs` with only `TENKI_API_KEY` set.

**Can code in the sandbox reach the network?** Yes. Outbound network is on by default in SDK 1.x, and `run.mjs` doesn't change it. To isolate a sandbox, pass `allowOutbound: false` to `createAndWait`.

**What happens if a sandbox isn't disposed of?** It keeps running, and billing, until something terminates it. Sandboxes don't pause on idle. Pass `maxDurationMs` to `createAndWait` to cap a sandbox's lifetime. `run.mjs` doesn't set one.

## Related

- [`@tenkicloud/sandbox` on npm](https://www.npmjs.com/package/@tenkicloud/sandbox), the SDK this example uses
- [Tenki docs](https://tenki.cloud/docs) and [tenki.cloud](https://tenki.cloud)
- [Run code in a sandbox (Python)](../run-code-python/), the same loop with the `tenki` Python SDK
- [Files in a sandbox](../files-in-a-sandbox/), moving files in and out with the SDK's file API
