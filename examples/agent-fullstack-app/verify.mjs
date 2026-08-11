/**
 * Proves this example works: boot a sandbox, seed the DB, start the app, drive
 * every endpoint (GET/POST/PATCH), expose the frontend, fetch it from the public
 * internet, assert each step, then terminate the sandbox.
 * Token/project from env (CI) or ~/.config/tenki/config.yaml (local `tenki login`).
 */
import { TenkiSandbox, stdoutText } from "@tenkicloud/sandbox";
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
let token = process.env.TENKI_AUTH_TOKEN || process.env.TENKI_API_KEY || cfg("auth_token");
if (!token) {
	console.error("No token. Set TENKI_AUTH_TOKEN, or run `tenki login`.");
	process.exit(1);
}
// A `tenki login` session token must be sent as a cookie; `tk_` keys work as-is.
if (!/^(tk_|ory_st_|cookie:)/.test(token)) token = `cookie:${token}`;

const PORT = 8000;
const tenki = new TenkiSandbox({ authToken: token });
let sandbox;
try {
	sandbox = await tenki.createAndWait({
		cpuCores: 1,
		memoryMb: 1024,
		allowInbound: true,
		workspaceId: process.env.TENKI_WORKSPACE_ID || cfg("current_workspace_id") || undefined,
	});

	await sandbox.writeFile("server.py", readFileSync(new URL("app/server.py", import.meta.url), "utf8"));
	await sandbox.writeFile("seed.py", readFileSync(new URL("app/seed.py", import.meta.url), "utf8"));

	const seeded = stdoutText(await sandbox.exec("python3", { args: ["/home/tenki/seed.py"] }));
	if (!seeded.includes("seeded 5 tasks")) throw new Error(`seed failed: ${seeded}`);

	await sandbox.exec("sh", {
		args: ["-c", "cd /home/tenki && setsid python3 server.py >/tmp/app.log 2>&1 </dev/null & sleep 1"],
	});

	const REQ = `import json,urllib.request
def go(m,p,b=None):
    d=json.dumps(b).encode() if b else None
    r=urllib.request.Request(f"http://127.0.0.1:${PORT}{p}",data=d,method=m,headers={"Content-Type":"application/json"})
    return json.load(urllib.request.urlopen(r,timeout=10))`;
	const call = async (py) => stdoutText(await sandbox.exec("python3", { args: ["-c", `${REQ}\n${py}`] })).trim();

	const health = await call(`print(json.dumps(go("GET","/api/health")))`);
	if (!JSON.parse(health).ok) throw new Error(`health not ok: ${health}`);

	const created = JSON.parse(await call(`print(json.dumps(go("POST","/api/tasks",{"title":"agent-created","status":"todo"})))`));
	if (created.title !== "agent-created") throw new Error(`POST failed: ${JSON.stringify(created)}`);

	const patched = JSON.parse(await call(`print(json.dumps(go("PATCH","/api/tasks/${created.id}",{"status":"done"})))`));
	if (patched.status !== "done") throw new Error(`PATCH failed: ${JSON.stringify(patched)}`);

	const count = Number(await call(`print(len(go("GET","/api/tasks")))`));
	if (count !== 6) throw new Error(`expected 6 tasks after create, got ${count}`);

	const { previewUrl } = await sandbox.exposePort(PORT);
	const res = await fetch(previewUrl);
	const html = await res.text();
	if (res.status !== 200 || !html.includes("<title>")) throw new Error(`frontend fetch failed: ${res.status}`);

	console.log(`✓ agent-fullstack-app: seed 5 → serve → health ok → POST → PATCH → 6 tasks → frontend 200 at ${new URL(previewUrl).host}`);
} catch (e) {
	console.error(`✗ ${e?.message ?? e}`);
	process.exitCode = 1;
} finally {
	if (sandbox) await sandbox[Symbol.asyncDispose]().catch(() => {});
}
