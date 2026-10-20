// OpenAI Codex, headless, on a real repo in a disposable Tenki sandbox:
// clone -> let the agent edit the checkout -> read back the diff.
import { TenkiSandbox } from "@tenkicloud/sandbox";

const REPO = "https://github.com/sindresorhus/yocto-queue";
const TASK = "Add a toArray() method to the Queue class in index.js that returns the queued values as an array, oldest first. Declare it in index.d.ts and add a test for it in test.js.";
// codex exec reads its key from CODEX_API_KEY and ignores OPENAI_API_KEY.
const PASSTHROUGH = ["CODEX_API_KEY"];

const tenki = new TenkiSandbox({ authToken: process.env.TENKI_AUTH_TOKEN });

// cloneRepoUrl checks the repo out to ./repo before createAndWait resolves.
await using sandbox = await tenki.createAndWait({
	cpuCores: 2,
	memoryMb: 4096,
	cloneRepoUrl: REPO,
	workspaceId: process.env.TENKI_WORKSPACE_ID,
});

// The default image ships the Codex CLI on PATH, so there is nothing to install.
const decoder = new TextDecoder();
const run = await sandbox.exec("codex", {
	// Codex sandboxes itself with bubblewrap. Inside a sandbox that layer is redundant, and
	// bypassing it drops both the nesting and the "could not find bubblewrap" warning.
	args: ["exec", "--dangerously-bypass-approvals-and-sandbox", TASK],
	cwd: "repo", // relative paths resolve under the workdir, /home/tenki
	timeoutMs: 10 * 60_000,
	// An env value of undefined arrives as an empty string, not as unset — so
	// filter to the vars you actually have. ExecOptions.env is scoped to this one process.
	env: Object.fromEntries(PASSTHROUGH.filter((k) => process.env[k]).map((k) => [k, process.env[k]])),
	onOutput: ({ data }) => process.stdout.write(decoder.decode(data, { stream: true })), // a multi-byte character can span two chunks
});
// Without this, a failed run (a bad key, say) prints an empty diff as if nothing went wrong.
if (run.exitCode !== 0) throw new Error(`codex exited ${run.exitCode}`);

// sandbox.git.* runs at the workdir; the checkout is one level down, so point it at ./repo.
console.log(await sandbox.git.diff({ directory: "repo" }));
