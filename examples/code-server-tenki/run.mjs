// VS Code in the browser on a persistent Tenki dev box: code-server in a sticky sandbox,
// the workspace on a volume, and one named preview URL that outlives any single sandbox.
//   node run.mjs [git-url]   start the box (or reattach to it), optionally cloning a repo
//   node run.mjs stop        terminate the sandbox; keep the workspace volume and the URL
//   node run.mjs delete      terminate the sandbox and delete the volume and the URL
import { TenkiSandbox, WaitReadyFailedError, stderrText, stdoutText, volumeIsDeletable } from "@tenkicloud/sandbox";
import { randomBytes } from "node:crypto";
import { userInfo } from "node:os";

const VERSION = "4.143.1"; // https://github.com/coder/code-server/releases
const PORT = 8080;
const WORK = "/home/tenki/workspace"; // the volume's mount point; everything else is lost on rebuild
// BOX names the volume, the URL slug and the sandbox tag. Slugs are unique per workspace.
const BOX = (process.env.BOX || `code-server-${userInfo().username}`).toLowerCase().replace(/[^a-z0-9-]+/g, "-");
const [cmd = "up", repo] = /^(up|stop|delete)$/.test(process.argv[2] ?? "up") ? process.argv.slice(2) : ["up", process.argv[2]];

const tenki = new TenkiSandbox({ authToken: process.env.TENKI_AUTH_TOKEN || process.env.TENKI_API_KEY });
const workspaceId = process.env.TENKI_WORKSPACE_ID;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const findUrl = async () => (await tenki.previewUrls.list({ workspaceId })).find((u) => u.slug === BOX);
const findVolume = async () => (await tenki.listVolumes({ workspaceId })).find((v) => v.name === BOX);
const runningBoxes = async () => (await tenki.list({ workspaceId, tags: [BOX] })).filter((s) => s.state !== "TERMINATED" && s.state !== "TERMINATING");

if (cmd === "stop" || cmd === "delete") {
	// Unbind first: terminating a sandbox deletes any named URL still bound to it.
	const url = await findUrl();
	if (url?.sessionId) await tenki.previewUrls.unbind(url.id);
	for (const s of await runningBoxes()) await s.close();
	if (cmd === "delete") {
		if (url) await tenki.previewUrls.delete(url.id);
		const vol = await findVolume();
		// The volume detaches a few seconds after its sandbox terminates.
		for (let i = 0; vol && i < 30 && !volumeIsDeletable(await tenki.getVolume(vol.id)); i++) await sleep(2000);
		if (vol) await tenki.deleteVolume(vol.id);
	}
	console.log(cmd === "stop" ? `${BOX}: sandbox stopped; workspace and ${url?.previewUrl ?? "URL"} kept` : `${BOX}: deleted`);
	process.exit(0);
}

// Reserve the slug before paying for a sandbox, so a name clash fails early.
let url = (await findUrl()) ?? (await tenki.previewUrls.create(BOX, { workspaceId }));
const vol = (await findVolume()) ?? (await tenki.createVolume({ workspaceId, name: BOX, sizeBytes: 10 * 2 ** 30 }));
let box = (await runningBoxes())[0];
if (!box) {
	await tenki.waitVolumeReady(vol.id, 120_000); // a just-stopped box may still hold it
	// sticky: runs until you stop it (no two-hour cap). A half-born sandbox comes back on the error.
	box = await tenki.createAndWait({
		name: BOX, tags: [BOX], sticky: true, allowInbound: true, cpuCores: 2, memoryMb: 4096, workspaceId,
		volumes: [{ volumeId: vol.id, mountPath: WORK }],
	}).catch(async (e) => {
		if (e instanceof WaitReadyFailedError) await e.session.close();
		throw e;
	});
}

// Idempotent: install code-server onto the volume once, keep one password on the volume,
// and start the server unless it already answers. The password is code-server's own login.
const D = `${WORK}/.code-server`;
const BIN = `${D}/code-server-${VERSION}-linux-amd64/bin/code-server`;
const setup = `set -e; mkdir -p ${D}; umask 077
test -s ${D}/password || printf %s "$NEW_PASSWORD" > ${D}/password
test -x ${BIN} || curl -fsSL https://github.com/coder/code-server/releases/download/v${VERSION}/code-server-${VERSION}-linux-amd64.tar.gz | tar -xz -C ${D}
${repo ? `test -d ${WORK}/$(basename "$REPO" .git) || git clone -q "$REPO" ${WORK}/$(basename "$REPO" .git)` : ""}
curl -sf localhost:${PORT}/healthz >/dev/null || PASSWORD=$(cat ${D}/password) setsid ${BIN} --bind-addr 0.0.0.0:${PORT} --auth password --disable-telemetry \\
  --user-data-dir ${D}/data --extensions-dir ${D}/extensions ${WORK} >/tmp/code-server.log 2>&1 </dev/null &
cat ${D}/password`;
const res = await box.exec("sh", { args: ["-c", setup], env: { NEW_PASSWORD: randomBytes(24).toString("hex"), REPO: repo ?? "" }, timeoutMs: 300_000 });
if (res.exitCode !== 0) throw new Error(`setup failed (exit ${res.exitCode}), stop the box with \`node run.mjs stop\`: ${stderrText(res)}`);
const password = stdoutText(res).trim();

// Point the named URL at this sandbox's port; rebinding is how the address survives a rebuild.
// Use the URL bind() returns: an unbound one comes back without its region and never routes.
if (url.sessionId !== box.id || url.port !== PORT) url = await tenki.previewUrls.bind(url.id, box.id, PORT);

let up = false;
for (let i = 0; i < 30 && !up; i++) {
	up = await fetch(`${url.previewUrl}/healthz`).then((r) => r.ok, () => false);
	if (!up) await sleep(2000);
}
if (!up) throw new Error("code-server never answered; see /tmp/code-server.log in the sandbox, or `node run.mjs stop`");

console.log(`${BOX} is live at ${url.previewUrl}\npassword: ${password}`);
console.log(`Stop the sandbox (keeps workspace + URL): BOX=${BOX} node run.mjs stop`);
console.log(`Delete everything:                     BOX=${BOX} node run.mjs delete`);
