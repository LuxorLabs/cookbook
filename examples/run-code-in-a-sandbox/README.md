# Run code in a sandbox

Boot a disposable Luxor sandbox from Node.js, run `python3` in it, print the result, and terminate the sandbox. It is the core create, execute, and dispose loop in about 15 lines with the [`@luxorai/sandbox`](https://www.npmjs.com/package/@luxorai/sandbox) SDK.

## Set it up with a coding agent

Paste this into Claude Code, Codex, Cursor, or another coding agent:

```text
Set up the Luxor Agent Cloud "Run code in a sandbox" example from https://github.com/LuxorLabs/cookbook.
1. Clone the repo and cd into examples/run-code-in-a-sandbox.
2. Check that Node.js is 24 or later, then run npm install.
3. The scripts need a Luxor Agent Cloud API key (starts with tk_) in TENKI_AUTH_TOKEN. If it isn't set, stop and ask me to export it (keys come from https://app.luxor.ai). Never print the key or write it to a file.
4. Run node run.mjs and confirm it prints "exit 0 -> 42", then run node verify.mjs.
5. If a step fails, use the Troubleshooting table in the example's README.md.
Then walk me through run.mjs and show me how to run my own command instead.
```

## Quick start

You need:

- Node.js 24 or later. `run.mjs` uses top-level `await using`, which Node 22 cannot parse. `verify.mjs` runs on Node 20.
- A Luxor Agent Cloud API key (`tk_...`) from [app.luxor.ai](https://app.luxor.ai).

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

`run.mjs` reads the key from the environment only. `verify.mjs` also accepts a key saved with `luxor login --api-key <key>`.

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

`verify.mjs` boots a sandbox, runs `python3 -c "print(6 * 7)"`, fails unless it exits 0 with `42` on stdout, and disposes of the sandbox in a `finally` block. CI runs it on Node 24.

## The code

The body of `run.mjs`:

```js
import { LuxorSandbox, stdoutText } from "@luxorai/sandbox";

const luxor = new LuxorSandbox({ authToken: process.env.TENKI_AUTH_TOKEN });

// `await using` auto-terminates the sandbox when this scope ends (Session is AsyncDisposable).
await using sandbox = await luxor.createAndWait({
  cpuCores: 1,
  memoryMb: 1024,
  workspaceId: process.env.TENKI_WORKSPACE_ID,
});

// exec(command, { args }) runs a bare binary + its args (no shell splitting).
const result = await sandbox.exec("python3", { args: ["-c", "print(6 * 7)"] });

console.log(`exit ${result.exitCode} -> ${stdoutText(result).trim()}`); // exit 0 -> 42
```

`TENKI_WORKSPACE_ID` is optional. Luxor Agent Cloud infers the workspace from the API key.

## Things to know

- **`exec` runs a binary, not a shell line.** For pipes, `&&`, globs, or variable expansion, start a shell: `sandbox.exec("sh", { args: ["-c", "echo hi && ls"] })`.
- **A failing command does not throw.** `exec` resolves to `{ exitCode, stdout, stderr }` whatever the exit code, so check `exitCode`. `stdout` and `stderr` are bytes; `stdoutText()` and `stderrText()` decode them.
- **Dispose of every sandbox.** A sandbox boots in about 2 seconds, is billed per second, and runs until it is terminated. `await using` handles that here. On older Node versions, call `await sandbox[Symbol.asyncDispose]()` in a `finally` block, as `verify.mjs` does. Pass `maxDurationMs` to `createAndWait` to cap a sandbox's lifetime.
- **Outbound network is on by default.** Pass `allowOutbound: false` to `createAndWait` to isolate the sandbox.

## Troubleshooting

| Error | Fix |
| --- | --- |
| `SyntaxError` from `run.mjs` | Use Node 24 or later. |
| ``No token. Set TENKI_AUTH_TOKEN, or run `luxor login`.`` | `verify.mjs` found no key. Export one or run `luxor login --api-key <key>`. |
| `missing auth token - set TENKI_AUTH_TOKEN or TENKI_API_KEY ...` | `run.mjs` reads only the environment. Export `TENKI_AUTH_TOKEN` or `TENKI_API_KEY`. |
| `invalid auth token - API keys and service tokens must start with tk_` | Create a `tk_` key at [app.luxor.ai](https://app.luxor.ai). |
| `✗ unexpected result: exit <code>, stdout "<text>"` | The sandbox booted but the command failed. The message shows what it returned. |

## Related

- [Run code with Python](../run-code-python/): the same loop with the `tenki` Python SDK
- [Work with files](../files-in-a-sandbox/): move files in and out of a sandbox
- [Pause, snapshot, and resume](../snapshots-pause-resume/): keep a sandbox's state instead of terminating it
- [Luxor Agent Cloud docs](https://luxor.ai/docs)
