// Proves this example: volume → sticky sandbox that starts app.py at boot → named preview URL serves
// it → unbind, terminate, boot a second sandbox on the same volume → re-bind the same URL → it serves
// the new sandbox and the visit count carried over. Deletes the URL, sandboxes and volume either way.
import { TemplateSpec, TenkiSandbox } from "@tenkicloud/sandbox";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";

const cfg = (key) => {
	try {
		const c = readFileSync(`${homedir()}/.config/tenki/config.yaml`, "utf8");
		return (c.match(new RegExp(`^${key}:\\s*(.+)$`, "m"))?.[1] ?? "").trim();
	} catch {
		return "";
	}
};
const authToken = process.env.TENKI_AUTH_TOKEN || process.env.TENKI_API_KEY || cfg("auth_token");
const workspaceId = process.env.TENKI_WORKSPACE_ID || cfg("current_workspace_id") || undefined;
if (!authToken) {
	console.error("No token. Set TENKI_AUTH_TOKEN, or run `tenki login`.");
	process.exit(1);
}

const PORT = 8000;
const id = Math.random().toString(36).slice(2, 8);
const tenki = new TenkiSandbox({ authToken, warningHandler: null });
const runtime = new TemplateSpec().start('exec python3 -c "$APP_PY"', { restartPolicy: "always", readyWhen: [{ port: PORT }] });
const boot = (volumeId) =>
	tenki.createAndWait({
		cpuCores: 1, memoryMb: 1024, allowInbound: true, sticky: true, workspaceId, directRuntime: runtime, waitForRuntime: true,
		volumes: [{ volumeId, mountPath: "/home/tenki/data" }],
		env: { APP_PY: readFileSync(new URL("app.py", import.meta.url), "utf8") },
	});
const visit = async (url) => {
	for (let i = 0; i < 15; i++) {
		const res = await fetch(url).catch(() => undefined);
		if (res?.ok) return (await res.text()).trim(); // "visit N, served by <host>"
		await new Promise((r) => setTimeout(r, 2000));
	}
	throw new Error(`no 200 from ${url}`);
};
const expect = (got, re) => {
	if (!re.test(got)) throw new Error(`expected ${re}, got ${JSON.stringify(got)}`);
	return got.split(" ").pop();
};

let volume, first, second, url;
try {
	volume = await tenki.createVolume({ name: `verify-host-${id}`, sizeBytes: 1024 ** 3, workspaceId });
	first = await boot(volume.id);
	url = await tenki.previewUrls.create(`verify-host-${id}`, { sessionId: first.id, port: PORT, workspaceId });
	console.log(`  service URL: ${url.previewUrl}`);
	expect(await visit(url.previewUrl), /^visit 1, /);
	const host1 = expect(await visit(url.previewUrl), /^visit 2, /);

	// Rebuild: unbind (terminating a bound sandbox deletes the URL), terminate, boot a fresh one.
	await tenki.previewUrls.unbind(url.id);
	await first.close();
	for (let i = 0; (await tenki.getVolume(volume.id)).state !== "AVAILABLE"; i++) {
		if (i === 30) throw new Error("volume still attached to the first sandbox");
		await new Promise((r) => setTimeout(r, 2000));
	}
	second = await boot(volume.id);
	const rebound = await tenki.previewUrls.bind(url.id, second.id, PORT);
	if (rebound.previewUrl !== url.previewUrl) throw new Error(`URL changed: ${rebound.previewUrl}`);
	const host2 = expect(await visit(url.previewUrl), /^visit 3, /);
	if (host2 === host1) throw new Error(`still served by ${host1}`);
	console.log(`✓ host-a-service: volume → sticky ${host1} → named URL visit 1,2 → rebuild → same URL → ${host2} visit 3`);
} catch (e) {
	console.error("✗ " + (e?.message ?? e));
	process.exitCode = 1;
} finally {
	if (url) await tenki.previewUrls.delete(url.id).catch(() => {}); // gone already if its sandbox died bound
	for (const s of [first, second]) await s?.closeIfOpen().catch((e) => console.error(`  cleanup: ${e.message}`));
	for (let i = 0; volume && i < 30; i++) {
		try {
			await tenki.deleteVolume(volume.id); // fails while still attached, for a few seconds
			break;
		} catch (e) {
			if (i === 29) console.error(`  cleanup: volume ${volume.id}: ${e.message}`), (process.exitCode = 1);
			await new Promise((r) => setTimeout(r, 2000));
		}
	}
}
