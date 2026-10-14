# Codex on Tenki (headless, on a real repo)

Run OpenAI [Codex](https://github.com/openai/codex) non-interactively against a real Git checkout inside a disposable [Tenki Sandbox](https://tenki.cloud/products/sandbox) microVM, then read back the diff the agent produced and throw the machine away.

## The code (`run.mjs`)

```js
import { TenkiSandbox } from "@tenkicloud/sandbox";

const REPO = "https://github.com/sindresorhus/yocto-queue";
const TASK = "Add a toArray() method to the Queue class in index.js that returns the queued values as an array, oldest first. Declare it in index.d.ts and add a test for it in test.js.";
const PASSTHROUGH = ["OPENAI_API_KEY"];

const tenki = new TenkiSandbox({ authToken: process.env.TENKI_AUTH_TOKEN });

// cloneRepoUrl checks the repo out to ./repo before createAndWait resolves.
await using sandbox = await tenki.createAndWait({
  cpuCores: 2,
  memoryMb: 4096,
  cloneRepoUrl: REPO,
  workspaceId: process.env.TENKI_WORKSPACE_ID,
});

// Outbound is on by default, so no allowOutbound is needed to reach the npm registry.
const install = await sandbox.exec("npm", { args: ["i", "-g", "@openai/codex"], timeoutMs: 300_000 });
if (install.exitCode !== 0) throw new Error(`npm i -g @openai/codex exited ${install.exitCode}`);

const decoder = new TextDecoder();
const run = await sandbox.exec("codex", {
  // Codex sandboxes itself with bubblewrap. Inside a microVM that layer is redundant, and
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
```

The last line is the point: a unified diff against a real upstream checkout, produced by an agent that had free run of a machine you are about to delete.

## Run it

```bash
npm install
export TENKI_AUTH_TOKEN=...      # from `tenki login` (~/.config/tenki/config.yaml)
export TENKI_WORKSPACE_ID=...
export OPENAI_API_KEY=sk-...     # the agent turn
node run.mjs                     # streams the agent's turn, then prints the diff
```

`run.mjs` uses top-level `await using`, which needs Node 24+.

Verify the Tenki half without a model key — this is what CI runs:

```bash
node verify.mjs   # create + clone → install the CLI → check its version and flags → edit → git diff
```

## Notes

- **Codex brings its own sandbox, and nesting it inside a microVM buys you nothing.** Under the default `--sandbox workspace-write` it looks for bubblewrap, warns `could not find bubblewrap on PATH`, and falls back to a bundled copy. `--dangerously-bypass-approvals-and-sandbox` reports `sandbox: danger-full-access` and skips the layer — the right call *here* precisely because the blast radius is one disposable VM.
- `sandbox.git.*` runs at the sandbox workdir; when `cloneRepoUrl` checked out into `./repo`, pass `directory: "repo"`.
- `codex exec` runs fine outside a Git repo, so `--skip-git-repo-check` is not needed here; the checkout gives it something to diff. Pass `-C, --cd <DIR>` if you would rather point Codex at a directory than set `cwd`.
- The default image already ships Node 24, npm 11, and git 2.43, and outbound network is on for a bare `create`. `npm i -g @openai/codex` finishes in about seven seconds — no `allowOutbound`, no custom image, no baked-in CLI.
- `exec(command, { args })` runs a bare binary and its args with no shell splitting, so the whole task prompt goes through as a single argument. `ExecOptions.env` is scoped to that one process — the model key never lands in the repo or the image.
- The same shape with Anthropic's CLI is in [claude-code-sandbox](../claude-code-sandbox/); for the OpenAI Agents SDK as a code-interpreter backend, see [openai-agents-sdk](../openai-agents-sdk/).
