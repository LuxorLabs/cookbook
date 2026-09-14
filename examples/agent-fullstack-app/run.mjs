// Stand up a full-stack app inside one Tenki sandbox, drive its API, and expose its UI.
//
// This is the shape of an agent session: every step here maps to a Tenki MCP tool
// (tenki_create_sandbox / tenki_write_file / tenki_exec / tenki_expose_port), so an
// agent like Claude can do exactly this through the MCP server — no bespoke backend.
import { TenkiSandbox, stdoutText } from "@tenkicloud/sandbox";
import { readFileSync } from "node:fs";

const PORT = 8000;
const tenki = new TenkiSandbox({ authToken: process.env.TENKI_AUTH_TOKEN });

// allowInbound: the gateway routes public traffic to the sandbox (for the preview URL).
// This script deliberately leaves the sandbox running so you can open the URL, so
// set billing guards: it self-terminates after 30 idle minutes / 2 hours max.
const sandbox = await tenki.createAndWait({
	cpuCores: 1,
	memoryMb: 1024,
	allowInbound: true,
	idleTimeoutMinutes: 30,
	maxDuration: "7200s",
	workspaceId: process.env.TENKI_WORKSPACE_ID,
});

try {
	// 1. Ship the app into the sandbox (agent: tenki_write_file).
	await sandbox.writeFile("server.py", readFileSync("app/server.py", "utf8"));
	await sandbox.writeFile("seed.py", readFileSync("app/seed.py", "utf8"));

	// 2. Seed the data that powers the backend (agent: tenki_exec).
	const seeded = await sandbox.exec("python3", { args: ["/home/tenki/seed.py"] });
	console.log(stdoutText(seeded).trim());

	// 3. Start the server detached so it outlives this exec() call.
	await sandbox.exec("sh", {
		args: ["-c", "cd /home/tenki && setsid python3 server.py >/tmp/app.log 2>&1 </dev/null & sleep 1"],
	});

	// 4. Drive the API from inside the sandbox — this is the agent "hitting endpoints".
	const call = async (label, py) => {
		const r = await sandbox.exec("python3", { args: ["-c", py] });
		console.log(`   ${label}: ${stdoutText(r).trim()}`);
		return stdoutText(r).trim();
	};
	const REQ = `import json,urllib.request
def go(method, path, body=None):
    data = json.dumps(body).encode() if body else None
    req = urllib.request.Request(f"http://127.0.0.1:${PORT}{path}", data=data, method=method,
                                 headers={"Content-Type": "application/json"})
    return json.load(urllib.request.urlopen(req, timeout=10))`;

	console.log("\n-- the agent calls the backend --");
	await call("GET  /api/health", `${REQ}\nprint(go("GET","/api/health"))`);
	await call("GET  /api/tasks ", `${REQ}\nprint(len(go("GET","/api/tasks")), "tasks")`);
	await call("POST /api/tasks ", `${REQ}\nprint(go("POST","/api/tasks",{"title":"Demo the sandbox to a customer","status":"todo"}))`);
	await call("PATCH /api/tasks/1", `${REQ}\nprint(go("PATCH","/api/tasks/1",{"status":"done"}))`);

	// 5. Expose the frontend so a human (or the agent) can open the live UI.
	const { previewUrl } = await sandbox.exposePort(PORT);
	console.log(`\n-- the UI is live --\n   ${previewUrl}`);
	const res = await fetch(previewUrl);
	console.log(`   GET ${res.status} · ${(await res.text()).includes("<title>") ? "frontend served" : "unexpected body"}`);
	console.log("\n(sandbox left running so you can open the URL; it self-terminates after 30 idle min / 2h max)");
	console.log(`   terminate now:  node -e "import('@tenkicloud/sandbox').then(async m=>{const s=await new m.TenkiSandbox({authToken:process.env.TENKI_AUTH_TOKEN}).get('${sandbox.id}');await s[Symbol.asyncDispose]()})"`);
} catch (e) {
	console.error("error:", e?.message ?? e);
	await sandbox[Symbol.asyncDispose]().catch(() => {});
	process.exit(1);
}
