// Claude Code, headless, on a real repo in a disposable Tenki sandbox:
// clone -> install the CLI -> let the agent edit the checkout -> read back the diff.
import { TenkiSandbox } from "@tenkicloud/sandbox";

const REPO = "https://github.com/sindresorhus/yocto-queue";
const TASK = "Add a toArray() method to the Queue class in index.js that returns the queued values as an array, oldest first. Declare it in index.d.ts and add a test for it in test.js.";
const PASSTHROUGH = ["ANTHROPIC_API_KEY", "ANTHROPIC_BASE_URL", "ANTHROPIC_MODEL"];

const tenki = new TenkiSandbox({ authToken: process.env.TENKI_AUTH_TOKEN });

// cloneRepoUrl checks the repo out to ./repo before createAndWait resolves.
await using sandbox = await tenki.createAndWait({
	cpuCores: 2,
	memoryMb: 4096,
	cloneRepoUrl: REPO,
	workspaceId: process.env.TENKI_WORKSPACE_ID,
});

// Outbound is on by default, so no allowOutbound is needed to reach the npm registry.
const install = await sandbox.exec("npm", { args: ["i", "-g", "@anthropic-ai/claude-code"], timeoutMs: 300_000 });
if (install.exitCode !== 0) throw new Error(`npm i -g @anthropic-ai/claude-code exited ${install.exitCode}`);

const decoder = new TextDecoder();
const run = await sandbox.exec("claude", {
	// Skipping permission prompts is what the throwaway VM buys you: the agent gets a
	// free hand on a machine whose entire filesystem you delete at the end of this script.
	args: ["-p", TASK, "--dangerously-skip-permissions"],
	cwd: "repo", // relative paths resolve under the workdir, /home/tenki
	timeoutMs: 10 * 60_000,
	// An env value of undefined arrives as an empty string, not as unset — an empty
	// ANTHROPIC_BASE_URL is worse than none, so filter to the vars you actually have.
	env: Object.fromEntries(PASSTHROUGH.filter((k) => process.env[k]).map((k) => [k, process.env[k]])),
	onOutput: ({ data }) => process.stdout.write(decoder.decode(data, { stream: true })), // a multi-byte character can span two chunks
});
// Without this, a failed run (a bad key, say) prints an empty diff as if nothing went wrong.
if (run.exitCode !== 0) throw new Error(`claude exited ${run.exitCode}`);

// sandbox.git.* runs at the workdir; the checkout is one level down, so point it at ./repo.
console.log(await sandbox.git.diff({ directory: "repo" }));
