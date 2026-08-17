// OpenAI Codex, headless, on a real repo in a disposable Tenki sandbox:
// clone -> install the CLI -> let the agent edit the checkout -> read back the diff.
import { TenkiSandbox, stdoutText } from "@tenkicloud/sandbox";

const REPO = "https://github.com/sindresorhus/yocto-queue";
const TASK = "Add a toArray() method to the Queue class in index.js that returns the queued values as an array, oldest first. Declare it in index.d.ts and add a test for it in test.js.";

const tenki = new TenkiSandbox({ authToken: process.env.TENKI_AUTH_TOKEN });

// cloneRepoUrl checks the repo out to ./repo before createAndWait resolves.
await using sandbox = await tenki.createAndWait({
	cpuCores: 2,
	memoryMb: 4096,
	cloneRepoUrl: REPO,
	workspaceId: process.env.TENKI_WORKSPACE_ID,
});

// Outbound is on by default, so no allowOutbound is needed to reach the npm registry.
await sandbox.exec("npm", { args: ["i", "-g", "@openai/codex"] });

const decoder = new TextDecoder();
await sandbox.exec("codex", {
	// Codex sandboxes itself with bubblewrap. Inside a microVM that layer is redundant, and
	// bypassing it drops both the nesting and the "could not find bubblewrap" warning.
	args: ["exec", "--dangerously-bypass-approvals-and-sandbox", TASK],
	cwd: "repo", // relative paths resolve under the workdir, /home/tenki
	timeoutMs: 10 * 60_000,
	env: { OPENAI_API_KEY: process.env.OPENAI_API_KEY }, // scoped to this one process
	onOutput: ({ data }) => process.stdout.write(decoder.decode(data)), // data is a Uint8Array
});

// sandbox.git.* runs at the workdir, and the checkout is one level down — so use `git -C`.
console.log(stdoutText(await sandbox.exec("git", { args: ["-C", "repo", "diff"] })));
