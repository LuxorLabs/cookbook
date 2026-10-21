# Daytona to Tenki

Port a [Daytona](https://daytona.io) sandbox script to Tenki. Both run the same loop: create a sandbox, run a command, read the output, dispose. Most of the port is renaming calls. Two changes need thought: Tenki's `exec` doesn't use a shell, and its output comes back as bytes.

## Quick start

You need:

- Node.js 20 or later. The scripts use `try`/`finally`, not `await using`.
- A Tenki API key (`tk_...`) from [app.tenki.cloud](https://app.tenki.cloud).

### 1. Install

```bash
git clone https://github.com/LuxorLabs/cookbook.git
cd cookbook/examples/daytona-to-tenki-migration
npm install
```

This installs `@tenkicloud/sandbox` 1.4.1 or later. The Daytona code here is for comparison and isn't installed.

### 2. Set your API key

```bash
export TENKI_AUTH_TOKEN=tk_...   # TENKI_API_KEY also works
```

`run.mjs` reads the key from the environment only. `verify.mjs` also accepts a key saved with `tenki login --api-key <key>`. `TENKI_WORKSPACE_ID` is optional.

### 3. Run the port

```bash
node run.mjs
```

```
hello from tenki · exit 0
```

### 4. Verify

```bash
node verify.mjs
```

```
✓ daytona-to-tenki-migration: create (<id>…) → exec sh + python3 → "hello-from-tenki" / 42 → dispose
```

`verify.mjs` runs `echo` through `sh -c` and `python3` as a bare binary, checks each exit code and output, then closes the sandbox.

## The port

`run.mjs`, with each Daytona equivalent in a comment:

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

## API map

Checked against `@daytonaio/sdk` 0.224.1 and `@tenkicloud/sandbox` 1.4.1. Daytona's renamed package, `@daytona/sdk`, has the same API.

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

## `exec` doesn't use a shell

Daytona's `process.executeCommand("echo $HOME && ls")` runs through a shell. Tenki's `exec(command, { args })` runs a bare binary, so wrap shell commands in `sh -c`. For Daytona's `process.codeRun(...)`, call the interpreter directly. From `verify.mjs`:

```js
  // Daytona: sandbox.process.executeCommand("...") runs via a shell. Tenki: exec() runs a bare
  // binary + args, so port a shell command by wrapping it in `sh -c`.
  const shell = await sandbox.exec("sh", { args: ["-c", "echo hello-from-tenki"] });
```

```js
  // Daytona: sandbox.process.codeRun("print(6 * 7)") runs a code snippet. Tenki: run the
  // interpreter directly as a bare binary + args (no shell needed).
  const py = await sandbox.exec("python3", { args: ["-c", "print(6 * 7)"] });
```

## Other differences

- **Output is bytes.** `stdout` and `stderr` are `Uint8Array`, and there is no `result` field. Use `stdoutText(r)` / `stderrText(r)`.
- **Keys start with `tk_`.** Pass `authToken` to the client, or let the SDK read `TENKI_AUTH_TOKEN` / `TENKI_API_KEY`.
- **Close every sandbox.** `sandbox.close()` replaces `daytona.delete(sandbox)`. Sandboxes are [billed per second](https://tenki.cloud/docs/pricing) and run until closed or until their lifetime cap (sticky sandboxes have none). Pass `maxDurationMs` to `createAndWait` to set a cap. To clean up a leaked sandbox, find it with `await tenki.list()` or `await tenki.get(id)` and call `close()`.
- **File methods are confined to `/home/tenki`.** Relative paths resolve there. Commands run with `exec` can write anywhere.
- **Outbound network is on by default.** Pass `allowOutbound: false` to isolate a sandbox.
- **`await using` needs Node 24.** `Session` is `AsyncDisposable`, so `await using sandbox = await tenki.createAndWait(...)` works on Node 24 and later.

## Troubleshooting

| Problem | Fix |
| --- | --- |
| ``No token. Set TENKI_AUTH_TOKEN, or run `tenki login`.`` | `verify.mjs` found no key. Export one or run `tenki login --api-key <key>`. |
| `missing auth token - set TENKI_AUTH_TOKEN or TENKI_API_KEY ...` | `run.mjs` reads only the environment. Export the key. |
| `invalid auth token - API keys and service tokens must start with tk_` | Create a `tk_` key at [app.tenki.cloud](https://app.tenki.cloud). |
| Pipes, `&&`, globs, or `$VARS` don't work | Wrap the command in `sh -c`. |
| `r.result` is `undefined` | Use `stdoutText(r)` / `stderrText(r)`. |
| `permission_denied … path outside workdir` | Keep SDK file paths under `/home/tenki`. |

This guide covers the Node SDKs. Tenki's Python SDK is [`tenki`](https://pypi.org/project/tenki/).

## Related

- [E2B to Tenki](../e2b-to-tenki-migration/) and [Modal to Tenki](../modal-to-tenki-migration/)
- [`@tenkicloud/sandbox` on npm](https://www.npmjs.com/package/@tenkicloud/sandbox) and the [Tenki docs](https://tenki.cloud/docs)
- [`@daytonaio/sdk`](https://www.npmjs.com/package/@daytonaio/sdk) and [`@daytona/sdk`](https://www.npmjs.com/package/@daytona/sdk)
