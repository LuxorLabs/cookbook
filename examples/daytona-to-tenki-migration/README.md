# Migrate from Daytona to Tenki

Already have code running on [Daytona](https://daytona.io)? Moving to [Tenki](https://tenki.cloud) is a small, mechanical change. Both give you a disposable cloud sandbox with the same core loop — **create → run a command → capture output → dispose** — so most scripts port in a few minutes with the official [`@tenkicloud/sandbox`](https://www.npmjs.com/package/@tenkicloud/sandbox) SDK.

This example shows the two scripts side by side, an API map, and a `run.mjs` you can run against live Tenki.

## The core loop, side by side

**Daytona** (`@daytonaio/sdk`):

```js
import { Daytona } from "@daytonaio/sdk";

const daytona = new Daytona({ apiKey: process.env.DAYTONA_API_KEY }); // or implicit DAYTONA_API_KEY
const sandbox = await daytona.create();
const r = await sandbox.process.executeCommand("echo hello from daytona"); // runs via a shell
console.log(r.result.trim(), "· exit", r.exitCode);                        // hello from daytona · exit 0
await daytona.delete(sandbox);
```

**Tenki** (`@tenkicloud/sandbox`):

```js
import { TenkiSandbox, stdoutText } from "@tenkicloud/sandbox";

const tenki = new TenkiSandbox({ authToken: process.env.TENKI_AUTH_TOKEN });

const sandbox = await tenki.createAndWait({
  cpuCores: 1,
  memoryMb: 1024,
  workspaceId: process.env.TENKI_WORKSPACE_ID,
});
try {
  // exec() runs a bare binary + args (no shell). Wrap shell syntax in `sh -c`.
  const r = await sandbox.exec("sh", { args: ["-c", "echo hello from tenki"] });
  console.log(stdoutText(r).trim(), "· exit", r.exitCode); // hello from tenki · exit 0
} finally {
  await sandbox.close();
}
```

## API map

| Concept | Daytona (`@daytonaio/sdk`) | Tenki (`@tenkicloud/sandbox`) |
| --- | --- | --- |
| Install | `npm i @daytonaio/sdk` | `npm i @tenkicloud/sandbox` |
| Import | `import { Daytona } from "@daytonaio/sdk"` | `import { TenkiSandbox, stdoutText } from "@tenkicloud/sandbox"` |
| Auth | `new Daytona({ apiKey })` (or implicit `DAYTONA_API_KEY`) | `new TenkiSandbox({ authToken })` (+ `workspaceId`) |
| Create | `await daytona.create()` | `await tenki.createAndWait({ cpuCores, memoryMb, workspaceId })` |
| Run a command | `await sandbox.process.executeCommand("ls -la")` (shell) | `await sandbox.exec("ls", { args: ["-la"] })` (no shell — see note) |
| Run a code snippet | `await sandbox.process.codeRun("print(6 * 7)")` | `await sandbox.exec("python3", { args: ["-c", "print(6 * 7)"] })` |
| stdout / stderr | `r.result` (string) | `stdoutText(r)` / `stderrText(r)` (decode the byte fields) |
| Exit code | `r.exitCode` | `r.exitCode` |
| Env vars | `executeCommand(cmd, cwd, env)` or `create({ envVars })` | `exec(cmd, { env })` or `createAndWait({ env })` |
| Working dir | `executeCommand(cmd, cwd)` | `exec(cmd, { cwd })` |
| Write a file | `await sandbox.fs.uploadFile(Buffer.from(data), path)` | `await sandbox.writeFile(path, data)` |
| Read a file | `await sandbox.fs.downloadFile(path)` (Buffer) | `await sandbox.readFile(path)` |
| Sandbox ID | `sandbox.id` | `sandbox.id` |
| Reconnect | `await daytona.get(id)` | `await tenki.get(id)` |
| List sandboxes | `await daytona.list()` | `await tenki.list()` |
| Dispose | `await daytona.delete(sandbox)` | `await sandbox.close()` (or `await using` auto-disposes) |

## The one gotcha: `exec` doesn't shell-split

This is the change that bites most ports. Daytona's `process.executeCommand("echo $HOME && ls")` runs your string **through a shell**, so pipes, globs, `&&`, and `$VARS` just work. Tenki's `exec(command, { args })` runs a **bare binary plus its argument array** — nothing is interpreted.

```js
// Daytona
await sandbox.process.executeCommand("echo $HOME && ls /tmp");

// Tenki — ask for a shell explicitly
await sandbox.exec("sh", { args: ["-c", "echo $HOME && ls /tmp"] });
```

Daytona's other runner, `process.codeRun("print(6 * 7)")`, ships a code snippet to the sandbox's language runtime. On Tenki you invoke that interpreter directly as a bare binary — no shell needed:

```js
// Daytona
await sandbox.process.codeRun("print(6 * 7)");

// Tenki — the interpreter is just a binary + args
await sandbox.exec("python3", { args: ["-c", "print(6 * 7)"] });
```

## Run it

```bash
npm install
export TENKI_AUTH_TOKEN=...      # from `tenki login` (~/.config/tenki/config.yaml)
export TENKI_WORKSPACE_ID=...
node run.mjs                     # hello from tenki · exit 0
```

`verify.mjs` is the CI proof: it reads your token from `TENKI_AUTH_TOKEN` / `TENKI_API_KEY` or `~/.config/tenki/config.yaml`, then does the full loop against live Tenki — create → `exec` a shell command and a bare binary → assert the captured output → terminate — and exits non-zero on any failure.

```bash
node verify.mjs   # ✓ create → exec sh + python3 → "hello-from-tenki" / 42 → dispose
```

## Notes

- **Output is bytes.** `ExecResult.stdout` / `.stderr` are `Uint8Array`; use `stdoutText(r)` / `stderrText(r)` to get strings (Daytona hands you a `result` string directly).
- **Auth is explicit.** Daytona reads `DAYTONA_API_KEY` (implicitly, or via `new Daytona({ apiKey })`); Tenki takes an `authToken` on the client, plus a `workspaceId` for placement (from `tenki login`).
- **Disposal.** `await sandbox.close()` maps to Daytona's `daytona.delete(sandbox)`. Because `Session` is an `AsyncDisposable`, you can also write `await using sandbox = await tenki.createAndWait(...)` and let the scope terminate it for you. Either way the microVM is billed per second and self-reaps on its idle / lifetime caps.
- **Networking is off by default.** If your code needs outbound network, pass `createAndWait({ allowOutbound: true })`.
- Requires Node 20+ for `await using` (the `run.mjs` here uses explicit `close()`, so Node 18+ is fine).

Built with the official [`@tenkicloud/sandbox`](https://www.npmjs.com/package/@tenkicloud/sandbox) SDK. Learn more at [tenki.cloud](https://tenki.cloud).
