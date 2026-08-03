# Migrate from E2B to Tenki

Already have code running on [E2B](https://e2b.dev)? Moving to [Tenki](https://tenki.cloud) is a small, mechanical change. Both give you a disposable cloud sandbox with the same core loop — **create → run a command → capture output → dispose** — so most scripts port in a few minutes with the official [`@tenkicloud/sandbox`](https://www.npmjs.com/package/@tenkicloud/sandbox) SDK.

This example shows the two scripts side by side, an API map, and a `run.mjs` you can run against live Tenki.

## The core loop, side by side

**E2B** (`e2b`):

```js
import { Sandbox } from "e2b";

const sandbox = await Sandbox.create();                      // auth via E2B_API_KEY
const r = await sandbox.commands.run("echo hello from e2b"); // runs via a shell
console.log(r.stdout.trim(), "· exit", r.exitCode);          // hello from e2b · exit 0
await sandbox.kill();
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

| Concept | E2B (`e2b`) | Tenki (`@tenkicloud/sandbox`) |
| --- | --- | --- |
| Install | `npm i e2b` | `npm i @tenkicloud/sandbox` |
| Import | `import { Sandbox } from "e2b"` | `import { TenkiSandbox, stdoutText } from "@tenkicloud/sandbox"` |
| Auth | implicit `E2B_API_KEY` env var | `new TenkiSandbox({ authToken })` (+ `workspaceId`) |
| Create | `await Sandbox.create()` | `await tenki.createAndWait({ cpuCores, memoryMb, workspaceId })` |
| Run a command | `await sandbox.commands.run("ls -la")` (shell) | `await sandbox.exec("ls", { args: ["-la"] })` (no shell — see note) |
| stdout / stderr | `r.stdout` / `r.stderr` (strings) | `stdoutText(r)` / `stderrText(r)` (decode the byte fields) |
| Exit code | `r.exitCode` | `r.exitCode` |
| Env vars | `commands.run(cmd, { envs })` | `exec(cmd, { env })` or `createAndWait({ env })` |
| Working dir | `commands.run(cmd, { cwd })` | `exec(cmd, { cwd })` |
| Write a file | `await sandbox.files.write(path, data)` | `await sandbox.writeFile(path, data)` |
| Read a file | `await sandbox.files.read(path)` | `await sandbox.readFile(path)` |
| Sandbox ID | `sandbox.sandboxId` | `sandbox.id` |
| Reconnect | `await Sandbox.connect(id)` | `await tenki.get(id)` |
| List sandboxes | `await Sandbox.list()` | `await tenki.list()` |
| Dispose | `await sandbox.kill()` | `await sandbox.close()` (or `await using` auto-disposes) |

## The one gotcha: `exec` doesn't shell-split

This is the change that bites most ports. E2B's `commands.run("echo $HOME && ls")` runs your string **through a shell**, so pipes, globs, `&&`, and `$VARS` just work. Tenki's `exec(command, { args })` runs a **bare binary plus its argument array** — nothing is interpreted.

```js
// E2B
await sandbox.commands.run("echo $HOME && ls /tmp");

// Tenki — ask for a shell explicitly
await sandbox.exec("sh", { args: ["-c", "echo $HOME && ls /tmp"] });

// Tenki — a single binary needs no shell at all
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

- **Output is bytes.** `ExecResult.stdout` / `.stderr` are `Uint8Array`; use `stdoutText(r)` / `stderrText(r)` to get strings (E2B hands you strings directly).
- **Auth is explicit.** E2B reads `E2B_API_KEY` implicitly; Tenki takes an `authToken` on the client, plus a `workspaceId` for placement (from `tenki login`).
- **Disposal.** `await sandbox.close()` maps to E2B's `sandbox.kill()`. Because `Session` is an `AsyncDisposable`, you can also write `await using sandbox = await tenki.createAndWait(...)` and let the scope terminate it for you. Either way the microVM is billed per second and self-reaps on its idle / lifetime caps.
- **Networking is off by default.** If your code needs outbound network, pass `createAndWait({ allowOutbound: true })`.
- Requires Node 20+ for `await using` (the `run.mjs` here uses explicit `close()`, so Node 18+ is fine).

Built with the official [`@tenkicloud/sandbox`](https://www.npmjs.com/package/@tenkicloud/sandbox) SDK. Learn more at [tenki.cloud](https://tenki.cloud).
