// Proves this example without a model key: sticky sandbox → named preview URL → setup.sh (install,
// non-interactive onboard, systemd gateway) → /healthz and the dashboard over the preview URL → a
// WebSocket that rejects a wrong token and accepts the right one. Deletes the URL and the sandbox.
import { TenkiSandbox } from "@tenkicloud/sandbox";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import WebSocket from "ws";

const cfg = (key) => {
	try {
		const c = readFileSync(`${homedir()}/.config/tenki/config.yaml`, "utf8");
		return (c.match(new RegExp(`^${key}:\\s*(.+)$`, "m"))?.[1] ?? "").trim();
	} catch {
		return "";
	}
};
const authToken = process.env.TENKI_AUTH_TOKEN || process.env.TENKI_API_KEY || cfg("auth_token");
if (!authToken) {
	console.error("No token. Set TENKI_AUTH_TOKEN, or run `tenki login`.");
	process.exit(1);
}

const OPENCLAW_VERSION = "2026.10.8";
const gatewayToken = randomBytes(32).toString("hex");
const assert = (ok, msg) => { if (!ok) throw new Error(msg); };

// Open a socket to the gateway, answer its connect.challenge with `token`, return the connect response.
const connect = (url, token) => new Promise((resolve, reject) => {
	const ws = new WebSocket(url.replace(/^http/, "ws"), { origin: url });
	const timer = setTimeout(() => { ws.terminate(); reject(new Error("websocket timeout")); }, 20_000);
	ws.on("error", (e) => { clearTimeout(timer); reject(e); });
	ws.on("message", (raw) => {
		const msg = JSON.parse(raw.toString());
		if (msg.event === "connect.challenge") {
			ws.send(JSON.stringify({ type: "req", id: "1", method: "connect", params: {
				minProtocol: 4, maxProtocol: 4, role: "operator", scopes: ["operator.read"], auth: { token },
				client: { id: "cli", version: OPENCLAW_VERSION, platform: "linux", mode: "cli" } } }));
		} else if (msg.type === "res") { clearTimeout(timer); ws.close(); resolve(msg); }
	});
});

const tenki = new TenkiSandbox({ authToken });
let sandbox, url;
try {
	sandbox = await tenki.createAndWait({ sticky: true, allowInbound: true, cpuCores: 2, memoryMb: 4096, diskSizeGb: 10, tags: ["openclaw-gateway"] });
	assert(sandbox.sticky, "sandbox is not sticky");
	url = await tenki.previewUrls.create(`openclaw-${randomBytes(3).toString("hex")}`, { sessionId: sandbox.id, port: 18789 });
	console.log(`  preview URL: ${url.previewUrl}`);

	await sandbox.writeFile("/home/tenki/setup.sh", readFileSync(new URL("./setup.sh", import.meta.url), "utf8"));
	const r = await sandbox.exec("bash", {
		args: ["-lc", "bash /home/tenki/setup.sh"],
		env: { OPENCLAW_VERSION, PUBLIC_URL: url.previewUrl, OPENCLAW_GATEWAY_TOKEN: gatewayToken },
		timeoutMs: 600_000,
	});
	assert(r.exitCode === 0, `setup.sh exited ${r.exitCode}:\n${new TextDecoder().decode(r.stderr).slice(-2000)}`);

	let health;
	for (let i = 0; i < 15 && !health?.ok; i++) {
		health = await fetch(`${url.previewUrl}/healthz`).then((res) => res.json()).catch(() => null);
		if (!health?.ok) await new Promise((res) => setTimeout(res, 2000));
	}
	assert(health?.ok, "gateway /healthz not ok over the preview URL");
	const page = await fetch(url.previewUrl);
	assert(page.status === 200 && (await page.text()).includes("openclaw-control-ui"), `dashboard returned ${page.status}`);

	const denied = await connect(url.previewUrl, "wrong-token");
	assert(!denied.ok && denied.error?.details?.code === "AUTH_TOKEN_MISMATCH", `wrong token: ${JSON.stringify(denied)}`);
	const hello = await connect(url.previewUrl, gatewayToken);
	assert(hello.ok && hello.payload?.type === "hello-ok", `right token: ${JSON.stringify(hello).slice(0, 300)}`);

	console.log(`✓ openclaw-gateway-tenki: sticky sandbox → onboard ${hello.payload.server.version} → /healthz → dashboard 200 → wss wrong token rejected → hello-ok`);
} catch (e) {
	console.error("✗ " + (e?.message ?? e));
	process.exitCode = 1;
} finally {
	// Sticky sandboxes and named URLs outlive the script, so delete both explicitly.
	if (url) await tenki.previewUrls.delete(url.id).catch(() => {});
	if (sandbox) await sandbox.close().catch(() => {});
}
