// Drives lib/tenki.ts, the app's Tenki sandbox module, against live Tenki:
// create a bot sandbox, shell + files + memory, the desktop (install, keyboard, mouse, PNG
// screenshot), noVNC over the preview URL with and without the token, metering, pause →
// resume keeps files and desktop, delete. Token/workspace from env or ~/.config/tenki/config.yaml.
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { request } from "node:https";
import { homedir } from "node:os";
import { register } from "tsx/esm/api";

const cfg = (key) => {
	try {
		const c = readFileSync(`${homedir()}/.config/tenki/config.yaml`, "utf8");
		return (c.match(new RegExp(`^${key}:\\s*(.+)$`, "m"))?.[1] ?? "").trim();
	} catch {
		return "";
	}
};
process.env.TENKI_API_KEY = process.env.TENKI_AUTH_TOKEN || process.env.TENKI_API_KEY || cfg("auth_token");
process.env.TENKI_WORKSPACE_ID ||= cfg("current_workspace_id");
if (!process.env.TENKI_API_KEY) {
	console.error("No token. Set TENKI_AUTH_TOKEN, or run `tenki login`.");
	process.exit(1);
}

register();
const bot = await import("./lib/tenki.ts");
const { TenkiSandbox } = await import("@tenkicloud/sandbox");
const check = (ok, msg) => { if (!ok) throw new Error(msg); };
// A raw websocket handshake (Node 20 has no global WebSocket); resolves to the RFB banner or the HTTP status
const vnc = (wss) => new Promise((resolve, reject) => {
	const req = request(wss.replace(/^wss:/, "https:"), { headers: { Connection: "Upgrade", Upgrade: "websocket", "Sec-WebSocket-Version": "13", "Sec-WebSocket-Key": randomBytes(16).toString("base64"), "Sec-WebSocket-Protocol": "binary" } });
	req.on("upgrade", (res, socket) => socket.once("data", (d) => { socket.destroy(); resolve(d.toString("latin1").match(/RFB \d+\.\d+/)?.[0] ?? "101"); }));
	req.on("response", (res) => { res.resume(); resolve(String(res.statusCode)); });
	req.on("error", reject).setTimeout(20_000, () => req.destroy(new Error("websocket timed out")));
	req.end();
});

const botId = `verify-${randomBytes(4).toString("hex")}`;
let id;
try {
	id = await bot.createBotSandbox(botId);
	let sb = await bot.getBotSandbox(id);
	await sb.fs.uploadFile(Buffer.from(botId), "work/hello.txt");
	check((await sb.fs.downloadFile("work/hello.txt")).toString() === botId, "file did not read back");
	check((await sb.fs.listFiles("work")).some((f) => f.name === "hello.txt"), "listFiles missed the file");
	await sb.process.executeCommand(`echo '- likes ${botId}' >> ${bot.MEMORY_FILE}`); // what the remember tool runs
	check((await bot.readBotMemory(sb)).includes(botId), "memory did not recall the note");

	await sb.computerUse.start(); // installs the desktop on first use
	await sb.process.executeCommand("setsid xterm >/dev/null 2>&1 </dev/null & sleep 2");
	await sb.computerUse.mouse.click(200, 200);
	await sb.computerUse.keyboard.type("echo typed\n");
	await sb.computerUse.keyboard.press("l", ["ctrl"]);
	const shot = Buffer.from((await sb.computerUse.screenshot.takeCompressed({ format: "png" })).screenshot, "base64");
	check(shot.subarray(1, 4).toString() === "PNG" && shot.readUInt32BE(16) === 1024, "screenshot is not a 1024-wide PNG");

	const url = await bot.getBotDesktopUrl(id);
	let page = 0;
	for (let i = 0; i < 15 && page !== 200; i++, await new Promise((r) => setTimeout(r, 2000)))
		page = await fetch(new URL("/vnc.html", url.replace(/^wss:/, "https:"))).then((r) => r.status, () => 0);
	check(page === 200, `noVNC page returned ${page}`);
	const [withToken, without] = [await vnc(url), await vnc(url.replace(/\?.*/, ""))];
	check(withToken.startsWith("RFB") && !without.startsWith("RFB"), `websocket: ${withToken} with token, ${without} without`);

	check((await bot.listRunningSandboxIds()).includes(id), "metering did not list the running sandbox");
	await bot.stopBotSandbox(id);
	check(!(await bot.listRunningSandboxIds()).includes(id), "metering still lists the paused sandbox");
	sb = await bot.getBotSandbox(id); // resumes it
	check((await sb.fs.downloadFile("work/hello.txt")).toString() === botId, "file lost across pause");
	check((await sb.computerUse.getStatus()).status === "active", "desktop lost across pause");

	console.log(`✓ grok-ai-teammates-tenki: bot sandbox → shell, files, remember/recall → desktop: keyboard, mouse, ${shot.length}-byte PNG → noVNC ${page}, websocket ${withToken} with token, ${without} without → metered → pause → resume keeps file + desktop → delete`);
} catch (e) {
	console.error("✗ " + (e?.message ?? e));
	process.exitCode = 1;
} finally {
	if (id) await bot.deleteBotSandbox(id).catch((e) => { console.error("✗ cleanup: " + e.message); process.exitCode = 1; });
	const tenki = new TenkiSandbox();
	const ws = process.env.TENKI_WORKSPACE_ID || undefined;
	const left = (await tenki.list({ tags: [`bot-${botId}`], workspaceId: ws })).filter((s) => !["TERMINATED", "TERMINATING"].includes(s.state));
	if (id) left.push(...(await tenki.previewUrls.list({ workspaceId: ws })).filter((u) => u.sessionId === id));
	if (left.length) { console.error(`✗ left behind: ${left.map((x) => x.id).join(", ")}`); process.exitCode = 1; }
}
