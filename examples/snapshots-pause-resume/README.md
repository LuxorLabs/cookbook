# Pause, snapshot, and resume

Write a file into a Tenki sandbox, pause it, resume it, and read the file back. `pause()` saves the sandbox's memory and disk and releases the VM, so a paused sandbox costs nothing and leaves your concurrency quota. `resume()` brings back the same sandbox, with the same id, from that snapshot.

## Quick start

You need:

- Node.js 24 or later for `run.mjs`, which uses top-level `await using`. `verify.mjs` runs on Node 20.
- A Tenki API key (`tk_...`) from [app.tenki.cloud](https://app.tenki.cloud).

### 1. Install

```bash
git clone https://github.com/LuxorLabs/cookbook.git
cd cookbook/examples/snapshots-pause-resume
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
resumed -> still here after the pause
```

The pause takes about 20 seconds. The sandbox is terminated when the script ends, so nothing is left paused.

### 4. Verify

```bash
node verify.mjs
```

```
✓ snapshots-pause-resume: create → write → pause (snapshot ab12cd34) → resume → marker survived
```

The eight characters after `snapshot` are the start of the pause snapshot id. `verify.mjs` writes a unique marker, pauses, waits for `PAUSED`, checks that `pauseSnapshotId` is set, resumes, waits for `RUNNING`, and checks the marker. It terminates the sandbox in a `finally` block.

## The code

The core of `run.mjs`:

```js
// Leave a marker in the sandbox filesystem (relative paths resolve under /home/tenki).
await sandbox.writeFile("marker.txt", "still here after the pause");

await sandbox.pause(); // snapshot memory + disk, free the VM (state -> PAUSED)
await sandbox.resume(); // bring the same sandbox back (state -> RUNNING)

// The file survived: pause/resume preserved the filesystem.
const marker = new TextDecoder().decode(await sandbox.readFile("marker.txt"));
console.log(`resumed -> ${marker}`); // resumed -> still here after the pause
```

`sandbox` comes from `tenki.createAndWait({ cpuCores: 1, memoryMb: 1024 })` with `await using`.

## Wait for the state to settle

`pause()` and `resume()` return as the transition starts, while `sandbox.state` is still `PAUSING` or `RESUMING`. `run.mjs` resumes right away to stay short. In your own code, wait for `PAUSED` before resuming or relying on the checkpoint. `sandbox.waitPaused()` and `sandbox.waitResumed()` poll for you (180-second default timeout) and throw `PauseFailedError` or `ResumeFailedError` (with the server's `lastResumeError`) if the transition rolls back. `verify.mjs` polls by hand:

```js
// pause()/resume() resolve as the transition begins; poll refresh() until it settles.
const waitState = async (want) => {
  for (let i = 0; i < 40; i++) {
    await sandbox.refresh();
    if (sandbox.state === want) return;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`expected ${want}, got ${sandbox.state}`);
};
```

```js
  // pause() snapshots memory + disk, then frees the VM. Capture the id now — it clears on resume.
  await sandbox.pause();
  await waitState("PAUSED");
  const snap = sandbox.pauseSnapshotId;
  if (!snap) throw new Error("pause did not produce a durable snapshot");

  // resume() boots the same sandbox back from its pause snapshot.
  await sandbox.resume();
  await waitState("RUNNING");
```

## What survives a pause

- **Memory and processes.** The resumed sandbox is the same running machine, not a reboot. Processes keep their PIDs and in-memory state.
- **Files under `/home/tenki`.** `/tmp` is cleared.
- **Not connections.** A paused sandbox serves no traffic; preview requests return `404` until it resumes. A held keep-alive connection returns `200` again after resume. An SSH transport fails while paused and doesn't recover, so reconnect once the sandbox is `RUNNING`.

Timing and retention:

- Pausing takes about 20 seconds here. Resuming takes about 1 second, and file and exec calls work as soon as it returns.
- A pause snapshot expires after `pauseRetentionMs`, set at create time. After that the sandbox can't be resumed. `sandbox.pauseExpiresAt` shows when.
- Sandboxes don't pause on idle. Call `pause()` yourself.

## Restore into a new sandbox

Pause and resume revive the same sandbox. To start a different sandbox from saved state, for example to clone a warm environment or branch an agent's work, take an explicit snapshot. This example doesn't run these calls:

| Call | What it does |
| --- | --- |
| `tenki.createSnapshotAndWait(sandbox.id, { name })` | Snapshot a running sandbox. `expiresAt` is optional. |
| `tenki.createAndWait({ snapshotId: snap.id, ... })` | Boot a new sandbox, with a new id, from the snapshot. |
| `tenki.listSnapshots()`, `tenki.listSessionSnapshots(id)` | List snapshots. |
| `tenki.getSnapshotDownloadURL(snap.id)` | Export a snapshot. |
| `tenki.deleteSnapshot(snap.id)` | Delete it. |

Snapshots don't restore volume attachments, so re-attach volumes yourself. The SDK README's "Snapshots" section has an example.

## Troubleshooting

| Problem | Fix |
| --- | --- |
| `SyntaxError` at `await using sandbox` | Use Node 24 or later, or run `verify.mjs`. |
| ``No token. Set TENKI_AUTH_TOKEN, or run `tenki login`.`` | `verify.mjs` found no key. Export one or run `tenki login --api-key <key>`. |
| `missing auth token - set TENKI_AUTH_TOKEN or TENKI_API_KEY ...` | `run.mjs` reads only the environment. Export the key. |
| `invalid auth token - API keys and service tokens must start with tk_` | Create a `tk_` key at [app.tenki.cloud](https://app.tenki.cloud). |
| `✗ expected PAUSED, got PAUSING` (or `RUNNING`/`RESUMING`) | `verify.mjs` waits about 20 seconds, close to the pause time. Run it again. In your code, use `waitPaused()`/`waitResumed()`. |
| An old paused sandbox won't resume | Its snapshot expired. Set a longer `pauseRetentionMs` at create time. |
| A file in `/tmp` is gone after resume | Keep state under `/home/tenki`. |
| `permission_denied … path outside workdir` | SDK file calls are confined to `/home/tenki`. |

## Related

- [`@tenkicloud/sandbox` on npm](https://www.npmjs.com/package/@tenkicloud/sandbox): see "Durable pause", "What survives a pause", and "Snapshots"
- [Work with files](../files-in-a-sandbox/)
- [Run code in a sandbox](../run-code-in-a-sandbox/)
- [Tenki docs](https://tenki.cloud/docs)
