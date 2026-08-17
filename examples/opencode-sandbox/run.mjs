// A headless OpenCode server in a disposable Tenki sandbox, reachable over HTTPS:
// boot with the agent and a repo already inside, serve, expose, then drive it from here.
import { TenkiSandbox } from "@tenkicloud/sandbox";
import { randomBytes } from "node:crypto";

const REPO = "https://github.com/sindresorhus/yocto-queue";
const PORT = 4096;
const PASSWORD = randomBytes(24).toString("hex"); // this URL is public; see the note below

const tenki = new TenkiSandbox({ authToken: process.env.TENKI_AUTH_TOKEN });

// enableOpenCode bakes the CLI into the guest — nothing to npm install.
// openCodeProvider.apiKey lands in the guest as OPENCODE_API_KEY.
await using sandbox = await tenki.createAndWait({
	cpuCores: 2,
	memoryMb: 4096,
	enableOpenCode: true,
	openCodeProvider: { apiKey: process.env.OPENAI_API_KEY },
	allowInbound: true,
	cloneRepoUrl: REPO,
	workspaceId: process.env.TENKI_WORKSPACE_ID,
});

// --hostname 0.0.0.0 is load-bearing: the default 127.0.0.1 is unreachable from the gateway.
// setsid + redirected stdio keeps the server running after this exec() returns.
await sandbox.exec("sh", {
	args: ["-c", `cd repo && setsid opencode serve --port ${PORT} --hostname 0.0.0.0 >/tmp/opencode.log 2>&1 </dev/null & sleep 5`],
	env: { OPENCODE_SERVER_PASSWORD: PASSWORD },
});

const { previewUrl } = await sandbox.exposePort(PORT);
// Auth is HTTP Basic — any username, the password above. A Bearer token is rejected.
const auth = { Authorization: "Basic " + Buffer.from(`opencode:${PASSWORD}`).toString("base64") };

const project = await (await fetch(`${previewUrl}/project/current`, { headers: auth })).json();
console.log(`${project.worktree} (${project.vcs}) is live at ${previewUrl}/app`);
