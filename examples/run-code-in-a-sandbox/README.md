# Run code in a sandbox

Boot a disposable Tenki sandbox from Node.js, run `python3` in it, print the result, and terminate the sandbox. It is the core create, execute, and dispose loop in about 15 lines with the [`@tenkicloud/sandbox`](https://www.npmjs.com/package/@tenkicloud/sandbox) SDK.

## Quick start

You need:

- Node.js 24 or later. `run.mjs` uses top-level `await using`, which Node 22 cannot parse. `verify.mjs` runs on Node 20.
- A Tenki API key (`tk_...`) from [app.tenki.cloud](https://app.tenki.cloud).

### 1. Install

```bash
git clone https://github.com/LuxorLabs/cookbook.git
cd cookbook/examples/run-code-in-a-sandbox
npm install
```

### 2. Set your API key

```bash
export TENKI_AUTH_TOKEN=tk_...   # TENKI_API_KEY also works
```

`run.mjs` reads the key from the environment only. `verify.mjs` also accepts a key saved with `tenki login --api-key <key>`.

### 3. Run

```bash
node run.mjs
```

```
exit 0 -> 42
```

### 4. Verify

```bash
node verify.mjs
```

```
✓ run-code-in-a-sandbox: create → exec python3 → 42 → dispose
```

`verify.mjs` boots a sandbox, runs `python3 -c "print(6 * 7)"`, fails unless it exits 0 with `42` on stdout, and disposes of the sandbox in a `finally` block. CI runs it on Node 20.

## The code

The body of `run.mjs`:

```js
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

`TENKI_WORKSPACE_ID` is optional. Tenki infers the workspace from the API key.

## Things to know

- **`exec` runs a binary, not a shell line.** For pipes, `&&`, globs, or variable expansion, start a shell: `sandbox.exec("sh", { args: ["-c", "echo hi && ls"] })`.
- **A failing command does not throw.** `exec` resolves to `{ exitCode, stdout, stderr }` whatever the exit code, so check `exitCode`. `stdout` and `stderr` are bytes; `stdoutText()` and `stderrText()` decode them.
- **Dispose of every sandbox.** A sandbox boots in about 2 seconds, is billed per second, and runs until it is terminated. `await using` handles that here. On older Node versions, call `await sandbox[Symbol.asyncDispose]()` in a `finally` block, as `verify.mjs` does. Pass `maxDurationMs` to `createAndWait` to cap a sandbox's lifetime.
- **Outbound network is on by default.** Pass `allowOutbound: false` to `createAndWait` to isolate the sandbox.

## Troubleshooting

| Error | Fix |
| --- | --- |
| `SyntaxError` from `run.mjs` | Use Node 24 or later. |
| ``No token. Set TENKI_AUTH_TOKEN, or run `tenki login`.`` | `verify.mjs` found no key. Export one or run `tenki login --api-key <key>`. |
| `missing auth token - set TENKI_AUTH_TOKEN or TENKI_API_KEY ...` | `run.mjs` reads only the environment. Export `TENKI_AUTH_TOKEN` or `TENKI_API_KEY`. |
| `invalid auth token - API keys and service tokens must start with tk_` | Create a `tk_` key at [app.tenki.cloud](https://app.tenki.cloud). |
| `✗ unexpected result: exit <code>, stdout "<text>"` | The sandbox booted but the command failed. The message shows what it returned. |

## Related

- [Run code with Python](../run-code-python/): the same loop with the `tenki` Python SDK
- [Work with files](../files-in-a-sandbox/): move files in and out of a sandbox
- [Pause, snapshot, and resume](../snapshots-pause-resume/): keep a sandbox's state instead of terminating it
- [Tenki docs](https://tenki.cloud/docs)
