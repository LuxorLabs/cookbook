# Work with files

Write a text file into a Luxor sandbox, read it back, and list the directory, using the file API in the [`@luxorai/sandbox`](https://www.npmjs.com/package/@luxorai/sandbox) SDK. No `exec` or shell needed. The sandbox is terminated when the script ends.

## Set it up with a coding agent

Paste this into Claude Code, Codex, Cursor, or another coding agent:

```text
Set up the Luxor Agent Cloud "Work with files" example from https://github.com/LuxorLabs/cookbook.
1. Clone the repo and cd into examples/files-in-a-sandbox.
2. Check that Node.js is 24 or later, then run npm install.
3. The scripts need a Luxor Agent Cloud API key (starts with tk_) in LUXORAI_AUTH_TOKEN. If it isn't set, stop and ask me to export it (keys come from https://app.luxor.ai). Never print the key or write it to a file.
4. Run node run.mjs and confirm it reads back "hello from luxor" and lists notes.txt, then run node verify.mjs.
5. If a step fails, use the Troubleshooting table in the example's README.md.
Then show me how to upload a local file into the sandbox and download a result back.
```

## Quick start

You need:

- Node.js 24 or later. `run.mjs` uses top-level `await using`, which Node 22 cannot parse. `verify.mjs` runs on Node 20.
- A Luxor Agent Cloud API key (`tk_...`) from [app.luxor.ai](https://app.luxor.ai).

### 1. Install

```bash
git clone https://github.com/LuxorLabs/cookbook.git
cd cookbook/examples/files-in-a-sandbox
npm install
```

### 2. Set your API key

```bash
export LUXORAI_AUTH_TOKEN=tk_...   # LUXORAI_API_KEY also works
```

`run.mjs` reads the key from the environment only. `verify.mjs` also accepts a key saved with `luxor login --api-key <key>`. `LUXORAI_WORKSPACE_ID` is optional.

### 3. Run

```bash
node run.mjs
```

```
read back -> "hello from luxor\n"
- notes.txt (17 bytes)
```

`-` marks a file and `d` a directory.

### 4. Verify

```bash
node verify.mjs
```

```
✓ files-in-a-sandbox: write → read "hello from luxor" → list (1 entry) → dispose
```

`verify.mjs` writes `notes.txt`, reads it back, and fails if the text differs, if the file is missing from the listing or listed as a directory, or if its listed size differs from the bytes read. It disposes of the sandbox in a `finally` block.

## The code

The core of `run.mjs`:

```js
const path = "notes.txt";
const text = "hello from luxor\n";

// Write a text file. Relative paths resolve under the guest home, /home/tenki.
await sandbox.writeFile(path, text);

// Read it back. readFile returns bytes (Uint8Array); decode to a string.
const roundTrip = new TextDecoder().decode(await sandbox.readFile(path));
console.log(`read back -> ${JSON.stringify(roundTrip)}`); // "hello from luxor\n"

// List the working directory. Each entry is a FileInfo { path, size, isDir, ... };
// `path` is the basename and `size` is a bigint.
for (const f of await sandbox.list(".")) {
  console.log(`${f.isDir ? "d" : "-"} ${f.path} (${f.size} bytes)`);
}
```

`sandbox` comes from `luxor.createAndWait({ cpuCores: 1, memoryMb: 1024 })` with `await using`, as in [Run code in a sandbox](../run-code-in-a-sandbox/).

## The file API

| Method | Notes |
| --- | --- |
| `writeFile(path, data)` | `data` is a `string` (written as UTF-8) or a `Uint8Array`. |
| `readFile(path)` | Returns a `Uint8Array`. Decode with `new TextDecoder().decode(...)`. |
| `list(path)` | Returns `FileInfo[]`: `{ path, size, isDir, mode, modifiedUnixNs }`. Pass `{ includeHidden: true }` to include dotfiles. |
| `mkdir`, `stat`, `remove` | The rest of the basics. Not used in this example. |
| `readFileStream`, `writeFileStream` | For large payloads. Not used in this example. |

Things to know:

- **File methods are confined to `/home/tenki`.** Relative paths resolve there. A path such as `/tmp/notes.txt` fails with `permission_denied … path outside workdir`. Commands run with `exec` can write anywhere.
- **`size` is a `bigint`.** `f.size === 17` is `false`, and mixing it with a number throws. Use `Number(f.size)` before comparing or doing arithmetic.
- **Dispose of every sandbox.** Sandboxes are billed per second and run until terminated. On Node versions without `await using`, call `await sandbox[Symbol.asyncDispose]()` in a `finally` block, as `verify.mjs` does. Pass `maxDurationMs` to `createAndWait` to cap a sandbox's lifetime.

## Troubleshooting

| Error | Fix |
| --- | --- |
| `SyntaxError: Unexpected identifier 'sandbox'` from `run.mjs` | Use Node 24 or later. |
| ``No token. Set LUXORAI_AUTH_TOKEN, or run `luxor login`.`` | `verify.mjs` found no key. Export one or run `luxor login --api-key <key>`. |
| `missing auth token - set LUXORAI_AUTH_TOKEN or LUXORAI_API_KEY ...` | `run.mjs` reads only the environment. Export `LUXORAI_AUTH_TOKEN` or `LUXORAI_API_KEY`. |
| `invalid auth token - API keys and service tokens must start with tk_` | Create a `tk_` key at [app.luxor.ai](https://app.luxor.ai). |
| `permission_denied … path outside workdir` | Use a path under `/home/tenki`, or write it with a shell command through `exec`. |
| `TypeError: Cannot mix BigInt and other types` | Convert `FileInfo.size` with `Number()` first. |

## Related

- [Run code in a sandbox](../run-code-in-a-sandbox/): the same lifecycle with `exec`
- [Pause, snapshot, and resume](../snapshots-pause-resume/): keep a sandbox's files and memory across a pause
- [`@luxorai/sandbox` on npm](https://www.npmjs.com/package/@luxorai/sandbox) and the [Luxor Agent Cloud docs](https://luxor.ai/docs)
