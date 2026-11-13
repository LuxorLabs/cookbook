# Host a long-running service

Keep a small web app running on a [Tenki](https://tenki.cloud) sandbox at a stable public address. A `sticky` sandbox runs until you stop it, managed startup launches the app at boot and restarts it if it exits, the app's data lives on a volume, and a named preview URL points at the app's port. Replace the sandbox and its data stays on the volume, and the URL points at the new sandbox. The demo app is a stdlib Python visit counter.

## Set it up with a coding agent

Paste this into Claude Code, Codex, Cursor, or another coding agent:

```text
Set up the Tenki "Host a long-running service" example from https://github.com/LuxorLabs/cookbook.
1. Clone the repo, cd into examples/host-a-service, and run npm install (Node.js 20 or later).
2. The scripts need a Tenki API key (starts with tk_) in TENKI_AUTH_TOKEN. If it isn't set, stop and ask me to export it (keys come from https://app.tenki.cloud). Never print the key or write it to a file.
3. Run node run.mjs from that directory. Give me the service URL it prints, and tell me the sandbox is sticky: it keeps running until I run node down.mjs.
4. Run node verify.mjs and confirm the ✓ line.
5. If a step fails, use the Troubleshooting table in the example's README.md.
Then show me how to swap app.py for my own app, and add a password to it, since the URL is public.
```

## Quick start

You need:

- Node.js 20 or later. The app runs on the sandbox's own `python3`, so you don't need Python locally.
- A Tenki API key (`tk_...`) from [app.tenki.cloud](https://app.tenki.cloud).

### 1. Install

```bash
git clone https://github.com/LuxorLabs/cookbook.git
cd cookbook/examples/host-a-service
npm install
```

### 2. Set your API key

```bash
export TENKI_AUTH_TOKEN=tk_...   # TENKI_API_KEY also works
```

`run.mjs` and `down.mjs` read the key from the environment only. `verify.mjs` also accepts a key saved with `tenki login --api-key <key>`. `TENKI_WORKSPACE_ID` is optional.

### 3. Run

```bash
node run.mjs
```

```text
GET 200 -> visit 1, served by frozen-trail-5df3

service URL:  https://visit-counter-4a2hdv--….sb.tenki.sh
sandbox:      01a1… (sticky: runs and bills until you stop it)
volume:       01a1…

stop it, keep the URL and data:  node down.mjs
delete the URL, data and all:    node down.mjs --delete
bring it back after a stop:      node run.mjs
```

Open the URL and reload it: the count goes up. The service keeps running after the script exits. `run.mjs` saves the volume, sandbox and URL ids in `.service.json` next to it, and `down.mjs` reads them from there.

Run `node down.mjs` and then `node run.mjs` again: a new sandbox (with a new hostname in the reply) serves the same URL, and the count continues where it stopped. `node down.mjs --delete` removes the preview URL and the volume too.

### 4. Verify

```bash
node verify.mjs
```

```text
  service URL: https://verify-host-gptu3g--….sb.tenki.sh
✓ host-a-service: volume → sticky rapid-valley-e58d → named URL visit 1,2 → rebuild → same URL → quiet-otter-b64f visit 3
```

`verify.mjs` creates a volume and a sticky sandbox, binds a named preview URL, and gets `visit 1` and `visit 2` through it. It then unbinds the URL, terminates the sandbox, boots a second one on the same volume, and re-binds the same URL. It checks that the URL is unchanged, that a different sandbox answers, and that the count reads `visit 3`. It deletes the URL, both sandboxes and the volume, pass or fail. It takes about 25 seconds.

## How it works

**1. A volume for the data.** It exists apart from any sandbox. The app writes its count to `/home/tenki/data/visits`, which is on the volume.

```js
const volume = await tenki.createVolume({ name: "visit-counter-…", sizeBytes: 1024 ** 3, workspaceId });
```

**2. A sticky sandbox that starts the app itself.** `directRuntime` takes a runtime-only `TemplateSpec`: the start command runs at boot, `restartPolicy: "always"` starts it again if it exits, and `readyWhen` with `waitForRuntime` makes `createAndWait` return once the port is open. The app's source travels in an env var, so nothing is copied in after boot.

```js
const runtime = new TemplateSpec().start('exec python3 -c "$APP_PY"', {
  restartPolicy: "always",
  readyWhen: [{ port: PORT }],
});
const sandbox = await tenki.createAndWait({
  cpuCores: 1,
  memoryMb: 1024,
  allowInbound: true, // the preview URL needs inbound traffic
  sticky: true, // runs until you terminate it: no lifetime cap
  volumes: [{ volumeId: state.volumeId, mountPath: DATA }],
  env: { APP_PY: readFileSync(new URL("app.py", import.meta.url), "utf8") },
  directRuntime: runtime,
  waitForRuntime: true, // return once the app is listening on PORT
  workspaceId,
});
```

**3. A named preview URL.** `tenki.previewUrls.create(slug, { sessionId, port })` gives the port a public HTTPS address named after `slug`, which must be unique in the workspace. Unlike `sandbox.exposePort()`, the URL is its own resource with its own id, so you can point it at another sandbox.

```js
const url = await tenki.previewUrls.create("visit-counter-…", { sessionId: sandbox.id, port: PORT, workspaceId });
```

**4. Replace the sandbox, keep the address.** To ship a new version or recover a broken sandbox, unbind the URL, terminate the sandbox, boot a new one on the same volume, and bind the URL to it. This is what `down.mjs` followed by `run.mjs` does:

```js
await tenki.previewUrls.unbind(urlId);   // first: terminating a bound sandbox deletes the URL
await oldSandbox.close();
// wait for the volume to show AVAILABLE, then boot the new sandbox as in step 2
await tenki.previewUrls.bind(urlId, newSandbox.id, PORT);
```

The same pattern works for any app you host yourself: put its start command in `TemplateSpec().start()`, its data on the volume, and bind the URL to its port. Preview URLs are public, with no Tenki login in front, so the app needs its own auth (a password, token or login).

## Troubleshooting

| Problem | Fix |
| --- | --- |
| ``No token. Set TENKI_AUTH_TOKEN, or run `tenki login`.`` | `verify.mjs` found no key. Export one or run `tenki login --api-key <key>`. |
| `missing auth token - set TENKI_AUTH_TOKEN or TENKI_API_KEY ...` | `run.mjs` and `down.mjs` read only the environment. Export the key in this shell. |
| `VolumeInUseError: … volume is attached to a session` | A volume attaches to one sandbox at a time, and stays attached for a few seconds after that sandbox ends. Wait for `getVolume(id).state` to be `AVAILABLE`. `run.mjs` waits up to a minute. |
| `already running: https://…` | `.service.json` points at a running sandbox. Run `node down.mjs` first. |
| The URL returns `404` | Nothing is bound to it, for example between `down.mjs` and the next `run.mjs`. |
| `[already_exists] preview URL is already bound` on `bind` | The URL still points at another sandbox. Call `previewUrls.unbind(id)` first. |
| `[not_found] preview URL not found` on `bind` | The sandbox was terminated while the URL was bound to it, which deletes the URL. `run.mjs` creates it again with the same slug. Unbind before you terminate. |
| `[already_exists] preview URL already exists` | The slug is taken in this workspace. Pick another, or bind the existing URL by id. |

## Notes

- **Sticky means no lifetime cap.** `sticky: true` discards `maxDurationMs` (the SDK prints a `STICKY_OVERRIDES_MAX_DURATION` warning if you pass both), and the sandbox runs, and bills, until you terminate it. `verify.mjs` checks the rebuild path, not how long a sandbox stays up.
- **Only the volume persists across sandboxes.** Anything the app writes outside `/home/tenki/data` is gone when its sandbox is terminated.
- **`$APP_PY` suits a one-file app.** For a bigger app, keep its code on the volume and have the start command run it from there.
- **The `token` field on a preview URL doesn't gate access.** Requests without it get through.
- **A paused sandbox serves nothing.** The URL returns `404` until it resumes.
- `previewUrls.list()`, `get(id)` and `delete(id)` manage URLs. `previewUrls.create` also takes `expiresAt` if you want the URL to stop serving on its own.

## Related

- [Expose a port](../expose-a-port/): a preview URL that lives as long as one sandbox
- [Run a full-stack app](../agent-fullstack-app/): an API, frontend and database in one sandbox
- [Pause, snapshot, and resume](../snapshots-pause-resume/)
- [`@tenkicloud/sandbox` on npm](https://www.npmjs.com/package/@tenkicloud/sandbox) and the [Tenki docs](https://tenki.cloud/docs)
