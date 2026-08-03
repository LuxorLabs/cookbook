# Run code in a Tenki sandbox

Boot a disposable microVM, run code in it, get the output, throw it away — the core Tenki loop, in ~15 lines with the official [`@tenkicloud/sandbox`](https://www.npmjs.com/package/@tenkicloud/sandbox) SDK.

## The code (`run.mjs`)

```js
import { TenkiSandbox, stdoutText } from "@tenkicloud/sandbox";

const tenki = new TenkiSandbox({ authToken: process.env.TENKI_AUTH_TOKEN });

// `await using` auto-terminates the sandbox when the scope ends.
await using sandbox = await tenki.createAndWait({
  cpuCores: 1,
  memoryMb: 1024,
  workspaceId: process.env.TENKI_WORKSPACE_ID,
});

const result = await sandbox.exec("python3", { args: ["-c", "print(6 * 7)"] });
console.log(`exit ${result.exitCode} -> ${stdoutText(result).trim()}`); // exit 0 -> 42
```

## Run it

```bash
npm install
export TENKI_AUTH_TOKEN=...      # from `tenki login` (~/.config/tenki/config.yaml)
export TENKI_WORKSPACE_ID=...
node run.mjs                     # exit 0 -> 42
```

## Notes

- **`exec(command, { args })` runs a bare binary + its args — no shell splitting.** For a shell one-liner, use `sandbox.exec("sh", { args: ["-c", "echo hi && ls"] })`.
- The sandbox boots in ~2s and is billed per second. `await using` disposes it automatically (`Session` is an `AsyncDisposable`); or call `await sandbox[Symbol.asyncDispose]()` explicitly.
- Requires Node 20+ for `await using`.
