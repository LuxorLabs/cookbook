# How to pause a Tenki sandbox and resume it with its memory and disk intact

A sandbox is paused and resumed. A file written before the pause reads back unchanged after it, and the sandbox is terminated when the script ends.

About 5 minutes, most of it creating an API key and running `npm install`. The pause itself takes about 20 seconds in this example.

`run.mjs` needs Node.js 24 or later, because it uses top-level `await using`, which Node 22 cannot parse. `verify.mjs` uses `try`/`finally`, so it runs on older versions. CI runs it on Node 20.

## Why bother

`pause()` saves a running Tenki sandbox's memory and disk as a pause snapshot and releases the sandbox. A paused sandbox keeps no live VM, so it drops out of your concurrency quota, and pausing is free. `resume()` boots the same sandbox, with the same id, back from that snapshot. That's the "suspend now, resume where you left off" loop, with the official [`@tenkicloud/sandbox`](https://www.npmjs.com/package/@tenkicloud/sandbox) SDK. The same snapshot machinery lets you fork a sandbox into a new one.

## Install

```bash
git clone https://github.com/LuxorLabs/cookbook.git
cd cookbook/examples/snapshots-pause-resume
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
resumed -> still here after the pause
```

This is all of `run.mjs`:

```js
// Pause a Tenki sandbox and resume it later — its filesystem survives the round-trip.
// pause() snapshots memory + disk and stops the running machine; resume() brings it back.
import { TenkiSandbox } from "@tenkicloud/sandbox";

const tenki = new TenkiSandbox({ authToken: process.env.TENKI_AUTH_TOKEN });

// `await using` auto-terminates the sandbox when this scope ends (Session is AsyncDisposable).
await using sandbox = await tenki.createAndWait({
  cpuCores: 1,
  memoryMb: 1024,
  workspaceId: process.env.TENKI_WORKSPACE_ID,
});

// Leave a marker in the sandbox filesystem (relative paths resolve under /home/tenki).
await sandbox.writeFile("marker.txt", "still here after the pause");

await sandbox.pause(); // snapshot memory + disk, free the VM (state -> PAUSED)
await sandbox.resume(); // bring the same sandbox back (state -> RUNNING)

// The file survived: pause/resume preserved the filesystem.
const marker = new TextDecoder().decode(await sandbox.readFile("marker.txt"));
console.log(`resumed -> ${marker}`); // resumed -> still here after the pause
```

The sandbox gets 1 CPU core and 1024 MB of memory. `await using` terminates it when the script ends, so nothing is left paused afterwards.

## How pause and resume work

**`pause()` / `resume()` resolve as the transition begins.** Right after either call, `sandbox.state` reads `PAUSING` or `RESUMING`. Poll `await sandbox.refresh()` until `sandbox.state` settles at `PAUSED` or `RUNNING`. `verify.mjs` does this with a small helper:

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

and asserts on the settled state at each step:

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

`sandbox.pauseSnapshotId` holds the pause snapshot's id while the sandbox is paused. It clears on resume, so read it before you call `resume()`.

`run.mjs` is the shortest form and calls `resume()` as soon as `pause()` returns. The SDK README says to call `waitPaused()` before resuming or relying on a durable checkpoint, so in your own code wait for `PAUSED` first, as `verify.mjs` does. The SDK's `sandbox.waitPaused()` and `sandbox.waitResumed()` do the polling for you. Each defaults to a 180-second timeout. `waitPaused()` throws `PauseFailedError` if the sandbox rolls back to `RUNNING`, and `waitResumed()` throws `ResumeFailedError`, carrying the server's `lastResumeError`, if it falls back to a stopped state.

**Pausing is not instant.** Snapshotting memory and disk takes about 20 seconds in this example. `resume()` is quick, about 1 second, and file and exec calls work as soon as it returns.

**A paused sandbox stays resumable for a limited time.** `pauseRetentionMs`, set at create time, decides how long. After that the pause snapshot expires and the sandbox can't be resumed. The session also exposes `pauseExpiresAt`.

**What survives.** Pause captures the VM's full memory, not only its disk, so a resumed sandbox is the same running machine, not a reboot: processes keep their PIDs and in-memory state. Files under `/home/tenki` are preserved. `/tmp` is cleared across a pause. The SDK's file methods are confined to `/home/tenki` anyway: relative paths such as `marker.txt` resolve there.

### Restore into a new sandbox instead

Pause and resume revive the same sandbox. To restore into a brand-new sandbox, for example to clone a warm environment, branch an agent's work, or keep a reusable base, take an explicit snapshot and create from it. This example's scripts don't do this, but the SDK calls are:

- `tenki.createSnapshotAndWait(sandbox.id, { name })` snapshots a running sandbox and resolves with the `Snapshot` once it's ready. `expiresAt` is optional.
- `tenki.createAndWait({ snapshotId: snap.id, ... })` boots a different sandbox, with a new id, with the source's files already in place.
- `tenki.deleteSnapshot(snap.id)` removes the snapshot when you no longer need the base.
- `tenki.listSnapshots()` and `tenki.listSessionSnapshots(sandbox.id)` enumerate snapshots, and `tenki.getSnapshotDownloadURL(snap.id)` exports one.

The two paths share one mechanism: a pause snapshot revives the same sandbox, and an explicit snapshot restores into a new one through `createAndWait({ snapshotId })`. A snapshot doesn't restore volume attachments, so re-attach any volume yourself. The SDK README's Snapshots section has a short example.

## Check it works

```bash
node verify.mjs
```

On success it prints one line:

```
✓ snapshots-pause-resume: create → write → pause (snapshot ab12cd34) → resume → marker survived
```

The eight characters after `snapshot` are the start of the pause snapshot's id, so they differ on every run.

`verify.mjs` creates a sandbox, writes a unique marker to `marker.txt`, pauses, waits for `PAUSED`, and asserts that the pause produced a durable snapshot (`pauseSnapshotId` is set). It then resumes, waits for `RUNNING`, and asserts the marker reads back unchanged. It exits non-zero on any failure and terminates the sandbox it created in a `finally` block. CI runs it on Node 20 with only `TENKI_API_KEY` set.

It proves that a file written before a pause survives the round-trip against live Tenki, and that the sandbox settles in each state. It doesn't run `run.mjs` or its `await using`, doesn't check that memory or running processes survive, doesn't exercise explicit snapshots, forking, or `pauseRetentionMs` expiry, and prints the `✓` line before disposing, so a failed dispose doesn't fail the check.

## Troubleshooting

**`run.mjs` fails with a `SyntaxError` at `await using sandbox`.** Node.js older than 24 can't parse top-level `await using`. Run `run.mjs` on Node 24 or later. `verify.mjs` runs on older versions.

**``No token. Set TENKI_AUTH_TOKEN, or run `tenki login`.``** `verify.mjs` found no key in `TENKI_AUTH_TOKEN`, `TENKI_API_KEY`, or `~/.config/tenki/config.yaml`. Export a `tk_` key, or run `tenki login --api-key <key>`.

**`missing auth token - set TENKI_AUTH_TOKEN or TENKI_API_KEY or use authToken option`.** The SDK found no key when `run.mjs` created its client. `run.mjs` reads only the environment, not `~/.config/tenki/config.yaml`, so `tenki login` alone isn't enough. Export `TENKI_AUTH_TOKEN` or `TENKI_API_KEY`.

**`invalid auth token - API keys and service tokens must start with tk_`.** The value you exported isn't a Tenki API key. Create one at https://app.tenki.cloud.

**`✗ expected PAUSED, got PAUSING` (or `expected RUNNING, got RESUMING`).** `verify.mjs` polls `refresh()` up to 40 times, 500 ms apart, and the transition hadn't settled in that window. A pause takes about 20 seconds in this example, which is close to the window. Run it again: each run creates its own sandbox. In your own code, `waitPaused()` and `waitResumed()` wait up to 180 seconds by default.

**A sandbox paused long ago won't resume.** Its pause snapshot expired after `pauseRetentionMs`. Set a longer `pauseRetentionMs` when you create the sandbox.

**A file a shell command wrote to `/tmp` is gone after resume.** `/tmp` is cleared across a pause. Keep state you need under `/home/tenki`, which is preserved.

**`permission_denied … path outside workdir` from `writeFile` or `readFile`.** The SDK's file methods are confined to `/home/tenki`. Use a path under it (relative paths resolve there), or write elsewhere with a shell command through `exec`.

## FAQ

**When shouldn't I use this?** When you want a new sandbox from saved state rather than the same one back: use an explicit snapshot and `createAndWait({ snapshotId })`. When you expect a sandbox to pause itself: sandboxes don't auto-pause on idle, so call `pause()` yourself. When the state lives in `/tmp`, which a pause clears. When you need to resume from a later process: these scripts pause and resume inside one run and terminate the sandbox at the end. When you can't run Node 24 or later, because `run.mjs` won't parse; copy the `try`/`finally` pattern from `verify.mjs` instead. When your code is Python: this example is Node only, and Tenki's Python SDK is `tenki` (`pip install tenki`).

**What happens to connections while a sandbox is paused?** It serves no traffic: preview requests return `404` until it resumes. A held keep-alive connection isn't dropped and returns `200` again after resume. A held SSH transport fails on use while paused and doesn't recover, so open a new SSH connection once the sandbox is `RUNNING` again.

**Do I need `TENKI_WORKSPACE_ID`?** No. A workspace API key implies its workspace, and CI runs `verify.mjs` with only `TENKI_API_KEY` set.

## Related

- [`@tenkicloud/sandbox` on npm](https://www.npmjs.com/package/@tenkicloud/sandbox), the SDK this example uses, including its "Durable pause", "What survives a pause", and "Snapshots" sections
- [Tenki docs](https://tenki.cloud/docs) and [tenki.cloud](https://tenki.cloud)
- [Files in a sandbox](../files-in-a-sandbox/), the SDK file API (`writeFile`, `readFile`, `list`) in more depth
- [Run code in a sandbox](../run-code-in-a-sandbox/), the basic create, use, dispose loop
