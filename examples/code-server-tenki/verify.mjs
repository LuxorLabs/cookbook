// Proves run.mjs end to end against Tenki: start the box with a repo, check code-server's login
// page, password login, the authenticated workbench and a websocket over the public URL; stop and
// rebuild it, and check the URL, password and cloned repo survive; then delete everything and
// assert nothing named after this run is left. Token/workspace from env or ~/.config/tenki/config.yaml.
import { TenkiSandbox, stdoutText } from "@tenkicloud/sandbox";
import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { request } from "node:https";
import { homedir } from "node:os";
import { promisify } from "node:util";

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

const BOX = `cs-verify-${randomBytes(3).toString("hex")}`; // unique, so parallel runs don't collide
const env = { ...process.env, TENKI_AUTH_TOKEN: authToken, BOX, ...(workspaceId && { TENKI_WORKSPACE_ID: workspaceId }) };
const run = async (...args) => (await promisify(execFile)("node", ["run.mjs", ...args], { env, timeout: 600_000 })).stdout;
const up = async () => {
	const out = await run("https://github.com/sindresorhus/yocto-queue");
	return { url: out.match(/live at (\S+)/)?.[1], password: out.match(/^password: (\S+)/m)?.[1] };
};
const login = async (url, password) => {
	const r = await fetch(`${url}/login`, { method: "POST", redirect: "manual", body: new URLSearchParams({ password }) });
	return r.status === 302 ? r.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ") : null;
};
// A raw HTTP upgrade (Node 20 has no global WebSocket): 101 means the socket opened end to end.
const upgrade = (url, cookie = "") => new Promise((resolve, reject) => {
	const q = `/?reconnectionToken=${randomBytes(8).toString("hex")}&reconnection=false&skipWebSocketFrames=false&type=Management`;
	const req = request(url + q, { headers: { cookie, Connection: "Upgrade", Upgrade: "websocket", "Sec-WebSocket-Version": "13", "Sec-WebSocket-Key": randomBytes(16).toString("base64") } });
	req.on("upgrade", (res, socket) => { socket.destroy(); resolve(res.statusCode); });
	req.on("response", (res) => { res.resume(); resolve(res.statusCode); });
	req.on("error", reject).setTimeout(20_000, () => req.destroy(new Error("websocket upgrade timed out")));
	req.end();
});
const check = (ok, msg) => { if (!ok) throw new Error(msg); };

const tenki = new TenkiSandbox({ authToken });
try {
	const first = await up();
	check(first.url && /^[0-9a-f]{48}$/.test(first.password ?? ""), "run.mjs printed no URL or password");
	const page = await fetch(`${first.url}/login`).then(async (r) => `${r.status} ${await r.text()}`);
	check(/^200 [\s\S]*<title>code-server login<\/title>/.test(page), `login page: ${page.slice(0, 120)}`);
	check((await fetch(first.url, { redirect: "manual" })).status === 302, "unauthenticated / did not redirect to login");
	check((await login(first.url, "wrong")) === null, "a wrong password logged in");
	const cookie = await login(first.url, first.password);
	check(cookie, "the printed password did not log in");
	const wb = await fetch(`${first.url}/?folder=/home/tenki/workspace`, { headers: { cookie } });
	check(wb.status === 200 && /workbench/.test(await wb.text()), `authenticated workbench returned ${wb.status}`);
	check((await upgrade(first.url, cookie)) === 101, "authenticated websocket did not upgrade");
	const anon = await upgrade(first.url);
	check(anon !== 101, "unauthenticated websocket upgraded");

	// Rebuild: a new sandbox on the same volume, behind the same URL, with the same password.
	await run("stop");
	const second = await up();
	check(second.url === first.url && second.password === first.password, "URL or password changed across a rebuild");
	const [box] = await tenki.list({ workspaceId, tags: [BOX] });
	check(box && stdoutText(await box.exec("ls", { args: ["/home/tenki/workspace"] })).includes("yocto-queue"), "the workspace did not survive the rebuild");
	check(await login(second.url, second.password), "login failed after the rebuild");

	console.log(`✓ code-server-tenki: sticky box + volume + ${first.url} → login page, wrong password refused, workbench 200, websocket 101 (${anon} without the cookie) → stop → rebuild keeps URL, password, repo → delete`);
} catch (e) {
	console.error("✗ " + (e?.stderr || e?.message || e));
	process.exitCode = 1;
} finally {
	try { await run("delete"); } catch (e) { console.error("✗ cleanup: " + (e?.stderr || e?.message)); process.exitCode = 1; }
	const left = [
		...(await tenki.list({ workspaceId, tags: [BOX] })).filter((s) => s.state !== "TERMINATED" && s.state !== "TERMINATING"),
		...(await tenki.previewUrls.list({ workspaceId })).filter((u) => u.slug === BOX),
		...(await tenki.listVolumes({ workspaceId })).filter((v) => v.name === BOX && v.state !== "DELETED" && v.state !== "DELETING"),
	];
	if (left.length) { console.error(`✗ left behind: ${left.map((x) => x.id).join(", ")}`); process.exitCode = 1; }
}
