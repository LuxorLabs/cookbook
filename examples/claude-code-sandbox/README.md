# Claude Code

Run Claude Code headless with `--dangerously-skip-permissions` on a real repo, inside a Tenki sandbox you throw away. The script clones a repo into the sandbox, runs one Claude Code turn on a task, saves the diff to `agent.patch` on your machine, and deletes the sandbox. The agent gets a free hand on one disposable VM, and the patch is what you keep.

## Quick start

You need:

- Node.js 24 or later for `run.mjs`, which uses top-level `await using`. `verify.mjs` runs on Node 20.
- A Tenki API key (`tk_...`) from [app.tenki.cloud](https://app.tenki.cloud).
- An Anthropic API key. You don't need Claude Code installed locally; Tenki's default image has it.

### 1. Install

```bash
git clone https://github.com/LuxorLabs/cookbook.git
cd cookbook/examples/claude-code-sandbox
npm install
```

### 2. Set your keys

```bash
export TENKI_AUTH_TOKEN=tk_...   # TENKI_API_KEY also works
export ANTHROPIC_API_KEY=...     # ANTHROPIC_BASE_URL and ANTHROPIC_MODEL pass through if set
```

`run.mjs` reads the Tenki key from the environment only. `verify.mjs` also accepts a key saved with `tenki login --api-key <key>`. `TENKI_WORKSPACE_ID` is optional.

### 3. Verify

Check the Tenki side first; it needs no Anthropic key:

```bash
node verify.mjs
```

```
✓ claude-code-sandbox: create + clone → 2.1.267 (Claude Code) on PATH → edit → git diff → dispose
```

`verify.mjs` boots a sandbox with the repo cloned, checks that the image's `claude` still supports `-p` and `--dangerously-skip-permissions`, edits a file, and reads it back through `sandbox.git.diff`. It doesn't run Claude Code on a task.

### 4. Run

```bash
node run.mjs
```

The agent's output streams to your terminal, then the diff prints and is saved as `agent.patch` (ignored by git). The agent's turn has up to 10 minutes. Apply the patch to your own clone:

```bash
git clone https://github.com/sindresorhus/yocto-queue ~/yocto-queue
git -C ~/yocto-queue apply "$PWD/agent.patch"
```

## Change the repo or task

The top of `run.mjs`:

```js
const REPO = "https://github.com/sindresorhus/yocto-queue";
const TASK = "Add a toArray() method to the Queue class in index.js that returns the queued values as an array, oldest first. Declare it in index.d.ts and add a test for it in test.js.";
const PASSTHROUGH = ["ANTHROPIC_API_KEY", "ANTHROPIC_BASE_URL", "ANTHROPIC_MODEL"];

const tenki = new TenkiSandbox({ authToken: process.env.TENKI_AUTH_TOKEN });
```

Edit `TASK` or `REPO`. The example clones a public repo and passes no Git credentials.

## How it works

Boot with the repo inside. The default image ships Claude Code, Node 24, npm 11, and git 2.43, so there's nothing to install:

```js
// cloneRepoUrl checks the repo out to ./repo before createAndWait resolves.
await using sandbox = await tenki.createAndWait({
  cpuCores: 2,
  memoryMb: 4096,
  cloneRepoUrl: REPO,
  workspaceId: process.env.TENKI_WORKSPACE_ID,
});

// The default image ships the Claude Code CLI on PATH, so there is nothing to install.
```

Run the agent with no permission prompts:

```js
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
```

- `exec(command, { args })` doesn't split on spaces, so the whole task goes through as one argument.
- `env` is scoped to the one `claude` process. The key isn't written into the repo or image, but the agent can read it, so review `agent.patch` before applying it.
- Only variables that are set pass through. An unset value would arrive as an empty string, and an empty `ANTHROPIC_BASE_URL` breaks the CLI.
- `--dangerously-skip-permissions` refuses to run as root. The sandbox user is `tenki`.

Take the diff out before the VM goes away:

```js
// The diff is how the work leaves the VM: save it before the sandbox is torn down.
// sandbox.git.* runs at the workdir; the checkout is one level down, so point it at ./repo.
const patch = await sandbox.git.diff({ directory: "repo" });
if (!patch.trim()) throw new Error("the agent finished without changing anything");
writeFileSync("agent.patch", patch);
console.log(patch);
console.log(`Saved agent.patch. Apply it to a clone of ${REPO} with \`git apply agent.patch\`, or open a PR from it.`);
```

`await using` terminates the sandbox when the script ends. Ctrl-C skips that, and `run.mjs` sets no `maxDurationMs`, so add one to `createAndWait` if you need a cap on interrupted runs.

## Claude Code version

The sandbox runs the Claude Code that ships in Tenki's default image (2.1.267 as of October 2026), which changes when the image is rebuilt. To use a newer one, `npm i -g @anthropic-ai/claude-code` in the sandbox and run it by full path from `npm prefix -g`/bin, since that directory isn't on `exec`'s PATH.

## Troubleshooting

| Problem | Fix |
| --- | --- |
| `missing auth token - set TENKI_AUTH_TOKEN or TENKI_API_KEY ...` | `run.mjs` reads only the environment. Export the key. |
| `invalid auth token - API keys and service tokens must start with tk_` | Create a `tk_` key at [app.tenki.cloud](https://app.tenki.cloud). |
| ``No token. Set TENKI_AUTH_TOKEN, or run `tenki login`.`` | `verify.mjs` found no key. Export one or run `tenki login --api-key <key>`. |
| `SyntaxError` on Node 22 or older | Use Node 24 or later for `run.mjs`. |
| `claude exited <n>` | The reason is in the streamed output above it. Check `ANTHROPIC_API_KEY`, and `ANTHROPIC_BASE_URL`/`ANTHROPIC_MODEL` if set. |
| `the agent finished without changing anything` | Read the agent's reply and adjust `TASK`. |
| `claude --help no longer lists …` | The image's Claude Code changed a flag. Update `args` in `run.mjs` and the flag list in `verify.mjs`. |

## Related

- [Codex](../codex-sandbox/) and [OpenCode](../opencode-sandbox/): the same pattern with other coding agents
- [Claude Agent SDK](../claude-agent-sdk/): sandboxed tools for your own agent
- [@anthropic-ai/claude-code](https://www.npmjs.com/package/@anthropic-ai/claude-code)
- [Tenki Sandbox](https://tenki.cloud/products/sandbox) and the [Tenki docs](https://tenki.cloud/docs)
