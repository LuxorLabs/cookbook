# Files in a Tenki sandbox

Write a file into a disposable microVM, read it back, and list the directory — all over the SDK's built-in file API, no `exec` or shell required. Uses the official [`@tenkicloud/sandbox`](https://www.npmjs.com/package/@tenkicloud/sandbox) SDK.

## The code (`run.mjs`)

```js
import { TenkiSandbox } from "@tenkicloud/sandbox";

const tenki = new TenkiSandbox({ authToken: process.env.TENKI_AUTH_TOKEN });

// `await using` auto-terminates the sandbox when the scope ends.
await using sandbox = await tenki.createAndWait({
  cpuCores: 1,
  memoryMb: 1024,
  workspaceId: process.env.TENKI_WORKSPACE_ID,
});

const path = "notes.txt";
const text = "hello from tenki\n";

// Write a text file. Relative paths resolve under the guest home, /home/tenki.
await sandbox.writeFile(path, text);

// Read it back — readFile returns bytes (Uint8Array); decode to a string.
const roundTrip = new TextDecoder().decode(await sandbox.readFile(path));
console.log(`read back -> ${JSON.stringify(roundTrip)}`); // "hello from tenki\n"

// List the working directory. Each entry is a FileInfo { path, size, isDir, ... }.
for (const f of await sandbox.list(".")) {
  console.log(`${f.isDir ? "d" : "-"} ${f.path} (${f.size} bytes)`);
}
```

## Run it

```bash
npm install
export TENKI_AUTH_TOKEN=...      # from `tenki login` (~/.config/tenki/config.yaml)
export TENKI_WORKSPACE_ID=...
node run.mjs
```

Or prove it end-to-end against live Tenki — writes, reads back, lists, asserts the round-trip, and disposes the sandbox:

```bash
node verify.mjs   # ✓ files-in-a-sandbox: write → read "hello from tenki" → list (1 entry) → dispose
```

## The file API

Three methods on the session handle the whole loop — no subprocess needed:

- **`sandbox.writeFile(path, data)`** — `data` is a `string` or `Uint8Array`. Writes atomically to the guest filesystem.
- **`sandbox.readFile(path)`** — returns a `Uint8Array`. Wrap it in `new TextDecoder().decode(...)` for text.
- **`sandbox.list(path)`** — returns `FileInfo[]`, each `{ path, size, isDir, mode, modifiedUnixNs, ... }`. `path` is the entry's basename and `size` is a `bigint` (use `Number(size)` or `String(size)`).

The session also exposes `mkdir(path)`, `stat(path)`, and `remove(path)` for the rest of the basics, plus `readFileStream` / `writeFileStream` for large payloads.

## Notes

- **Tenki confines file I/O to `/home/tenki`** (the guest home and default working dir). Relative paths like `notes.txt` resolve there; `sandbox.list(".")` lists it.
- `size` on a `FileInfo` is a **`bigint`** — compare with `Number(f.size)` or format with `String(f.size)`, not directly against a JS number literal in arithmetic-sensitive code.
- The sandbox boots in ~2s and is billed per second. `await using` disposes it automatically (`Session` is an `AsyncDisposable`); or call `await sandbox[Symbol.asyncDispose]()` explicitly.
- Requires Node 20+ for `await using`.

Learn more at [tenki.cloud](https://tenki.cloud).
