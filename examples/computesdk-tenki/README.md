# ComputeSDK

Run code on Tenki through [ComputeSDK](https://github.com/computesdk/computesdk), which puts one interface in front of many sandbox providers (E2B, Modal, Daytona, Vercel, and others). The [`@computesdk/tenki`](https://www.npmjs.com/package/@computesdk/tenki) provider maps that interface onto Tenki sandboxes: shell commands, a native filesystem API, and public preview URLs. Pass Tenki as the provider, and the sandbox code after that doesn't change if you switch.

## Set it up with a coding agent

Paste this into Claude Code, Codex, Cursor, or another coding agent:

```text
Set up the Tenki "ComputeSDK" example from https://github.com/LuxorLabs/cookbook.
1. Clone the repo, cd into examples/computesdk-tenki, and run npm install (Node.js 20 or later).
2. It needs TENKI_API_KEY (a Tenki key starting with tk_, from https://app.tenki.cloud) in the environment. If it isn't set, stop and ask me to export it. Never print the key or write it to a file.
3. Run node run.mjs and confirm it prints "Hello from Linux ..." and 42, then run node verify.mjs.
4. If a step fails, use the Troubleshooting table in the example's README.md.
Then show me how to add Tenki as a ComputeSDK provider in my own project so I can switch providers without changing my sandbox code.
```

## Quick start

You need:

- Node.js 20 or later.
- A Tenki API key (`tk_...`) from [app.tenki.cloud](https://app.tenki.cloud).

### 1. Install

```bash
git clone https://github.com/LuxorLabs/cookbook.git
cd cookbook/examples/computesdk-tenki
npm install
```

This installs `computesdk` and `@computesdk/tenki`, which brings in `@tenkicloud/sandbox` 1.x.

### 2. Set your API key

```bash
export TENKI_API_KEY=tk_...   # TENKI_AUTH_TOKEN also works
```

`run.mjs` reads the key from the environment only. `verify.mjs` also accepts a key saved with `tenki login --api-key <key>`.

### 3. Run

```bash
node run.mjs
```

```text
Hello from Linux ...
42
```

### 4. Verify

```bash
node verify.mjs
```

```text
✓ computesdk-tenki: compute.sandbox.create → runCommand (42) → filesystem round-trip → destroy
```

`verify.mjs` runs `python3` through `runCommand`, writes, checks, and reads back a file through the filesystem API, and destroys the sandbox.

## The code

`run.mjs`:

```js
// Run code on Tenki through ComputeSDK — one provider interface, swappable backends.
import { compute } from "computesdk";
import { tenki } from "@computesdk/tenki";

compute.setConfig({ provider: tenki({ apiKey: process.env.TENKI_API_KEY }) });

const sandbox = await compute.sandbox.create();
try {
  // runCommand goes through `sh -lc`, so shell syntax works.
  const hello = await sandbox.runCommand('echo "Hello from $(uname -sr)"');
  console.log(hello.stdout.trim());

  await sandbox.filesystem.writeFile("/home/tenki/app.py", 'print(6 * 7)\n');
  const result = await sandbox.runCommand("python3 /home/tenki/app.py");
  console.log(result.stdout.trim()); // 42
} finally {
  await sandbox.destroy();
}
```

`compute.sandbox` was renamed `compute.instances` in `computesdk` 4.1.11. The old name still works as a deprecated alias; current ComputeSDK docs use `compute.instances.create()`.

## How the provider maps onto Tenki

- **`runCommand` wraps commands in `sh -lc`**, so pipes, globs, and `$(...)` work.
- **The filesystem API is native.** `writeFile`, `readFile`, `mkdir`, `readdir`, and `remove` use Tenki's file API, so content needs no escaping. `exists` runs `test -e` in the shell.
- **File methods are confined to `/home/tenki`.** Shell commands can write anywhere.
- **Start servers with `{ background: true }`**, not a trailing `&`, which holds the output stream open.
- **Size and lifetime.** `tenki()` accepts `cpuCores`, `memoryMb`, and `diskSizeGb` as defaults, and `compute.sandbox.create()` accepts the same keys per sandbox. Pass `timeout` (ms) to `create()` to set the lifetime cap (Tenki's `maxDurationMs`). The `timeout` on `tenki()` is the default `runCommand` timeout.

Preview URLs and the raw Tenki session (not used in `run.mjs` or tested by `verify.mjs`):

```js
// Serve something, then expose the port at a public https://<slug>.sb.tenki.sh URL
await sandbox.runCommand("python3 -m http.server 3000", { background: true });
const url = await sandbox.getUrl({ port: 3000 });

// Escape hatch: the underlying @tenkicloud/sandbox Session for SSH, volumes, snapshots
const session = await sandbox.getInstance();
```

The provider doesn't map Tenki snapshots or pause/resume to ComputeSDK's snapshot methods yet. Reach them through `getInstance()`, which ties that code to Tenki. To switch providers, change the import and the `provider` in `compute.setConfig`, and replace the `/home/tenki` paths.

## Troubleshooting

| Problem | Fix |
| --- | --- |
| ``No token. Set TENKI_AUTH_TOKEN, or run `tenki login`.`` | `verify.mjs` found no key. Export one or run `tenki login --api-key <key>`. |
| `Missing API key for Tenki.` | `run.mjs` reads only the environment. Export `TENKI_API_KEY`. |
| Auth fails with a key that doesn't start with `tk_` | Create a `tk_` key at [app.tenki.cloud](https://app.tenki.cloud). |
| `permission_denied … path outside workdir` | Keep filesystem paths under `/home/tenki`. |
| `runCommand` never returns after starting a server with `&` | Drop the `&` and pass `{ background: true }`. |

## Related

- [E2B to Tenki](../e2b-to-tenki-migration/), [Modal to Tenki](../modal-to-tenki-migration/), and [Daytona to Tenki](../daytona-to-tenki-migration/): port directly instead
- [Run code in a sandbox](../run-code-in-a-sandbox/): the full Tenki SDK
- [`@computesdk/tenki`](https://www.npmjs.com/package/@computesdk/tenki) ([source](https://github.com/computesdk/computesdk/tree/main/packages/tenki))
- [Tenki docs](https://tenki.cloud/docs)
