// Stop the service that run.mjs started.
//   node down.mjs            terminate the sandbox; keep the URL and the volume for the next run
//   node down.mjs --delete   also delete the preview URL and the volume (and its data)
import { TenkiSandbox } from "@tenkicloud/sandbox";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";

const STATE = new URL(".service.json", import.meta.url);
if (!existsSync(STATE)) {
	console.log("nothing to stop: no .service.json here");
	process.exit(0);
}
const state = JSON.parse(readFileSync(STATE, "utf8"));
const del = process.argv.includes("--delete");
const tenki = new TenkiSandbox({ authToken: process.env.TENKI_AUTH_TOKEN, workspaceId: process.env.TENKI_WORKSPACE_ID });
const gone = (e) => /not.found/i.test(String(e?.message)); // already deleted
const ignoreGone = (e) => {
	if (!gone(e)) throw e;
};

// Unbind first: terminating a sandbox deletes any preview URL still bound to it.
if (state.urlId) await tenki.previewUrls.unbind(state.urlId).catch(ignoreGone);
if (state.sandboxId) {
	const sandbox = await tenki.get(state.sandboxId).catch(() => undefined);
	await sandbox?.closeIfOpen();
	console.log(`terminated sandbox ${state.sandboxId}`);
	delete state.sandboxId;
}

if (!del) {
	writeFileSync(STATE, JSON.stringify(state, null, 2) + "\n");
	console.log(`kept ${state.url} and volume ${state.volumeId}. Run node run.mjs to bring the service back.`);
	process.exit(0);
}

if (state.urlId) {
	await tenki.previewUrls.delete(state.urlId).catch(ignoreGone);
	console.log(`deleted ${state.url}`);
}
if (state.volumeId) {
	// The volume stays attached for a few seconds after its sandbox ends.
	for (let i = 0; ; i++) {
		try {
			await tenki.deleteVolume(state.volumeId);
			break;
		} catch (e) {
			if (gone(e)) break;
			if (i === 30) throw e;
			await new Promise((r) => setTimeout(r, 2000));
		}
	}
	console.log(`deleted volume ${state.volumeId}`);
}
rmSync(STATE);
