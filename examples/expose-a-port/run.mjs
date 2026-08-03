// Expose a port from a Tenki sandbox and get a public preview URL.
// Start a tiny HTTP server in the sandbox, expose its port, fetch the URL from the host.
import { TenkiSandbox } from "@tenkicloud/sandbox";

const PORT = 8000;
const BODY = "Hello from a Tenki sandbox!";

const tenki = new TenkiSandbox({ authToken: process.env.TENKI_AUTH_TOKEN });

// allowInbound: true lets the Tenki gateway route public traffic to the sandbox port.
// (Outbound isn't needed here — the host does the fetching, not the sandbox.)
await using sandbox = await tenki.createAndWait({
	cpuCores: 1,
	memoryMb: 1024,
	allowInbound: true,
	workspaceId: process.env.TENKI_WORKSPACE_ID,
});

// Write a one-file site, then start a detached HTTP server.
// setsid + redirected stdio keeps it running after this exec() returns.
await sandbox.exec("sh", {
	args: [
		"-c",
		`printf '%s' '${BODY}' > /home/tenki/index.html; cd /home/tenki; ` +
			`setsid python3 -m http.server ${PORT} >/tmp/server.log 2>&1 </dev/null & sleep 1`,
	],
});

// Map the sandbox port at the gateway -> a public HTTPS preview URL.
const { previewUrl } = await sandbox.exposePort(PORT);
console.log(`preview URL: ${previewUrl}`);

// Fetch it from the host (the public internet), just like a browser would.
const res = await fetch(previewUrl);
console.log(`GET ${res.status} -> ${(await res.text()).trim()}`); // 200 -> Hello from a Tenki sandbox!
