# Tenki as a ComputeSDK provider

Run code on [Tenki](https://tenki.cloud) through [ComputeSDK](https://github.com/computesdk/computesdk) — one `compute.sandbox` interface, swappable backends. The official [`@computesdk/tenki`](https://www.npmjs.com/package/@computesdk/tenki) provider maps that interface onto Tenki microVMs: shell commands, a native filesystem API, and public preview URLs, with no code changes if you later switch providers.

## The code (`run.mjs`)

```js
import { compute } from "computesdk";
import { tenki } from "@computesdk/tenki";

compute.setConfig({ provider: tenki({ apiKey: process.env.TENKI_API_KEY }) });

const sandbox = await compute.sandbox.create();
try {
  const hello = await sandbox.runCommand('echo "Hello from $(uname -sr)"');
  console.log(hello.stdout.trim());

  await sandbox.filesystem.writeFile("/home/tenki/app.py", 'print(6 * 7)\n');
  const result = await sandbox.runCommand("python3 /home/tenki/app.py");
  console.log(result.stdout.trim()); // 42
} finally {
  await sandbox.destroy();
}
```

## Run it

```bash
npm install
export TENKI_API_KEY=tk_...      # or TENKI_AUTH_TOKEN; from your Tenki workspace settings
node run.mjs                     # Hello from Linux ... / 42
```

Workspace API keys infer their workspace server-side; set `TENKI_WORKSPACE_ID` only for trusted service credentials that need explicit scope.

## Beyond commands and files

```js
// Serve something, then expose the port at a public https://<slug>.sb.tenki.sh URL
await sandbox.runCommand("python3 -m http.server 3000", { background: true });
const url = await sandbox.getUrl({ port: 3000 });

// Escape hatch: the underlying @tenkicloud/sandbox Session for SSH, volumes, snapshots
const session = await sandbox.getInstance();
```

## Notes

- **`runCommand` wraps commands in `sh -lc`** (Tenki's raw exec is argv-only, no shell), so pipes, globs, and env expansion behave as expected.
- **The filesystem API is native** — `writeFile`/`readFile`/`mkdir`/`readdir`/`exists`/`remove` ride Tenki's data plane, not shell commands, so any path or content works without escaping hazards.
- **Long-running processes:** use `{ background: true }` rather than a trailing `&` — a bare `&` holds the exec output stream open.
- Requires Node 20+ (the Tenki SDK's gRPC transport depends on it).
- Provider source: [`packages/tenki`](https://github.com/computesdk/computesdk/tree/main/packages/tenki) in the ComputeSDK repo, added in [computesdk#584](https://github.com/computesdk/computesdk/pull/584).
