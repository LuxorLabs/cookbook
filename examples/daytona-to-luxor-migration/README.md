# Daytona to Luxor Agent Cloud

Port a [Daytona](https://daytona.io) sandbox script to Luxor Agent Cloud. Both run the same loop: create a sandbox, run a command, read the output, dispose. Most of the port is renaming calls. Two changes need thought: Luxor Agent Cloud's `exec` doesn't use a shell, and its output comes back as bytes.

## Set it up with a coding agent

Paste this into Claude Code, Codex, Cursor, or another coding agent:

```text
Help me move my Daytona sandbox code to Luxor Agent Cloud, using the guide at https://github.com/LuxorLabs/cookbook/tree/main/examples/daytona-to-luxor-migration.
1. Clone https://github.com/LuxorLabs/cookbook, cd into examples/daytona-to-luxor-migration, and run npm install (Node.js 20 or later).
2. The scripts need a Luxor Agent Cloud API key (starts with tk_) in LUXORAI_AUTH_TOKEN. If it isn't set, stop and ask me to export it (keys come from https://app.luxor.ai). Never print the key or write it to a file.
3. Run node run.mjs and confirm it prints "hello from luxor · exit 0", then run node verify.mjs.
4. Read the API map and "Other differences" in that README.md. Then find every Daytona SDK call in my project and port it to @luxorai/sandbox: wrap shell command strings in sh -c, replace codeRun with a direct interpreter exec, decode output with stdoutText/stderrText, and close every sandbox.
5. Show me the diff before you change anything you're unsure about.
```

## Quick start

You need:

- Node.js 20 or later. The scripts use `try`/`finally`, not `await using`.
- A Luxor Agent Cloud API key (`tk_...`) from [app.luxor.ai](https://app.luxor.ai).

### 1. Install

```bash
git clone https://github.com/LuxorLabs/cookbook.git
cd cookbook/examples/daytona-to-luxor-migration
npm install
```

This installs `@luxorai/sandbox` 1.5.2 or later. The Daytona code here is for comparison and isn't installed.

### 2. Set your API key

```bash
export LUXORAI_AUTH_TOKEN=tk_...   # LUXORAI_API_KEY also works
```

`run.mjs` reads the key from the environment only. `verify.mjs` also accepts a key saved with `luxor login --api-key <key>`. `LUXORAI_WORKSPACE_ID` is optional.

### 3. Run the port

```bash
node run.mjs
```

```
hello from luxor · exit 0
```

### 4. Verify

```bash
node verify.mjs
```

```
✓ daytona-to-luxor-migration: create (<id>…) → exec sh + python3 → "hello-from-luxor" / 42 → dispose
```

`verify.mjs` runs `echo` through `sh -c` and `python3` as a bare binary, checks each exit code and output, then closes the sandbox.

## The port

`run.mjs`, with each Daytona equivalent in a comment:

```js
// The Luxor Agent Cloud port of a typical Daytona script: create -> run a command -> capture output -> dispose.
// Daytona (for reference):
//   import { Daytona } from "@daytonaio/sdk";
//   const daytona = new Daytona({ apiKey: process.env.DAYTONA_API_KEY });   // or implicit DAYTONA_API_KEY
//   const sandbox = await daytona.create();
//   const r = await sandbox.process.executeCommand("echo hello from daytona"); // runs via a shell
//   console.log(r.result.trim(), "· exit", r.exitCode);
//   await daytona.delete(sandbox);
import { LuxorSandbox, stdoutText } from "@luxorai/sandbox";

// Daytona: new Daytona({ apiKey }) (or implicit DAYTONA_API_KEY). Luxor Agent Cloud: pass the token explicitly.
const luxor = new LuxorSandbox({ authToken: process.env.LUXORAI_AUTH_TOKEN || process.env.LUXORAI_API_KEY || process.env.TENKI_AUTH_TOKEN || process.env.TENKI_API_KEY });

// Daytona: daytona.create(). Luxor Agent Cloud: createAndWait() boots the sandbox and waits until it's ready.
const sandbox = await luxor.createAndWait({
  cpuCores: 1,
  memoryMb: 1024,
  workspaceId: process.env.LUXORAI_WORKSPACE_ID || process.env.TENKI_WORKSPACE_ID,
});

try {
  // Daytona's process.executeCommand("echo ...") runs through a shell. Luxor Agent Cloud's exec() runs a bare
  // binary + args (no shell splitting) — wrap shell syntax in `sh -c` yourself.
  const result = await sandbox.exec("sh", { args: ["-c", "echo hello from luxor"] });

  // Daytona: result.result is a string. Luxor Agent Cloud: result.stdout is bytes — decode with stdoutText().
  console.log(stdoutText(result).trim(), "· exit", result.exitCode); // hello from luxor · exit 0
} finally {
  // Daytona: await daytona.delete(sandbox). Luxor Agent Cloud: close() terminates the sandbox (so does `await using`).
  await sandbox.close();
}
```

## API map

Checked against `@daytonaio/sdk` 0.224.1 and `@luxorai/sandbox` 1.4.1. Daytona's renamed package, `@daytona/sdk`, has the same API.

| Concept | Daytona (`@daytonaio/sdk`) | Luxor Agent Cloud (`@luxorai/sandbox`) |
| --- | --- | --- |
| Install | `npm i @daytonaio/sdk` | `npm i @luxorai/sandbox` |
| Import | `import { Daytona } from "@daytonaio/sdk"` | `import { LuxorSandbox, stdoutText } from "@luxorai/sandbox"` |
| Auth | `new Daytona({ apiKey })` (or implicit `DAYTONA_API_KEY`) | `new LuxorSandbox({ authToken })` (or implicit `LUXORAI_AUTH_TOKEN` / `LUXORAI_API_KEY`) |
| Create | `await daytona.create()` | `await luxor.createAndWait({ cpuCores, memoryMb, workspaceId })` (`workspaceId` optional) |
| Run a command | `await sandbox.process.executeCommand("ls -la")` (shell) | `await sandbox.exec("ls", { args: ["-la"] })` (no shell, see below) |
| Run a code snippet | `await sandbox.process.codeRun("print(6 * 7)")` | `await sandbox.exec("python3", { args: ["-c", "print(6 * 7)"] })` |
| stdout / stderr | `r.result` (string) | `stdoutText(r)` / `stderrText(r)` (decode the byte fields) |
| Exit code | `r.exitCode` | `r.exitCode` |
| Env vars | `executeCommand(cmd, cwd, env)` or `create({ envVars })` | `exec(cmd, { env })` or `createAndWait({ env })` |
| Working dir | `executeCommand(cmd, cwd)` | `exec(cmd, { cwd })` |
| Write a file | `await sandbox.fs.uploadFile(Buffer.from(data), path)` | `await sandbox.writeFile(path, data)` (path under `/home/tenki`) |
| Read a file | `await sandbox.fs.downloadFile(path)` (Buffer) | `await sandbox.readFile(path)` (`Uint8Array`, path under `/home/tenki`) |
| Sandbox ID | `sandbox.id` | `sandbox.id` |
| Reconnect | `await daytona.get(id)` | `await luxor.get(id)` |
| List sandboxes | `for await (const s of daytona.list())` (async iterator) | `await luxor.list()` (array) |
| Dispose | `await daytona.delete(sandbox)` | `await sandbox.close()` (or `await using`, Node 24+) |

## `exec` doesn't use a shell

Daytona's `process.executeCommand("echo $HOME && ls")` runs through a shell. Luxor Agent Cloud's `exec(command, { args })` runs a bare binary, so wrap shell commands in `sh -c`. For Daytona's `process.codeRun(...)`, call the interpreter directly. From `verify.mjs`:

```js
  // Daytona: sandbox.process.executeCommand("...") runs via a shell. Luxor Agent Cloud: exec() runs a bare
  // binary + args, so port a shell command by wrapping it in `sh -c`.
  const shell = await sandbox.exec("sh", { args: ["-c", "echo hello-from-luxor"] });
```

```js
  // Daytona: sandbox.process.codeRun("print(6 * 7)") runs a code snippet. Luxor Agent Cloud: run the
  // interpreter directly as a bare binary + args (no shell needed).
  const py = await sandbox.exec("python3", { args: ["-c", "print(6 * 7)"] });
```

## Other differences

- **Output is bytes.** `stdout` and `stderr` are `Uint8Array`, and there is no `result` field. Use `stdoutText(r)` / `stderrText(r)`.
- **Keys start with `tk_`.** Pass `authToken` to the client, or let the SDK read `LUXORAI_AUTH_TOKEN` / `LUXORAI_API_KEY`.
- **Close every sandbox.** `sandbox.close()` replaces `daytona.delete(sandbox)`. Sandboxes are [billed per second](https://luxor.ai/docs/pricing) and run until closed or until their lifetime cap (sticky sandboxes have none). Pass `maxDurationMs` to `createAndWait` to set a cap. To clean up a leaked sandbox, find it with `await luxor.list()` or `await luxor.get(id)` and call `close()`.
- **File methods are confined to `/home/tenki`.** Relative paths resolve there. Commands run with `exec` can write anywhere.
- **Outbound network is on by default.** Pass `allowOutbound: false` to isolate a sandbox.
- **`await using` needs Node 24.** `Session` is `AsyncDisposable`, so `await using sandbox = await luxor.createAndWait(...)` works on Node 24 and later.

## Troubleshooting

| Problem | Fix |
| --- | --- |
| ``No token. Set LUXORAI_AUTH_TOKEN, or run `luxor login`.`` | `verify.mjs` found no key. Export one or run `luxor login --api-key <key>`. |
| `missing auth token - set LUXORAI_AUTH_TOKEN or LUXORAI_API_KEY ...` | `run.mjs` reads only the environment. Export the key. |
| `invalid auth token - API keys and service tokens must start with tk_` | Create a `tk_` key at [app.luxor.ai](https://app.luxor.ai). |
| Pipes, `&&`, globs, or `$VARS` don't work | Wrap the command in `sh -c`. |
| `r.result` is `undefined` | Use `stdoutText(r)` / `stderrText(r)`. |
| `permission_denied … path outside workdir` | Keep SDK file paths under `/home/tenki`. |

This guide covers the Node SDKs. Luxor Agent Cloud's Python SDK is [`tenki`](https://pypi.org/project/tenki/).

## Related

- [E2B to Luxor Agent Cloud](../e2b-to-luxor-migration/) and [Modal to Luxor Agent Cloud](../modal-to-luxor-migration/)
- [`@luxorai/sandbox` on npm](https://www.npmjs.com/package/@luxorai/sandbox) and the [Luxor Agent Cloud docs](https://luxor.ai/docs)
- [`@daytonaio/sdk`](https://www.npmjs.com/package/@daytonaio/sdk) and [`@daytona/sdk`](https://www.npmjs.com/package/@daytona/sdk)
