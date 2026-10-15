// A headless OpenCode server in a disposable Tenki sandbox, reachable over HTTPS:
// boot with the agent and a repo already inside, serve, expose, then drive it from here.
import { TenkiSandbox, WaitReadyFailedError } from "@tenkicloud/sandbox";
import { randomBytes } from "node:crypto";

const REPO = "https://github.com/sindresorhus/yocto-queue";
const PORT = 4096;
const PASSWORD = randomBytes(24).toString("hex"); // this URL is public; see the note below

const tenki = new TenkiSandbox({ authToken: process.env.TENKI_AUTH_TOKEN });

// enableOpenCode bakes the CLI into the guest — nothing to npm install.
// No `await using` here: it would terminate the sandbox at the end of this scope and the
// URL below would 404 before you could open it. maxDurationMs caps it instead.
// createAndWait does not clean up after itself: a VM that is provisioned but never gets
// ready comes back as WaitReadyFailedError, half-born and billing, with its session attached.
const sandbox = await tenki.createAndWait({
	cpuCores: 2,
	memoryMb: 4096,
	enableOpenCode: true,
	allowInbound: true,
	cloneRepoUrl: REPO,
	maxDurationMs: 2 * 60 * 60_000,
	workspaceId: process.env.TENKI_WORKSPACE_ID,
}).catch(async (e) => {
	if (e instanceof WaitReadyFailedError) await e.session[Symbol.asyncDispose]();
	throw e;
});

// From here on a throw must dispose the sandbox, or it runs until its two-hour cap.
try {
	// --hostname 0.0.0.0 is load-bearing: the default 127.0.0.1 is unreachable from the gateway.
	// setsid + redirected stdio keeps the server running after this exec() returns.
	await sandbox.exec("sh", {
		args: ["-c", `cd repo && setsid opencode serve --port ${PORT} --hostname 0.0.0.0 >/tmp/opencode.log 2>&1 </dev/null & sleep 5`],
		// OpenCode's built-in openai provider reads OPENAI_API_KEY. (openCodeProvider.apiKey would
		// arrive as OPENCODE_API_KEY, the key for OpenCode's own hosted models, not OpenAI's.)
		// An env value of undefined arrives as an empty string, so pass the key only if you have it.
		env: {
			OPENCODE_SERVER_PASSWORD: PASSWORD,
			...(process.env.OPENAI_API_KEY && { OPENAI_API_KEY: process.env.OPENAI_API_KEY }),
		},
	});

	const { previewUrl } = await sandbox.exposePort(PORT);
	// Auth is HTTP Basic — username opencode (OPENCODE_SERVER_USERNAME's default), the password above.
	// A Bearer token is rejected.
	const auth = { Authorization: "Basic " + Buffer.from(`opencode:${PASSWORD}`).toString("base64") };

	// The gateway can take a few seconds to route a fresh URL, so retry the first fetch.
	let project;
	for (let i = 0; i < 15 && !project; i++) {
		try {
			const res = await fetch(`${previewUrl}/project/current`, { headers: auth });
			if (res.status === 200) project = await res.json();
		} catch { /* gateway warming up */ }
		if (!project) await new Promise((r) => setTimeout(r, 2000));
	}
	if (!project) throw new Error("opencode serve never answered; see /tmp/opencode.log in the sandbox");

	console.log(`${project.worktree} (${project.vcs}) is live at ${previewUrl}/app`);
	console.log(`user: opencode, password: ${PASSWORD}\nCtrl-C to terminate the sandbox.`);
} catch (e) {
	await sandbox[Symbol.asyncDispose]();
	throw e;
}

process.on("SIGINT", async () => {
	await sandbox[Symbol.asyncDispose]();
	process.exit(0);
});
setInterval(() => {}, 1 << 30); // hold the event loop open; an unsettled await would exit 13
