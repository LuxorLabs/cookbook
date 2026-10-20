# How to run Claude Code unsupervised on a real repo, in a VM you throw away

**Audience:** developers who use [Claude Code](https://www.npmjs.com/package/@anthropic-ai/claude-code) and want to hand it a coding task with no permission prompts, without giving it their own machine.
**Time:** ~15 minutes. `npm install` takes seconds, `verify.mjs` about a minute, and `run.mjs` gives the agent's turn up to 10 minutes.
**Outcome:** an `agent.patch` file on your machine with Claude Code's change to a cloned repo, ready for `git apply` or a PR. When the script finishes, it deletes the VM the agent ran in.

> **Honesty note:** nothing pins the Claude Code version. The sandbox runs the copy that ships in Tenki's default image (2.1.267 as of October 2026), and it changes when Tenki rebuilds the image. `verify.mjs` checks that the two flags `run.mjs` passes still exist in that release, not how the agent behaves.

## Why bother

`--dangerously-skip-permissions` lets Claude Code work without stopping to ask, which is reckless on your laptop. Here the agent runs inside a disposable [Tenki Sandbox](https://tenki.cloud/products/sandbox) sandbox, so the blast radius is one VM that is deleted when the script finishes. What comes back is the agent's work as a patch: apply it to your checkout, open a PR from it, or run many of these in parallel and keep the good ones.

## Install

You need Node 24 or newer for `run.mjs`, which uses top-level `await using`. `verify.mjs` runs on Node 20.

```bash
git clone https://github.com/LuxorLabs/cookbook.git
cd cookbook/examples/claude-code-sandbox
npm install
```

Every later command runs from this directory. The only dependency is `@tenkicloud/sandbox` 1.4.1 or later. You don't need Claude Code on your machine: Tenki's default image already has it on PATH.

## Authenticate

You need a Tenki API key (it starts with `tk_`; create one at https://app.tenki.cloud) and an Anthropic API key.

```bash
export TENKI_AUTH_TOKEN=tk_...   # TENKI_API_KEY works too
export ANTHROPIC_API_KEY=...     # ANTHROPIC_BASE_URL and ANTHROPIC_MODEL pass through too, if set
```

`TENKI_WORKSPACE_ID` is optional. Tenki infers the workspace from a workspace API key.

`run.mjs` reads the Tenki key from the environment only. `verify.mjs` also reads the key that `tenki login --api-key <key>` stores in `~/.config/tenki/config.yaml`, so after `tenki login` you can run the check without exporting anything. To test the Tenki side before you spend model tokens, run [Check it works](#check-it-works) first. It needs no Anthropic key.

## Use it

```bash
node run.mjs   # streams the agent's turn, then saves the diff to agent.patch
```

The script boots a sandbox with [sindresorhus/yocto-queue](https://github.com/sindresorhus/yocto-queue) cloned into it, runs one headless Claude Code turn on the task below, streams the agent's output to your terminal, and prints the diff. It saves the diff as `agent.patch`, which this directory's `.gitignore` excludes. Everything the agent did inside the VM is deleted when the script finishes or fails; `agent.patch` is what you keep.

Apply it to your own clone of the repo:

```bash
git clone https://github.com/sindresorhus/yocto-queue ~/yocto-queue
git -C ~/yocto-queue apply "$PWD/agent.patch"
```

The repo, the task, and the Tenki client are set up at the top of `run.mjs`:

```js
const REPO = "https://github.com/sindresorhus/yocto-queue";
const TASK = "Add a toArray() method to the Queue class in index.js that returns the queued values as an array, oldest first. Declare it in index.d.ts and add a test for it in test.js.";
const PASSTHROUGH = ["ANTHROPIC_API_KEY", "ANTHROPIC_BASE_URL", "ANTHROPIC_MODEL"];

const tenki = new TenkiSandbox({ authToken: process.env.TENKI_AUTH_TOKEN });
```

Edit `TASK` to give the agent different work, or `REPO` to point it at another repository. The example clones a public repo and passes no Git credentials.

## Secrets in, diffs out

The task and your model key go in, with the key scoped to a single process. The diff comes out. Nothing else from your shell crosses into the VM. Here is how `run.mjs` does each part.

### Boot with the repo inside

From `run.mjs`:

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

The default image also ships Node 24, npm 11, and git 2.43, so the example needs no custom image.

### Run the agent with no permission prompts

From `run.mjs`:

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

- `exec(command, { args })` runs a bare binary and its args with no shell splitting, so the whole task prompt goes through as a single argument.
- `ExecOptions.env` is scoped to that one process, so `run.mjs` never writes the model key into the repo or the image.
- `--dangerously-skip-permissions` refuses to run as root. The sandbox user is `tenki`, so it works as written. It is the right flag here because the blast radius is one sandbox.

### Take the diff out before the VM goes away

From `run.mjs`:

```js
// The diff is how the work leaves the VM: save it before the sandbox is torn down.
// sandbox.git.* runs at the workdir; the checkout is one level down, so point it at ./repo.
const patch = await sandbox.git.diff({ directory: "repo" });
if (!patch.trim()) throw new Error("the agent finished without changing anything");
writeFileSync("agent.patch", patch);
console.log(patch);
console.log(`Saved agent.patch. Apply it to a clone of ${REPO} with \`git apply agent.patch\`, or open a PR from it.`);
```

`createAndWait` returns a `Session`, which is an `AsyncDisposable`, so `await using` terminates the VM when the scope ends. That is why `run.mjs` needs Node 24. `verify.mjs` uses `try`/`finally` instead, so CI runs it on Node 20.

## Check it works

```bash
node verify.mjs   # create + clone → check the CLI's version and flags → edit → git diff
```

A passing run prints one line. The version is whichever Claude Code the default image ships:

```
✓ claude-code-sandbox: create + clone → 2.1.267 (Claude Code) on PATH → edit → git diff → dispose
```

This proves the Tenki side of the example: the sandbox boots with the repo cloned, the image's CLI is on PATH and still lists `-p, --print` and `--dangerously-skip-permissions`, and a file edit in the checkout comes back through `sandbox.git.diff`. It needs no model key, so Claude Code never runs a task. The ✓ line prints before teardown, and `verify.mjs` ignores dispose errors, so a pass doesn't confirm the VM was terminated. It doesn't run `run.mjs` itself, and it accepts the key `tenki login` stored, which `run.mjs` doesn't read, so export `TENKI_AUTH_TOKEN` or `TENKI_API_KEY` before `node run.mjs` even if this check passes. This is what CI runs.

## Troubleshooting

- ❌ **`missing auth token - set TENKI_AUTH_TOKEN or TENKI_API_KEY or use authToken option` from `node run.mjs`.** `run.mjs` reads the Tenki key from the environment only, so `tenki login` alone is not enough for it. Export `TENKI_AUTH_TOKEN` or `TENKI_API_KEY`.
- ❌ **`invalid auth token - API keys and service tokens must start with tk_`.** The SDK accepts only `tk_` API keys. Create one at https://app.tenki.cloud.
- ❌ **``No token. Set TENKI_AUTH_TOKEN, or run `tenki login`.``** `verify.mjs` found no key in `TENKI_AUTH_TOKEN`, `TENKI_API_KEY`, or `~/.config/tenki/config.yaml`. Export one of the variables, or run `tenki login --api-key <key>`.
- ❌ **`node run.mjs` fails with a `SyntaxError` on Node 22 or older.** Top-level `await using` needs Node 24, and Node 22 can't parse it. Switch to Node 24 or newer. `verify.mjs` still runs on Node 20.
- ❌ **`claude exited <n>`.** Claude Code failed inside the VM, for example on a bad model key. `run.mjs` streams the CLI's output, so the reason is printed above the error. Check `ANTHROPIC_API_KEY`, and `ANTHROPIC_BASE_URL` or `ANTHROPIC_MODEL` if you set them.
- ❌ **`the agent finished without changing anything`.** Claude Code exited cleanly but left the checkout unchanged, so there is no patch to save. Read the agent's streamed reply to see why, and adjust `TASK`.
- ❌ **`claude --help no longer lists -p, --print` (or `--dangerously-skip-permissions`).** Tenki rebuilt the default image with a Claude Code release that dropped or renamed a flag `run.mjs` passes. Update `args` in `run.mjs` and the flag list in `verify.mjs` to match what `claude --help` lists now.

## FAQ

**When shouldn't I use this?** When you need a fixed Claude Code version, because the sandbox runs whichever release the default image ships. When you want to approve the agent's actions as it goes, because it runs with no permission prompts and the patch is your only review point. When you need anything from the VM besides the diff, because everything else is deleted when the script finishes. And when the repo needs credentials to clone, because `run.mjs` passes none.

**Can I run a newer Claude Code than the image ships?** Yes, but `npm i -g @anthropic-ai/claude-code` alone won't do it. Inside the sandbox, npm installs global packages under `npm prefix -g`, and that `bin` directory isn't on the PATH that `exec` uses, so `claude` still resolves to the image's copy in `/usr/local/bin`. After the install, run the new CLI by its full path.

**Does my Anthropic key end up in the repo or the sandbox image?** Not from `run.mjs`. The key is passed through `ExecOptions.env`, which is scoped to the one `claude` process, so it isn't in the image or the repo's files when the agent starts. The agent itself can read it, so review `agent.patch` before you apply it.

**What if I stop `node run.mjs` with Ctrl-C?** Node exits without running `await using`, so the script doesn't terminate the sandbox. `run.mjs` sets no `maxDurationMs`, and sandboxes don't auto-pause on idle, so nothing in the example bounds an interrupted run. To cap the sandbox's lifetime, add `maxDurationMs` to the `createAndWait` options.

**Can I use a different API endpoint or model?** Yes. Set `ANTHROPIC_BASE_URL` or `ANTHROPIC_MODEL` before `node run.mjs`. The script passes each one through only if it is set: passing an unset variable would deliver an empty string, and an empty `ANTHROPIC_BASE_URL` is worse than none.

## Related

- Claude Code on npm: [@anthropic-ai/claude-code](https://www.npmjs.com/package/@anthropic-ai/claude-code)
- Tenki Sandbox: [tenki.cloud/products/sandbox](https://tenki.cloud/products/sandbox) · docs: [tenki.cloud/docs](https://tenki.cloud/docs) · SDK: [@tenkicloud/sandbox](https://www.npmjs.com/package/@tenkicloud/sandbox)
- The repo the example works on: [sindresorhus/yocto-queue](https://github.com/sindresorhus/yocto-queue)
