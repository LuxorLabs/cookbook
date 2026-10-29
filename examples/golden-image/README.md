# Golden image: build once, restore per sandbox

Install a tool on one builder sandbox, snapshot it with `tenki.createSnapshotAndWait()`, and create a new sandbox from that snapshot with `tenki.createAndWait({ snapshotId })`. The install runs once; every later sandbox boots in seconds with the tool already there. The builder is terminated as soon as the snapshot is ready, the restored sandbox when the script ends, and the demo's snapshot is deleted at the end.

## Set it up with a coding agent

Paste this into Claude Code, Codex, Cursor, or another coding agent:

```text
Set up the Tenki "Golden image" example from https://github.com/LuxorLabs/cookbook.
1. Clone the repo and cd into examples/golden-image.
2. Check that Node.js is 24 or later, then run npm install.
3. The scripts need a Tenki API key (starts with tk_) in TENKI_AUTH_TOKEN. If it isn't set, stop and ask me to export it (keys come from https://app.tenki.cloud). Never print the key or write it to a file.
4. Run node run.mjs and confirm it prints "restored -> hello from the golden image", then run node verify.mjs.
5. If a step fails, use the Troubleshooting table in the example's README.md.
Then show me how to turn my own install script into a golden image that is kept, and how to create sandboxes from it by id.
```

## Quick start

You need:

- Node.js 24 or later for `run.mjs`, which uses top-level `await using`. `verify.mjs` runs on Node 20.
- A Tenki API key (`tk_...`) from [app.tenki.cloud](https://app.tenki.cloud).

### 1. Install

```bash
git clone https://github.com/LuxorLabs/cookbook.git
cd cookbook/examples/golden-image
npm install
```

### 2. Set your API key

```bash
export TENKI_AUTH_TOKEN=tk_...   # TENKI_API_KEY also works
```

`run.mjs` reads the key from the environment only. `verify.mjs` also accepts a key saved with `tenki login --api-key <key>`. `TENKI_WORKSPACE_ID` is optional.

### 3. Run

```bash
node run.mjs
```

```
golden image 1d2beec7-08ee-40fe-be55-038cb82d1fb8 is READY
restored -> hello from the golden image
```

About 15 seconds in all. The builder is disposed as soon as the snapshot is ready, the restored sandbox when the script ends, and the demo's snapshot is deleted at the end. A real golden image is the one thing you keep.

### 4. Verify

```bash
node verify.mjs
```

```
✓ golden-image: builder → install → snapshot d3bff7eb → new sandbox from it → tool runs
```

`verify.mjs` installs a tool that prints a marker unique to the run, snapshots, terminates the builder, creates a new sandbox from the snapshot, checks that it has a different id and that the tool prints the marker. It terminates both sandboxes and deletes the snapshot in a `finally` block.

## The code

The core of `run.mjs`:

```js
// 1. The builder. Make it the SMALLEST machine you will ever restore the image onto.
await using builder = await tenki.createAndWait({ cpuCores: 1, memoryMb: 1024 });
await builder.exec(["sh", "-c", "... your install ..."]);

// 2. Snapshot it. The snapshot outlives the builder.
const snapshot = await tenki.createSnapshotAndWait(builder.id, { name: "golden-example" });

// 3. Restore. A new sandbox, with a new id, that already has the tool installed.
await using sandbox = await tenki.createAndWait({ snapshotId: snapshot.id, cpuCores: 1, memoryMb: 1024 });
const r = await sandbox.exec(["sh", "-lc", "~/.local/bin/hello"]);
console.log(`restored -> ${stdoutText(r).trim()}`);
```

To keep the image, omit `expiresAt` on the snapshot and store `snapshot.id` in your configuration. Every `tenki.createAndWait({ snapshotId })` after that is a restore. Rebuild by running the builder again and swapping the id; the old snapshot stays until you `deleteSnapshot` it, so sandboxes made from it keep working through the switch.

## What we learned

These are measured on a golden image that is restored for every visitor of a public site, and they are the reasons this example is shaped the way it is.

**The builder's size is a floor on every restore.** A restored sandbox never comes up smaller than the snapshot it restores. A create asking for 8 cores and 16 GiB from a 16-core, 64 GiB image produced a guest reporting 16 cores and 63 GiB, while a create with no snapshot honoured the request exactly. Above the floor, the request is what you get. So build on the smallest machine you will ever hand out, and offer bigger sizes from it: a 2-core, 4 GiB image restores fine onto a 16-core machine, and the reverse makes a cheap sandbox impossible. The same holds for the disk: `diskSizeGb` on the builder is the smallest disk a restore will have.

**Background a long build and poll a sentinel.** An `exec` that runs for many minutes can be cut off at the gateway. Start the build detached, have it `touch ~/DONE` at the end, and poll for the file:

```js
await builder.exec(["sh", "-c", "setsid sh ~/build.sh >~/build.log 2>&1 </dev/null & echo started"]);
for (;;) {
  const r = await builder.exec(["sh", "-c", "test -f ~/DONE && echo DONE"]);
  if (stdoutText(r).includes("DONE")) break;
  await new Promise((f) => setTimeout(f, 30_000));
}
```

Stop polling after a few consecutive errors that say the session cannot be resolved: a builder that disappears mid-build would otherwise be polled forever.

**Stop services by PID, never with a broad `pkill`.** Anything the build started (a dev server, a package manager's daemon) would be snapshotted mid-write. Kill those processes by exact pid before the snapshot. A pattern like `pkill -f node` inside a Tenki sandbox can take the guest agent with it, after which nothing answers.

**Do not trust a snapshot timeout.** `createSnapshotAndWait` waits for you. If your own call sits behind a gateway with a shorter timeout, a 524 can come back while the snapshot is in fact being made and lands READY a minute later. On a timeout, list the workspace's snapshots and look for the newest one with your name before retrying, or you will build the image twice.

**Keep the home directory clean.** Remove the build scripts, logs and sentinel before snapshotting, and `sync`. Everything under `/home/tenki` at snapshot time is in every restore.

**A snapshot is not an image.** For a tag you can name in `create({ image })`, share across workspaces or build from a typed template, publish the snapshot to the registry with `tenki.publishRegistryImage({ fromSnapshotId })`. A snapshot id is enough for a single workspace, and it is what this example uses.

## Troubleshooting

| Problem | Fix |
| --- | --- |
| `SyntaxError` at `await using builder` | Use Node 24 or later, or run `verify.mjs`. |
| ``No token. Set TENKI_AUTH_TOKEN, or run `tenki login`.`` | `verify.mjs` found no key. Export one or run `tenki login --api-key <key>`. |
| `missing auth token - set TENKI_AUTH_TOKEN or TENKI_API_KEY ...` | `run.mjs` reads only the environment. Export the key. |
| `snapshot is FAILED` | The builder was still writing, or ran out of disk. Stop its services, check `isDiskExhausted` on your install's result, try again. |
| The restored sandbox is bigger than you asked for | The builder was bigger. Rebuild on the smallest size you will ever restore onto. |
| A restore cannot find the snapshot | It expired (`expiresAt`), was deleted, or belongs to another workspace. Snapshots are private to their workspace. |
| `storage quota exceeded` | Each snapshot holds a full disk. Delete old golden images you no longer create from. |

## Related

- [Pause, snapshot, and resume](../snapshots-pause-resume/): the same sandbox, paused and brought back
- [Run code in a sandbox](../run-code-in-a-sandbox/)
- [`@tenkicloud/sandbox` on npm](https://www.npmjs.com/package/@tenkicloud/sandbox): see "Snapshots" and "Registry"
- [Tenki docs](https://tenki.cloud/docs)
