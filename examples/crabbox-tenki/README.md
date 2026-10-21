# Crabbox

Run your tests on a warm Tenki sandbox with [Crabbox](https://crabbox.sh), an open-source CLI from [OpenClaw](https://github.com/openclaw/crabbox). Crabbox syncs your Git working tree (uncommitted edits included, ignored files like `.env` left out) to a remote Linux machine over rsync, runs a command there, and exits with its exit code. With `provider: tenki`, that machine is a Tenki sandbox, created through the `tenki` CLI and reached through Tenki's SSH proxy, so there are no SSH keys or IPs to manage.

## Set it up with a coding agent

Paste this into Claude Code, Codex, Cursor, or another coding agent:

```text
Set up Crabbox so my tests run on a warm Tenki sandbox, following https://github.com/LuxorLabs/cookbook/tree/main/examples/crabbox-tenki.
1. Check that git, Node.js 20+, the tenki CLI, and crabbox are installed. If tenki or crabbox is missing, tell me how to install it and ask before installing.
2. Ask me to run tenki login myself if crabbox doctor doesn't report provider=tenki with auth=ready. Never ask me to paste a key to you or print one.
3. Clone https://github.com/LuxorLabs/cookbook, cd into examples/crabbox-tenki, run npm install, then node run.mjs, and confirm the summary line shows exit 0, then exit 1, and no .env on the box.
4. Then copy demo/.crabbox.yaml to the root of my repository, set the test job's command to my test command, and run crabbox warmup --slug ci and crabbox run --id ci -- <my test command>.
5. If a step fails, use the Troubleshooting table in the example's README.md.
```

## Quick start

You need:

- The [`tenki` CLI](https://tenki.cloud/docs/sandbox/cli), signed in with `tenki login`. Crabbox uses its saved key and workspace.
- Crabbox: `brew install openclaw/tap/crabbox`, or a binary from [GitHub Releases](https://github.com/openclaw/crabbox/releases).
- Git and Node.js 20 or later.

### 1. Install

```bash
git clone https://github.com/LuxorLabs/cookbook.git
cd cookbook/examples/crabbox-tenki
npm install
```

`npm install` is for `verify.mjs`. `run.mjs` and `demo/` have no dependencies.

### 2. Set your API key

```bash
tenki login
crabbox doctor
```

The last line of `crabbox doctor` should report `provider=tenki` with `auth=ready`.

### 3. Run

```bash
node run.mjs
```

`run.mjs` copies `demo/` (a `slug()` function and two tests) into a fresh Git repo in your temp directory, adds a `.env` that Git ignores, and drives Crabbox:

```js
let pass, broken, envOnBox;
try {
	// .crabbox.yaml sets warmup.keep: false, so the box gets lease.ttl (1h) as its max duration.
	if (crabbox("warmup", "--slug", SLUG) !== 0) throw new Error("crabbox warmup failed");
	pass = crabbox("run", "--id", SLUG, "--", "npm", "test");

	// An edit you haven't committed: drop the lowercasing. Crabbox syncs it anyway.
	const file = join(repo, "src/slug.js");
	writeFileSync(file, readFileSync(file, "utf8").replace(".toLowerCase()", ""));
	broken = crabbox("run", "--id", SLUG, "--", "npm", "test");

	envOnBox = crabbox("run", "--id", SLUG, "--shell", "test -e .env") === 0;
} finally {
	crabbox("stop", SLUG);
}
```

```
clean tree: exit 0 · uncommitted edit: exit 1 · .env on the box: no
```

The second run fails because of an edit that exists only in your working tree. The `.env` never reaches the box.

### 4. Verify

```bash
node verify.mjs
```

```
✓ crabbox-tenki: git manifest (6 files, .env left out) → sandbox with rsync → npm test passes → uncommitted edit → npm test fails → dispose
```

`verify.mjs` checks the Tenki side without Crabbox, which is how CI runs it. It builds the sync manifest with the Git command Crabbox uses, copies it into a sandbox in Crabbox's workspace layout, checks the image has `rsync`, and runs the tests before and after the edit. It reads `TENKI_API_KEY`, `TENKI_AUTH_TOKEN`, or the `tenki login` key.

## The config

[`demo/.crabbox.yaml`](demo/.crabbox.yaml) is the whole integration:

```yaml
# Crabbox config for the demo project. Copy it to the root of your own repository.
provider: tenki
target: linux
tenki:
  cpus: 2
  memoryMB: 4096
  diskGB: 20 # the default root disk is 5 GiB, and it can't grow later
# Give every sandbox Crabbox creates a maximum duration. One-shot runs always get
# lease.ttl as Tenki's --max-duration; warmup.keep: false makes `crabbox warmup` do
# the same instead of creating a sticky session that runs until you stop it.
lease:
  ttl: 1h
warmup:
  keep: false
jobs:
  test:
    command: npm test
    stop: auto # stop a box the job created; leave one passed with --id running
```

- The `tenki` block becomes `tenki sandbox create --cpu --memory-mb --disk-size-gb`. Keep the disk at 20 GB or more; it can't grow later.
- `warmup.keep: false` makes `crabbox warmup` pass `lease.ttl` as the sandbox's maximum duration. Without it, warmup creates a sticky session that runs, and bills, until you stop it. At the deadline Tenki pauses the sandbox, keeping its disk, and Crabbox resumes it on the next run.
- `stop: auto` terminates a box the job created and leaves one passed with `--id` running.

## Use it on your own repository

Copy `demo/.crabbox.yaml` to your repository's root, set the `test` job's `command`, and lease a box:

```bash
crabbox warmup --slug ci
crabbox run --id ci -- npm test
```

The first run installs dependencies. Later runs sync only what changed. For `&&` or pipes, use `--shell` with a quoted string.

```bash
crabbox watch --id ci -- npm test   # rerun on every change; exiting leaves the box up
crabbox job run --id ci test        # the job from .crabbox.yaml, on the warm box
crabbox ssh --id ci                 # a shell in the synced workspace
crabbox stop ci                     # terminate the sandbox
```

To block a push when tests fail, put this in `.git/hooks/pre-push` and make it executable:

```bash
#!/bin/sh
exec crabbox job run --id ci test
```

For coding agents, [`demo/AGENTS.md`](demo/AGENTS.md) is a section to paste into your `AGENTS.md` or `CLAUDE.md`. It tells the agent to leave the box running so installed dependencies survive.

## Things to know

- **Clean up.** A leased box runs until `crabbox stop` or until `lease.ttl` pauses it, and a paused box's saved state counts toward workspace storage. `crabbox list --provider tenki` shows leases. Crabbox's sessions are tagged `crabbox` and `crabbox-provider-tenki`.
- **What syncs:** tracked files plus untracked files Git doesn't ignore. A file committed before it was ignored still syncs.
- **Environment variables:** only `CI` and `NODE_OPTIONS` are forwarded by default. Add `--allow-env NAME`, or list them under `env.allow` (which replaces the default).
- It doesn't replace CI, which tests a commit on a clean machine. The Tenki provider is Linux only.

## Troubleshooting

| Problem | Fix |
| --- | --- |
| `crabbox not found` from `node run.mjs` | Install Crabbox and put it on your `PATH`. |
| `crabbox doctor` says the Tenki CLI isn't logged in | Run `tenki login`, then `tenki status`. |
| The sandbox is in the wrong workspace | Run `tenki login` and pick the workspace, then `crabbox stop` the stray slug. |
| A test that reads an env var fails on the box | Add `--allow-env NAME`, or `env.allow` with `CI` and `NODE_OPTIONS` repeated. |
| `No space left on device` | Keep `tenki.diskGB: 20` or more and lease a new box. |
| Every run reinstalls dependencies | Lease a box with `crabbox warmup --slug ci` and pass `--id ci`. |
| A run on an expired box fails | `crabbox stop` it and lease a new one. |
| ``No token. Set TENKI_AUTH_TOKEN, or run `tenki login`.`` from `verify.mjs` | Export `TENKI_API_KEY`, or run `tenki login`. |
| `✗ rsync is missing from the image, and Crabbox syncs with it` | Use a [template](https://tenki.cloud/docs/sandbox/templates) with `rsync` via `tenki.image`, and tell Tenki. |

## Related

- [Crabbox on Tenki](https://tenki.cloud/docs/sandbox/crabbox) in the Tenki docs
- Crabbox's [Tenki provider](https://crabbox.sh/providers/tenki.html), [sync](https://crabbox.sh/features/sync.html), [jobs](https://crabbox.sh/features/jobs.html), and [commands](https://crabbox.sh/commands/index.html)
- [Pause, snapshot, and resume](../snapshots-pause-resume/) and [Claude Code](../claude-code-sandbox/)
