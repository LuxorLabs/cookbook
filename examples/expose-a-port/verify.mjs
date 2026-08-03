// Proves this example: boot a sandbox with inbound enabled, start an HTTP server, expose its
// port for a public preview URL, fetch that URL from the host, assert the body. Exits non-zero
// on any failure; terminates the sandbox. Token/workspace from env or ~/.config/tenki/config.yaml.
import { TenkiSandbox } from "@tenkicloud/sandbox";
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
const workspaceId = process.env.TENKI_WORKSPACE_ID || cfg("current_workspace_id");
if (!authToken) {
	console.error("No token. Set TENKI_AUTH_TOKEN, or run `tenki login`.");
	process.exit(1);
}

const PORT = 8000;
const BODY = `Hello from Tenki ${Math.random().toString(36).slice(2, 8)}`;

const tenki = new TenkiSandbox({ authToken });
let sandbox;
try {
	// allowInbound: true is required for the gateway to route public traffic to the port.
	sandbox = await tenki.createAndWait({ cpuCores: 1, memoryMb: 1024, allowInbound: true, workspaceId });

	// Write a one-file site and start a detached HTTP server (setsid survives exec return).
	await sandbox.exec("sh", {
		args: ["-c", `printf '%s' '${BODY}' > /home/tenki/index.html; cd /home/tenki; setsid python3 -m http.server ${PORT} >/tmp/s.log 2>&1 </dev/null & sleep 1`],
	});

	// Map the port at the gateway -> public HTTPS preview URL.
	const { previewUrl } = await sandbox.exposePort(PORT);
	if (!previewUrl) throw new Error("exposePort returned no previewUrl");
	console.log(`  preview URL: ${previewUrl}`);

	// Fetch from the host; retry while the server + gateway warm up.
	let status, text;
	for (let i = 0; i < 15; i++) {
		try {
			const res = await fetch(previewUrl, { redirect: "follow" });
			({ status } = res);
			text = await res.text();
			if (status === 200 && text.includes(BODY)) break;
		} catch { /* gateway warming up */ }
		await new Promise((r) => setTimeout(r, 2000));
	}
	if (!(status === 200 && text?.includes(BODY))) {
		throw new Error(`unexpected response: status ${status}, body ${JSON.stringify(text)}`);
	}
	console.log(`✓ expose-a-port: server → exposePort → host GET ${status} → "${BODY}"`);
} catch (e) {
	console.error("✗ " + (e?.message ?? e));
	process.exitCode = 1;
} finally {
	// Dispose the sandbox (and its preview URL); it self-reaps via idle/lifetime caps otherwise.
	if (sandbox) {
		try { await sandbox[Symbol.asyncDispose](); } catch { /* already gone */ }
	}
}
