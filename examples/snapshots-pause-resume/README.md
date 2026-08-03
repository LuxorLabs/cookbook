# Snapshots & pause/resume

Save a Tenki sandbox's state, then bring it back later — the microVM's memory and disk survive. This is the "suspend now, resume where you left off" loop with the official [`@tenkicloud/sandbox`](https://www.npmjs.com/package/@tenkicloud/sandbox) SDK, and the same snapshot machinery that lets you fork a sandbox into a fresh one.

## The code (`run.mjs`)

```js
import { TenkiSandbox } from "@tenkicloud/sandbox";

const tenki = new TenkiSandbox({ authToken: process.env.TENKI_AUTH_TOKEN });

await using sandbox = await tenki.createAndWait({
  cpuCores: 1,
  memoryMb: 1024,
  workspaceId: process.env.TENKI_WORKSPACE_ID,
});

// Leave a marker in the sandbox filesystem (relative paths live under /home/tenki).
await sandbox.writeFile("marker.txt", "still here after the pause");

await sandbox.pause();   // snapshot memory + disk, free the VM (state -> PAUSED)
await sandbox.resume();  // bring the same sandbox back (state -> RUNNING)

// The file survived the round-trip.
const marker = new TextDecoder().decode(await sandbox.readFile("marker.txt"));
console.log(`resumed -> ${marker}`); // resumed -> still here after the pause
```

`pause()` captures the running microVM as a **pause snapshot** (memory + disk) and releases the compute; a paused sandbox keeps no live VM, so it drops out of your concurrency quota and you pay only for snapshot storage. `resume()` boots the *same* sandbox — same id — back from that snapshot.

## Run it

```bash
npm install
export TENKI_AUTH_TOKEN=...      # from `tenki login` (~/.config/tenki/config.yaml)
export TENKI_WORKSPACE_ID=...
node run.mjs                     # resumed -> still here after the pause
```

`verify.mjs` is the CI proof: it creates a sandbox, writes a unique marker, pauses (asserting the sandbox reaches `PAUSED` with a durable snapshot), resumes (asserting `RUNNING`), and asserts the marker read back unchanged — exiting non-zero on any failure and terminating the sandbox it created.

```bash
node verify.mjs   # ✓ create → write → pause (snapshot ab12cd34) → resume → marker survived
```

## Fork into a new sandbox (explicit snapshots)

Pause/resume revives the same sandbox. To **restore into a brand-new sandbox** — clone a warm environment, branch an agent's work, keep a reusable base — take an explicit snapshot and create *from* it:

```js
const snap = await tenki.createSnapshotAndWait(sandbox.id, { name: "warm-base" });

// A different sandbox, booted with the marker already in place.
const forked = await tenki.createAndWait({
  cpuCores: 1,
  memoryMb: 1024,
  workspaceId: process.env.TENKI_WORKSPACE_ID,
  snapshotId: snap.id,
});
// forked.id !== sandbox.id, but forked already has /home/tenki/marker.txt

await tenki.deleteSnapshot(snap.id); // when you no longer need the base
```

`listSnapshots()` / `listSessionSnapshots(id)` enumerate them, and `getSnapshotDownloadURL(id)` exports one.

## Notes

- **`pause()` / `resume()` resolve as the transition begins**, so `sandbox.state` reads `PAUSING` / `RESUMING` right after. Call `await sandbox.refresh()` to read the settled `PAUSED` / `RUNNING` state (that's what `verify.mjs` asserts on).
- **Pausing is not instant** — snapshotting memory + disk takes ~20s in this example. `resume()` is quick (~1s), and file/exec calls work immediately after it returns.
- **How long a paused sandbox stays resumable** is set by `pauseRetentionMs` at create time; after that the pause snapshot expires and the sandbox can't be resumed.
- **The two paths share one mechanism:** a pause snapshot revives the *same* sandbox; an explicit snapshot (`createSnapshotAndWait`) restores into a *new* one via `createAndWait({ snapshotId })`.
- Tenki confines file I/O to `/home/tenki` — use relative paths. Requires Node 20+ for `await using`.

Built on [Tenki](https://tenki.cloud) sandboxes.
