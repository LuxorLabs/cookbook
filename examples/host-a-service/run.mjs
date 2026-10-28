// Host a long-running service on Tenki: a sticky sandbox runs app.py at boot, its data lives on
// a volume, and a named preview URL gives it a stable public address. Leaves the service running.
// Run it again after `node down.mjs` and it comes back on the same URL with the same data.
import { TenkiSandbox, TemplateSpec } from "@tenkicloud/sandbox";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const PORT = 8000;
const DATA = "/home/tenki/data"; // where the volume is mounted
const STATE = new URL(".service.json", import.meta.url); // ids of what this script created
const state = existsSync(STATE) ? JSON.parse(readFileSync(STATE, "utf8")) : {};
const save = () => writeFileSync(STATE, JSON.stringify(state, null, 2) + "\n");

const workspaceId = process.env.TENKI_WORKSPACE_ID;
const tenki = new TenkiSandbox({ authToken: process.env.TENKI_AUTH_TOKEN, workspaceId });

if (state.sandboxId) {
	const old = await tenki.get(state.sandboxId).catch(() => undefined);
	if (old?.state === "RUNNING") {
		console.log(`already running: ${state.url}\nstop it first with: node down.mjs`);
		process.exit(0);
	}
}

// 1. A volume for the app's data. It outlives any one sandbox.
if (!state.volumeId) {
	const volume = await tenki.createVolume({ name: `visit-counter-${suffix()}`, sizeBytes: 1024 ** 3, workspaceId });
	Object.assign(state, { volumeId: volume.id });
	save();
}
// A volume attaches to one sandbox at a time, and stays attached for a few seconds after it ends.
for (let i = 0; (await tenki.getVolume(state.volumeId)).state !== "AVAILABLE"; i++) {
	if (i === 30) throw new Error(`volume ${state.volumeId} is still attached to another sandbox`);
	await new Promise((r) => setTimeout(r, 2000));
}

// 2. A sticky sandbox that starts the app at boot and restarts it if it exits.
//    The app source travels in an env var, so nothing has to be copied in first.
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
state.sandboxId = sandbox.id;
save();

// 3. A named preview URL bound to the app's port. Reuse it if this isn't the first run.
// If the old sandbox was terminated while still bound, the URL went with it: create it again.
let url;
if (state.urlId) {
	url = await tenki.previewUrls.bind(state.urlId, sandbox.id, PORT).catch((e) => {
		if (!/not.found/i.test(String(e?.message))) throw e;
	});
}
url ??= await tenki.previewUrls.create(state.slug ?? (state.slug = `visit-counter-${suffix()}`), {
	sessionId: sandbox.id,
	port: PORT,
	workspaceId,
});
Object.assign(state, { urlId: url.id, url: url.previewUrl });
save();

// 4. Hit it once from here, the way a browser would.
for (let i = 0; i < 15; i++) {
	const res = await fetch(url.previewUrl).catch(() => undefined);
	if (res?.ok) {
		console.log(`GET ${res.status} -> ${(await res.text()).trim()}`);
		break;
	}
	await new Promise((r) => setTimeout(r, 2000));
}

console.log(`
service URL:  ${url.previewUrl}
sandbox:      ${sandbox.id} (sticky: runs and bills until you stop it)
volume:       ${state.volumeId}

stop it, keep the URL and data:  node down.mjs
delete the URL, data and all:    node down.mjs --delete
bring it back after a stop:      node run.mjs`);

function suffix() {
	return Math.random().toString(36).slice(2, 8);
}
