# Codex

Run [OpenAI Codex](https://github.com/openai/codex) headless on a real repo inside a Luxor sandbox you throw away. The script clones [sindresorhus/yocto-queue](https://github.com/sindresorhus/yocto-queue) into the sandbox, runs one `codex exec` turn on a task, prints the diff, and closes the sandbox. Codex can edit, install, and run anything on that VM, and the diff is what you keep.

## Set it up with a coding agent

Paste this into Claude Code, Codex, Cursor, or another coding agent:

```text
Set up the Luxor Agent Cloud "Codex" example from https://github.com/LuxorLabs/cookbook, which runs OpenAI Codex headless in a disposable Luxor sandbox and prints the diff.
1. Clone the repo, cd into examples/codex-sandbox, check that Node.js is 24 or later, and run npm install.
2. It needs LUXORAI_AUTH_TOKEN (a Luxor Agent Cloud key starting with tk_, from https://app.luxor.ai) and CODEX_API_KEY (an OpenAI key; if only OPENAI_API_KEY is set, export CODEX_API_KEY=$OPENAI_API_KEY). If a key is missing, stop and ask me to export it. Never print the keys or write them to a file.
3. Run node verify.mjs first (no model turn), then node run.mjs, and show me the diff.
4. If a step fails, use the Troubleshooting table in the example's README.md.
Then ask me which repo and task I want instead, change REPO and TASK in run.mjs, and run it again.
```

## Quick start

You need:

- Node.js 24 or later for `run.mjs`, which uses top-level `await using`. `verify.mjs` runs on Node 20.
- A Luxor Agent Cloud API key (`tk_...`) from [app.luxor.ai](https://app.luxor.ai).
- An OpenAI API key. You don't need Codex installed locally; Luxor Agent Cloud's default image has it.

### 1. Install

```bash
git clone https://github.com/LuxorLabs/cookbook.git
cd cookbook/examples/codex-sandbox
npm install
```

### 2. Set your keys

```bash
export LUXORAI_AUTH_TOKEN=tk_...   # LUXORAI_API_KEY also works
export CODEX_API_KEY=sk-...      # an OpenAI API key
```

`codex exec` reads `CODEX_API_KEY` and ignores `OPENAI_API_KEY`. If your key is in `OPENAI_API_KEY`, run `export CODEX_API_KEY=$OPENAI_API_KEY`.

`run.mjs` reads the Luxor Agent Cloud key from the environment only. `verify.mjs` also accepts a key saved with `luxor login --api-key <key>`. `LUXORAI_WORKSPACE_ID` is optional.

### 3. Verify

Check the Luxor Agent Cloud side first; it needs no OpenAI key:

```bash
node verify.mjs
```

```
✓ codex-sandbox: create + clone → codex-cli 0.154.0 on PATH → reads CODEX_API_KEY → edit → git diff → dispose
```

`verify.mjs` boots a sandbox with the repo cloned, checks that `codex exec --help` still lists the flags `run.mjs` uses, confirms Codex sends `CODEX_API_KEY` to OpenAI (using a dummy key it expects to be rejected), and reads an edit back through `sandbox.git.diff`. It doesn't run a model turn.

### 4. Run

```bash
node run.mjs
```

Codex's output streams to your terminal, then the diff prints. The turn has up to 10 minutes.

## The script

`run.mjs`:

```js
// OpenAI Codex, headless, on a real repo in a disposable Luxor sandbox:
// clone -> let the agent edit the checkout -> read back the diff.
import { LuxorSandbox } from "@luxorai/sandbox";

const REPO = "https://github.com/sindresorhus/yocto-queue";
const TASK = "Add a toArray() method to the Queue class in index.js that returns the queued values as an array, oldest first. Declare it in index.d.ts and add a test for it in test.js.";
// codex exec reads its key from CODEX_API_KEY and ignores OPENAI_API_KEY.
const PASSTHROUGH = ["CODEX_API_KEY"];

const luxor = new LuxorSandbox({ authToken: process.env.LUXORAI_AUTH_TOKEN || process.env.LUXORAI_API_KEY || process.env.TENKI_AUTH_TOKEN || process.env.TENKI_API_KEY });

// cloneRepoUrl checks the repo out to ./repo before createAndWait resolves.
await using sandbox = await luxor.createAndWait({
  cpuCores: 2,
  memoryMb: 4096,
  cloneRepoUrl: REPO,
  workspaceId: process.env.LUXORAI_WORKSPACE_ID || process.env.TENKI_WORKSPACE_ID,
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
```

Change `REPO` and `TASK` to give Codex different work.

- The default image ships Codex, Node 24, npm 11, and git 2.43, so no custom image is needed.
- `exec(command, { args })` doesn't split on spaces, so the whole task reaches Codex as one argument.
- `env` is scoped to the one `codex` process, so the key never lands in the repo or image.

## Why Codex's own sandbox is off

`--dangerously-bypass-approvals-and-sandbox` skips Codex's bubblewrap sandbox and approval prompts. Inside a disposable VM that layer is redundant, and without the flag Codex warns `Codex could not find bubblewrap on PATH`. Don't use this flag on a machine you care about.

With the bypass flag, `codex exec` also skips its Git-repo check, so `--skip-git-repo-check` isn't needed. To point Codex at a directory instead of setting `cwd`, pass `-C, --cd <DIR>`.

## Codex version

The sandbox runs the Codex CLI in Luxor Agent Cloud's default image (codex-cli 0.154.0 as of October 2026), which changes when the image is rebuilt. To use a newer one, `npm i -g @openai/codex` in the sandbox and run it by full path from `npm prefix -g`/bin, since that directory isn't on `exec`'s PATH.

## Troubleshooting

| Problem | Fix |
| --- | --- |
| ``No token. Set LUXORAI_AUTH_TOKEN, or run `luxor login`.`` | `verify.mjs` found no key. Export one or run `luxor login --api-key <key>`. |
| `missing auth token - set LUXORAI_AUTH_TOKEN or LUXORAI_API_KEY ...` | `run.mjs` reads only the environment. Export the key. |
| `invalid auth token - API keys and service tokens must start with tk_` | Create a `tk_` key at [app.luxor.ai](https://app.luxor.ai). |
| `SyntaxError` before anything runs | Use Node 24 or later for `run.mjs`. |
| `codex exec --help no longer lists <flag>` | The image's Codex renamed a flag. Check the [Codex releases](https://github.com/openai/codex/releases) and update `args`. |
| `codex exec never sent CODEX_API_KEY to OpenAI …` | Codex reads a different variable now. Update `PASSTHROUGH` in `run.mjs`. |
| `codex exited <n>` | `CODEX_API_KEY` is missing or invalid. Read the streamed output above the error. |

## Related

- [Claude Code](../claude-code-sandbox/) and [OpenCode](../opencode-sandbox/): the same pattern with other coding agents
- [OpenAI Agents SDK](../openai-agents-sdk/)
- [OpenAI Codex](https://github.com/openai/codex) and [`@openai/codex`](https://www.npmjs.com/package/@openai/codex)
- [Luxor Sandbox](https://luxor.ai/products/sandbox) and the [Luxor Agent Cloud docs](https://luxor.ai/docs)
