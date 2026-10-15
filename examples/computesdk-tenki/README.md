# How to run code on Tenki through ComputeSDK

**Audience:** JavaScript developers on Node.js 20 or newer who run code in sandboxes and want to keep the sandbox provider swappable.
**Time:** ~3 minutes.
**Outcome:** `node run.mjs` boots a Tenki microVM through ComputeSDK, prints `Hello from Linux …` and `42`, and destroys the VM. `node verify.mjs` prints a `✓` line.

> **Honesty note:** This example calls `compute.sandbox.create()`. ComputeSDK renamed `compute.sandbox` to `compute.instances` in `computesdk` 4.1.11 and kept the old name as a deprecated alias, so the example still runs (`verify.mjs` makes the same call and passes in CI). ComputeSDK's current docs show `compute.instances.create()`.

## Why bother

[ComputeSDK](https://github.com/computesdk/computesdk) puts one `compute.sandbox` interface in front of many sandbox providers. Its repo has provider packages for E2B, Modal, Daytona, Vercel and many others. The official [`@computesdk/tenki`](https://www.npmjs.com/package/@computesdk/tenki) provider maps that interface onto [Tenki](https://tenki.cloud) microVMs: shell commands, a native filesystem API, and public preview URLs. Tenki is the `provider` you pass to `compute.setConfig`, and the sandbox code after that line doesn't change if you switch providers later.

## Install

```bash
git clone https://github.com/LuxorLabs/cookbook.git
cd cookbook/examples/computesdk-tenki
npm install
```

Every later command runs from this directory.

You need Node.js 20 or newer. The Tenki SDK's gRPC transport depends on it, and `@computesdk/tenki` declares `"node": ">=20"`.

`package.json` installs `computesdk` (`^4.1.4`) and `@computesdk/tenki` (`^0.1.3`). The provider brings in the Tenki SDK, `@tenkicloud/sandbox` 1.x, as its own dependency, so you don't install it separately.

## Authenticate

The provider needs a Tenki `tk_` API key. Create one at https://app.tenki.cloud (workspace settings > API Keys), then export it:

```bash
export TENKI_API_KEY=tk_...      # or TENKI_AUTH_TOKEN
```

`run.mjs` passes `process.env.TENKI_API_KEY` to `tenki()`. If that's unset, the provider falls back to `TENKI_AUTH_TOKEN` on its own. `run.mjs` doesn't read the key that `tenki login` stores; `verify.mjs` does (see [Check it works](#check-it-works)).

With a workspace API key you don't need `TENKI_WORKSPACE_ID`, because Tenki infers the workspace from the key server-side. Set it only for trusted service credentials that need explicit scope.

## Use it

`run.mjs` is the whole example:

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

Run it:

```bash
node run.mjs
```

```text
Hello from Linux ...
42
```

The first line is the VM's kernel name and release, expanded by the shell inside the sandbox. The second comes from a Python file that `run.mjs` wrote through the filesystem API and then ran with `runCommand`. The `finally` block destroys the sandbox even if a step throws.

## What the provider does under ComputeSDK's interface

- **`runCommand` wraps commands in `sh -lc`.** Tenki's raw exec is argv-only, with no shell, so the provider adds one. Pipes, globs, env expansion and the `$(uname -sr)` in `run.mjs` behave as they would in a terminal.
- **Most of the filesystem API is native.** `writeFile`, `readFile`, `mkdir`, `readdir` and `remove` use Tenki's data-plane file API, not shell commands, so file content needs no escaping. `exists` is the exception: it runs `test -e` through the shell, because the data-plane stat can briefly report a just-removed file as present.
- **The native file methods are confined to `/home/tenki`**, the sandbox's working directory. That's why `run.mjs` writes to `/home/tenki/app.py`. A `runCommand` shell command can write anywhere.
- **Long-running processes need `{ background: true }`**, not a trailing `&`. A bare `&` holds the exec output stream open. With `background: true` the provider detaches stdio and returns right away with empty output.

Two more provider methods, which `run.mjs` doesn't use and `verify.mjs` doesn't test:

```js
// Serve something, then expose the port at a public https://<slug>.sb.tenki.sh URL
await sandbox.runCommand("python3 -m http.server 3000", { background: true });
const url = await sandbox.getUrl({ port: 3000 });

// Escape hatch: the underlying @tenkicloud/sandbox Session for SSH, volumes, snapshots
const session = await sandbox.getInstance();
```

Snapshots and pause/resume exist in the Tenki SDK, but the provider doesn't wire them to ComputeSDK's snapshot methods yet. Reach them through `getInstance()`.

## Check it works

```bash
node verify.mjs
```

When it passes, it prints:

```text
✓ computesdk-tenki: compute.sandbox.create → runCommand (42) → filesystem round-trip → destroy
```

`verify.mjs` creates a sandbox through `compute`, runs `python3 -c 'print(6 * 7)'` and checks for exit code 0 and `42`, writes `/home/tenki/verify-note.txt` through the filesystem API, checks `exists()`, reads the file back and compares it, then destroys the sandbox. It exits non-zero on any failure. It reads the key from `TENKI_AUTH_TOKEN`, then `TENKI_API_KEY`, then the `auth_token` that `tenki login --api-key <key>` writes to `~/.config/tenki/config.yaml`. CI runs it on Node 20 with only `TENKI_API_KEY`.

A pass proves the provider can create a sandbox, run a shell command, and round-trip a file against live Tenki with your key. It doesn't run `run.mjs`, and it doesn't exercise `getUrl`, background commands, or `getInstance()`.

## Troubleshooting

- ❌ **``No token. Set TENKI_AUTH_TOKEN, or run `tenki login`.``** `verify.mjs` found no key in `TENKI_AUTH_TOKEN`, `TENKI_API_KEY`, or `~/.config/tenki/config.yaml`. Export a `tk_` key, or run `tenki login --api-key <key>`.
- ❌ **`Missing API key for Tenki.` from `node run.mjs`.** The provider found neither `TENKI_API_KEY` nor `TENKI_AUTH_TOKEN`, and `run.mjs` doesn't read `~/.config/tenki/config.yaml`, so `tenki login` alone isn't enough here. Export the key in the shell you run it from.
- ❌ **Authentication fails with a key that doesn't start with `tk_`.** The provider uses Tenki SDK 1.x, which accepts only `tk_` API keys. Create one at https://app.tenki.cloud.
- ❌ **`permission_denied … path outside workdir` from `sandbox.filesystem`.** The native file methods are confined to `/home/tenki`. Keep the path under `/home/tenki`, or write the file with a `runCommand` shell command instead.
- ❌ **`runCommand` never returns after you start a server with a trailing `&`.** A bare `&` holds the exec output stream open. Drop the `&` and pass `{ background: true }`.

## FAQ

**When shouldn't I use this?** When your code will only ever target Tenki and you want its full surface: SSH, volumes, snapshots, pause/resume. Use `@tenkicloud/sandbox` directly (see [`../run-code-in-a-sandbox/`](../run-code-in-a-sandbox/)). The provider doesn't map Tenki snapshots or pause/resume onto ComputeSDK's snapshot methods yet, and reaching them through `getInstance()` ties that code to Tenki anyway. ComputeSDK earns its place when you want to keep the provider swappable.

**What changes when I switch providers?** The import and the `provider` you pass to `compute.setConfig`. The `compute.sandbox` calls stay the same. Two parts of this example are Tenki-specific: the `/home/tenki` path in `run.mjs`, which is Tenki's working directory, and anything you do with `getInstance()`, which returns a Tenki `Session`.

**How long does a sandbox live?** `run.mjs` and `verify.mjs` destroy it in a `finally` block. If the process dies before that, the sandbox keeps running until its lifetime cap, because Tenki doesn't pause idle sandboxes. To set the cap, pass `timeout` in milliseconds to `compute.sandbox.create()`; the provider maps it to Tenki's `maxDurationMs`. The `timeout` option on `tenki()` is a different setting: the default `runCommand` timeout.

**Can I change the VM's size?** Yes. `tenki()` accepts `cpuCores`, `memoryMb` and `diskSizeGb` as defaults for every sandbox, and `compute.sandbox.create()` accepts the same keys to override them for one sandbox.

## Related

- [ComputeSDK](https://github.com/computesdk/computesdk)
- [`@computesdk/tenki` on npm](https://www.npmjs.com/package/@computesdk/tenki). Source: [`packages/tenki`](https://github.com/computesdk/computesdk/tree/main/packages/tenki) in the ComputeSDK repo, added in [computesdk#584](https://github.com/computesdk/computesdk/pull/584).
- [Tenki docs](https://tenki.cloud/docs)
- [`../run-code-in-a-sandbox/`](../run-code-in-a-sandbox/): the same create, run, destroy loop with `@tenkicloud/sandbox` directly.
- [`../expose-a-port/`](../expose-a-port/): preview URLs with the Tenki SDK.
