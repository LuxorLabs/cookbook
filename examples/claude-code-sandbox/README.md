# Claude Code on Tenki (headless, on a real repo)

Give [Claude Code](https://www.npmjs.com/package/@anthropic-ai/claude-code) a coding task and let it work unsupervised — no permission prompts — inside a disposable [Tenki Sandbox](https://tenki.cloud/products/sandbox) microVM. `--dangerously-skip-permissions` is reckless on your laptop; here the blast radius is one VM that is deleted when the script ends. What comes back is the agent's work as a patch: apply it to your checkout, open a PR from it, or run many of these in parallel and keep the good ones.

## The code (`run.mjs`)

```js
import { writeFileSync } from "node:fs";
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

// The diff is how the work leaves the VM: save it before the sandbox is torn down.
// sandbox.git.* runs at the workdir; the checkout is one level down, so point it at ./repo.
const patch = await sandbox.git.diff({ directory: "repo" });
if (!patch.trim()) throw new Error("the agent finished without changing anything");
writeFileSync("agent.patch", patch);
console.log(patch);
console.log(`Saved agent.patch. Apply it to a clone of ${REPO} with \`git apply agent.patch\`, or open a PR from it.`);
```

Everything the agent did inside the VM is deleted when the script ends; `agent.patch` is what you keep.

## Run it

```bash
npm install
export TENKI_AUTH_TOKEN=...      # from `tenki login` (~/.config/tenki/config.yaml)
export TENKI_WORKSPACE_ID=...
export ANTHROPIC_API_KEY=...     # ANTHROPIC_BASE_URL and ANTHROPIC_MODEL pass through too, if set
node run.mjs                     # streams the agent's turn, then saves the diff to agent.patch
```

`run.mjs` uses top-level `await using`, which needs Node 24+.

Verify the Tenki half without a model key — this is what CI runs:

```bash
node verify.mjs   # create + clone → install the CLI → check its version and flags → edit → git diff
```

## Notes

- `sandbox.git.*` runs at the sandbox workdir; when `cloneRepoUrl` checked out into `./repo`, pass `directory: "repo"`.
- The default image already ships Node 24, npm 11, and git 2.43, and outbound network is on for a bare `create`. `npm i -g @anthropic-ai/claude-code` finishes in about five seconds — no `allowOutbound`, no custom image, no baked-in CLI.
- `--dangerously-skip-permissions` refuses to run as root; the sandbox user is `tenki`, so it works as written. It is the right flag *here* precisely because the blast radius is one microVM.
- `exec(command, { args })` runs a bare binary and its args with no shell splitting, so the whole task prompt goes through as a single argument. `ExecOptions.env` is scoped to that one process — the model key never lands in the repo or the image.
- Secrets in, diffs out: nothing else from your shell crosses into the VM, and `await using` terminates it when the scope ends (`Session` is an `AsyncDisposable`). `verify.mjs` uses `try`/`finally` instead, so CI runs fine on Node 20.
