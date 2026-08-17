# Claude Code on Tenki (headless, on a real repo)

Run Claude Code non-interactively against a real Git checkout inside a disposable [Tenki Sandbox](https://tenki.cloud/products/sandbox) microVM, then read back the diff the agent produced and throw the machine away.

## The code (`run.mjs`)

```js
import { TenkiSandbox, stdoutText } from "@tenkicloud/sandbox";

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
await sandbox.exec("npm", { args: ["i", "-g", "@anthropic-ai/claude-code"] });

const decoder = new TextDecoder();
await sandbox.exec("claude", {
  // Skipping permission prompts is what the throwaway VM buys you: the agent gets a
  // free hand on a machine whose entire filesystem you delete at the end of this script.
  args: ["-p", TASK, "--dangerously-skip-permissions"],
  cwd: "repo", // relative paths resolve under the workdir, /home/tenki
  timeoutMs: 10 * 60_000,
  env: Object.fromEntries(PASSTHROUGH.filter((k) => process.env[k]).map((k) => [k, process.env[k]])),
  onOutput: ({ data }) => process.stdout.write(decoder.decode(data)), // data is a Uint8Array
});

// sandbox.git.* runs at the workdir, and the checkout is one level down — so use `git -C`.
console.log(stdoutText(await sandbox.exec("git", { args: ["-C", "repo", "diff"] })));
```

The last line is the point: a unified diff against a real upstream checkout, produced by an agent that had root-free run of a machine you are about to delete.

## Run it

```bash
npm install
export TENKI_AUTH_TOKEN=...      # from `tenki login` (~/.config/tenki/config.yaml)
export TENKI_WORKSPACE_ID=...
export ANTHROPIC_API_KEY=...     # the agent turn; ANTHROPIC_MODEL is optional
node run.mjs                     # streams the agent's turn, then prints the diff
```

Verify the Tenki half without a model key — this is what CI runs:

```bash
node verify.mjs   # create + clone → install the CLI → read its version → edit → git diff
```

## Notes

- **`sandbox.git.*` runs at the sandbox workdir (`/home/tenki`), but `cloneRepoUrl` checks out one level down into `./repo`** — so `sandbox.git.diff()` fails with "not a git repository". Read the checkout with `sandbox.exec("git", { args: ["-C", "repo", "diff"] })`, or clone at the workdir root if you want the helpers.
- The default image already ships Node 24, npm 11, and git 2.43, and outbound network is on for a bare `create`. `npm i -g @anthropic-ai/claude-code` finishes in about five seconds — no `allowOutbound`, no custom image, no baked-in CLI.
- `--dangerously-skip-permissions` refuses to run as root; the sandbox user is `tenki`, so it works as written. It is the right flag *here* precisely because the blast radius is one microVM.
- `exec(command, { args })` runs a bare binary and its args with no shell splitting, so the whole task prompt goes through as a single argument. `ExecOptions.env` is scoped to that one process — the model key never lands in the repo or the image.
- Secrets in, diffs out: nothing else from your shell crosses into the VM, and `await using` terminates it when the scope ends (`Session` is an `AsyncDisposable`). Requires Node 20+.
