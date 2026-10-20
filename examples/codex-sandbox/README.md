# How to run OpenAI Codex headless on a real repo in a disposable sandbox

The terminal prints a unified diff of the edit Codex made to a fresh checkout of [sindresorhus/yocto-queue](https://github.com/sindresorhus/yocto-queue). The edit is produced inside a [Tenki Sandbox](https://tenki.cloud/products/sandbox) that is closed when the script exits.

About 15 minutes, most of it the agent turn, which `run.mjs` allows up to 10 minutes.

Nothing pins the Codex version. The sandbox runs the copy that ships in Tenki's default image (codex-cli 0.154.0 as of October 2026), and it changes when Tenki rebuilds the image. `verify.mjs` checks the flags and the key variable `run.mjs` relies on.

## Why bother

An agent that edits code needs a machine it can change freely. Here that machine is a Tenki sandbox that exists only for this run, so Codex can edit, install and run what it likes, and you keep one artifact: the diff against a real upstream checkout. The agent never runs on your machine, and the model key goes only to the one `codex` process, so it never lands in the repo or the image.

## Install

You need Node 24 or later for `run.mjs`, which uses top-level `await using`. The verify script runs on Node 20, which is what CI uses.

```bash
git clone https://github.com/LuxorLabs/cookbook.git
cd cookbook/examples/codex-sandbox
npm install
```

Every later command runs from this directory. The only dependency is `@tenkicloud/sandbox` 1.4.1 or later. You don't need the Codex CLI on your machine: Tenki's default image already has it on PATH.

## Authenticate

You need a Tenki API key (it starts with `tk_`; create one at https://app.tenki.cloud) and an OpenAI API key.

```bash
export TENKI_AUTH_TOKEN=tk_...   # or TENKI_API_KEY, which is what CI sets
export CODEX_API_KEY=sk-...      # an OpenAI API key; only run.mjs needs it
```

`codex exec` reads its key from `CODEX_API_KEY` and ignores `OPENAI_API_KEY`, so if your key is already in `OPENAI_API_KEY`, run `export CODEX_API_KEY=$OPENAI_API_KEY`.

- `run.mjs` passes `TENKI_AUTH_TOKEN` to the SDK. If that's unset, the SDK falls back to `TENKI_API_KEY`. It does not read `~/.config/tenki/config.yaml`, so export one of the two even if you've run `tenki login`.
- `verify.mjs` also accepts a key stored by `tenki login --api-key <key>` in `~/.config/tenki/config.yaml`.
- `TENKI_WORKSPACE_ID` is optional. Tenki infers the workspace from a workspace API key; both scripts pass it through if you set it.

## Use it

```bash
node run.mjs   # streams the agent's turn, then prints the diff
```

This is the whole of `run.mjs`:

```js
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
```

Three things the comments don't say:

- No custom image is needed. The default image ships the Codex CLI along with Node 24, npm 11 and git 2.43.
- `exec(command, { args })` runs a bare binary with no shell splitting, so the whole task prompt reaches Codex as a single argument.
- `await using` closes the sandbox when the script exits, including when it throws.

The last line is the point: a unified diff against a real upstream checkout, produced by an agent that had free run of a machine you are about to delete. To try a different task, change `REPO` and `TASK` at the top of the file.

## Why Codex's own sandbox is turned off

Codex brings its own sandbox, and nesting it inside a sandbox buys you nothing.

- Without the bypass flag, Codex wraps its commands in bubblewrap. In this sandbox it warns `Codex could not find bubblewrap on PATH` and falls back to a bundled copy.
- `--dangerously-bypass-approvals-and-sandbox` reports `sandbox: danger-full-access` and skips that layer. That is the right call *here* precisely because the blast radius is one disposable VM. On a machine you care about, it is not.
- `--skip-git-repo-check` is not needed. Codex runs inside a Git checkout, and `codex exec` skips its Git-repo check when the bypass flag is set anyway. If you drop the bypass flag and run outside a repo, Codex exits with `Not inside a trusted directory and --skip-git-repo-check was not specified.`
- If you'd rather point Codex at a directory than set `cwd`, pass `-C, --cd <DIR>`.

## Check it works

`verify.mjs` checks everything except the agent's turn, without a model key. This is what CI runs.

```bash
node verify.mjs
```

It prints:

```
✓ codex-sandbox: create + clone → codex-cli 0.154.0 on PATH → reads CODEX_API_KEY → edit → git diff → dispose
```

The version is whichever Codex CLI the default image ships. The check proves that the sandbox boots with yocto-queue cloned into `./repo`, that the image's Codex CLI is on PATH, that `codex exec --help` still lists both `--dangerously-bypass-approvals-and-sandbox` and `-C, --cd`, and that an edit in the checkout comes back through `sandbox.git.diff`. It also runs `codex exec` once with a dummy `CODEX_API_KEY` and expects OpenAI to reject that key, which proves Codex still reads the variable `run.mjs` forwards. It stands in for the agent's edit with a one-line `printf`, so it doesn't prove that your key works or that the model makes a good change.

## Troubleshooting

**❌ ``No token. Set TENKI_AUTH_TOKEN, or run `tenki login`.``** `verify.mjs` found no key in `TENKI_AUTH_TOKEN`, `TENKI_API_KEY` or `~/.config/tenki/config.yaml`. Export `TENKI_AUTH_TOKEN`, or run `tenki login --api-key <key>`.

**❌ `missing auth token - set TENKI_AUTH_TOKEN or TENKI_API_KEY or use authToken option`.** `run.mjs` doesn't read `~/.config/tenki/config.yaml`, so a key stored by `tenki login` isn't enough for it. Export `TENKI_AUTH_TOKEN` or `TENKI_API_KEY`.

**❌ `invalid auth token - API keys and service tokens must start with tk_`.** The SDK accepts only `tk_` keys. Create an API key at https://app.tenki.cloud and export that.

**❌ `node run.mjs` fails with a `SyntaxError` before anything runs.** Your Node can't parse top-level `await using`; Node 22 can't. Use Node 24 or later. `node verify.mjs` still runs on Node 20.

**❌ `codex exec --help no longer lists <flag>`.** Tenki rebuilt the default image with a Codex CLI that renamed or removed a flag `run.mjs` passes. Find the new flag in the [Codex releases](https://github.com/openai/codex/releases) and update `args` in `run.mjs`.

**❌ `codex exec never sent CODEX_API_KEY to OpenAI; check which env var it reads now`.** The Codex CLI in the image no longer reads `CODEX_API_KEY`. Find the variable it reads now in the [Codex releases](https://github.com/openai/codex/releases) and update `PASSTHROUGH` in `run.mjs`.

**❌ `codex exited <n>`.** Codex got no `CODEX_API_KEY`, or a bad key, and `run.mjs` stops rather than print an empty diff. Export `CODEX_API_KEY` (setting only `OPENAI_API_KEY` isn't enough), then read the streamed output above the error.

## FAQ

**When shouldn't I use this?** When you need the same Codex every time: the version comes with Tenki's default image, and `verify.mjs` only checks that two flags and the key variable still work. When you want Codex's own sandbox and approval prompts, since this example turns both off and that is only reasonable on a throwaway VM. And when you need CI to prove the agent turn end to end; it proves the Tenki side only.

**Can I run a newer Codex than the image ships?** Yes, but `npm i -g @openai/codex` alone won't do it. Inside the sandbox, npm installs global packages under `npm prefix -g`, and that `bin` directory isn't on the PATH that `exec` uses, so `codex` still resolves to the image's copy in `/usr/local/bin`. After the install, run the new CLI by its full path.

**Does my OpenAI key end up in the repo or the image?** No. It goes in `ExecOptions.env`, which is scoped to the one `codex` process.

## Related

- [OpenAI Codex](https://github.com/openai/codex) and [`@openai/codex` on npm](https://www.npmjs.com/package/@openai/codex)
- [Tenki Sandbox](https://tenki.cloud/products/sandbox) and the [Tenki docs](https://tenki.cloud/docs)
- [claude-code-sandbox](../claude-code-sandbox/): the same shape with Anthropic's CLI
- [openai-agents-sdk](../openai-agents-sdk/): the OpenAI Agents SDK with Tenki as a code-interpreter backend
