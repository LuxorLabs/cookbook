# How to write, read, and list files in a Tenki sandbox

**Audience:** Node.js developers who want to move files in and out of a disposable Tenki sandbox with the `@tenkicloud/sandbox` SDK.
**Time:** ~5 minutes, most of it creating an API key. Each script boots, uses, and disposes of a sandbox in a few seconds.
**Outcome:** A text file written into a live Tenki sandbox, read back, and listed, with the sandbox terminated when the script ends.

> **Honesty note:** `run.mjs` needs Node.js 24 or later, because it uses top-level `await using`, which Node 22 can't parse. `verify.mjs` doesn't use `await using`, so it runs on older versions. CI runs it on Node 20.

## Why bother

A Tenki sandbox is a disposable sandbox. Getting a file into one doesn't take `exec` or a shell: the official [`@tenkicloud/sandbox`](https://www.npmjs.com/package/@tenkicloud/sandbox) SDK has a built-in file API. This example writes a file into a sandbox, reads it back, and lists the directory, using three SDK calls.

## Install

```bash
git clone https://github.com/LuxorLabs/cookbook.git
cd cookbook/examples/files-in-a-sandbox
npm install
```

Every later command runs from this directory. `npm install` pulls one dependency, `@tenkicloud/sandbox` 1.4.1 or later.

## Authenticate

Create an API key at https://app.tenki.cloud. Keys start with `tk_`. Export it:

```bash
export TENKI_AUTH_TOKEN=tk_...
```

`TENKI_API_KEY` works too. `run.mjs` passes `TENKI_AUTH_TOKEN` to the SDK, and when that's unset the SDK reads `TENKI_AUTH_TOKEN`, then `TENKI_API_KEY`, from the environment. `verify.mjs` also falls back to the key that `tenki login --api-key <key>` stores in `~/.config/tenki/config.yaml`. `run.mjs` doesn't read that file, so it needs the environment variable.

`TENKI_WORKSPACE_ID` is optional. Both scripts pass it to `createAndWait` when it's set. Leave it unset and Tenki infers the workspace from your workspace API key.

## Use it

```bash
node run.mjs
```

It prints:

```
read back -> "hello from tenki\n"
- notes.txt (17 bytes)
```

This is all of `run.mjs`:

```js
// File I/O in a disposable Tenki sandbox: write a text file, read it back, list the dir.
// Uses the official @tenkicloud/sandbox SDK — no exec/shell needed for any of it.
import { TenkiSandbox } from "@tenkicloud/sandbox";

const tenki = new TenkiSandbox({ authToken: process.env.TENKI_AUTH_TOKEN });

// `await using` auto-terminates the sandbox when this scope ends (Session is AsyncDisposable).
await using sandbox = await tenki.createAndWait({
  cpuCores: 1,
  memoryMb: 1024,
  workspaceId: process.env.TENKI_WORKSPACE_ID,
});

const path = "notes.txt";
const text = "hello from tenki\n";

// Write a text file. Relative paths resolve under the guest home, /home/tenki.
await sandbox.writeFile(path, text);

// Read it back. readFile returns bytes (Uint8Array); decode to a string.
const roundTrip = new TextDecoder().decode(await sandbox.readFile(path));
console.log(`read back -> ${JSON.stringify(roundTrip)}`); // "hello from tenki\n"

// List the working directory. Each entry is a FileInfo { path, size, isDir, ... };
// `path` is the basename and `size` is a bigint.
for (const f of await sandbox.list(".")) {
  console.log(`${f.isDir ? "d" : "-"} ${f.path} (${f.size} bytes)`);
}
```

In the listing, `-` marks a file and `d` a directory.

## The file API

Three methods on `sandbox`, the `Session` that `createAndWait` returns, cover the loop:

- `sandbox.writeFile(path, data)` takes a `string` or a `Uint8Array`. The SDK encodes a string as UTF-8.
- `sandbox.readFile(path)` returns a `Uint8Array`. Wrap it in `new TextDecoder().decode(...)` for text.
- `sandbox.list(path)` returns `FileInfo[]`, each `{ path, size, isDir, mode, modifiedUnixNs }`. `path` is the entry's basename, and `size` is a `bigint`. Hidden entries are left out unless you pass `{ includeHidden: true }` as the second argument.

The session also has `mkdir(path)`, `stat(path)`, and `remove(path)` for the rest of the basics, and `readFileStream` / `writeFileStream` for large payloads. This example doesn't call them.

**Files live in `/home/tenki`.** The SDK's file methods are confined to `/home/tenki`, the guest home and the sandbox's working directory. Relative paths such as `notes.txt` resolve there, and `sandbox.list(".")` lists it. A `writeFile` or `readFile` outside it, such as `/tmp/notes.txt`, fails with `permission_denied … path outside workdir`. A shell command run with `exec` can write anywhere.

**`size` is a `bigint`.** `f.size === 17` is `false`, and arithmetic that mixes it with a number throws a `TypeError`. Convert it with `Number(f.size)` to compare it, or format it with `String(f.size)`. A template literal formats it too, which is why `run.mjs` prints `17 bytes`. `verify.mjs` converts before comparing:

```js
  // list the dir -> assert the file shows up as a file of the right size.
  const entries = await sandbox.list(".");
  const found = entries.find((f) => f.path === path);
  if (!found) throw new Error(`${path} not in listing: [${entries.map((f) => f.path).join(", ")}]`);
  if (found.isDir) throw new Error(`${path} listed as a directory, expected a file`);
  if (Number(found.size) !== bytes.length) {
    throw new Error(`listed size ${found.size} != ${bytes.length} bytes read`);
  }
```

**Cleanup.** `Session` is an `AsyncDisposable`, so `await using` in `run.mjs` terminates the sandbox when the script's scope ends. To dispose of it explicitly, call `await sandbox[Symbol.asyncDispose]()`, as `verify.mjs` does in a `finally` block. The sandbox boots in about 2 seconds and is billed per second.

## Check it works

```bash
node verify.mjs
```

On success it prints one line:

```
✓ files-in-a-sandbox: write → read "hello from tenki" → list (1 entry) → dispose
```

The number in parentheses is how many entries `list(".")` returned. In a fresh sandbox that's 1: `notes.txt`.

`verify.mjs` boots a live sandbox, writes `notes.txt`, and reads it back. It fails if the text that comes back differs, if `notes.txt` is missing from the listing or listed as a directory, or if its listed size differs from the bytes read. It exits non-zero on any failure and disposes of the sandbox in a `finally` block. CI runs it on Node 20 with only `TENKI_API_KEY` set. It proves the write, read, and list round-trip works against live Tenki. It doesn't run `run.mjs` or its `await using`, doesn't call `mkdir`, `stat`, `remove`, or the stream methods, and prints the `✓` line before disposing, so a failed dispose doesn't fail the check.

## Troubleshooting

**`SyntaxError: Unexpected identifier 'sandbox'` from `run.mjs`.** Node.js older than 24 can't parse top-level `await using`. Run `run.mjs` on Node 24 or later. `verify.mjs` runs on older versions.

**``No token. Set TENKI_AUTH_TOKEN, or run `tenki login`.``** `verify.mjs` found no key in `TENKI_AUTH_TOKEN`, `TENKI_API_KEY`, or `~/.config/tenki/config.yaml`. Export a `tk_` key, or run `tenki login --api-key <key>`.

**`missing auth token - set TENKI_AUTH_TOKEN or TENKI_API_KEY or use authToken option`.** The SDK found no key when `run.mjs` created its client. `run.mjs` reads only the environment, not `~/.config/tenki/config.yaml`, so `tenki login` alone isn't enough. Export `TENKI_AUTH_TOKEN` or `TENKI_API_KEY`.

**`invalid auth token - API keys and service tokens must start with tk_`.** The value you exported isn't a Tenki API key. Create one at https://app.tenki.cloud.

**`permission_denied … path outside workdir` from `writeFile` or `readFile`.** The SDK's file methods are confined to `/home/tenki`. Use a path under it (relative paths resolve there), or write elsewhere with a shell command through `exec`.

**`TypeError: Cannot mix BigInt and other types, use explicit conversions`.** `FileInfo.size` is a `bigint`. Convert it with `Number(f.size)` before doing arithmetic with it.

## FAQ

**When shouldn't I use this?** When your files must live outside `/home/tenki`: the file methods can't reach other paths, so write those with a shell command through `exec`. When you can't run Node 24 or later, because `run.mjs` won't parse; copy the `try`/`finally` pattern from `verify.mjs` instead. When your code is Python: this example is Node only, and Tenki's Python SDK is `tenki` (`pip install tenki`). And don't read a passing `verify.mjs` as coverage of `mkdir`, `stat`, `remove`, or the stream methods, because it doesn't call them.

**Do I need `TENKI_WORKSPACE_ID`?** No. A workspace API key implies its workspace, and CI runs `verify.mjs` with only `TENKI_API_KEY` set.

**What happens if a sandbox isn't disposed of?** It keeps running, and billing, until something terminates it. Sandboxes don't pause on idle. Pass `maxDurationMs` to `createAndWait` to cap a sandbox's lifetime.

## Related

- [`@tenkicloud/sandbox` on npm](https://www.npmjs.com/package/@tenkicloud/sandbox), the SDK this example uses
- [Tenki docs](https://tenki.cloud/docs) and [tenki.cloud](https://tenki.cloud)
- [Run code in a sandbox](../run-code-in-a-sandbox/), the same create, use, dispose loop with `exec`
- [Snapshots and pause/resume](../snapshots-pause-resume/), keeping a sandbox's memory and disk across a pause
