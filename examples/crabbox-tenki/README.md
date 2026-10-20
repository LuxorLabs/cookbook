# How to run your tests on a warm Tenki sandbox with Crabbox

`crabbox warmup` leases a Tenki sandbox that runs the demo project's tests, fails them when you edit a file you have not committed, and never receives your `.env`. The sandbox has a maximum duration. `node verify.mjs` passes.

About 10 minutes, once the `tenki` CLI is signed in and Crabbox is installed.

CI has no `crabbox` binary, so `verify.mjs` does not run Crabbox. It checks the Tenki side of the contract: it builds the sync manifest with the same Git command Crabbox uses, copies it into a sandbox under Crabbox's workspace layout, checks that the image has `rsync`, and runs the tests there. `run.mjs` is the end-to-end path, and it needs Crabbox and a signed-in `tenki` CLI on your machine.

[Crabbox](https://crabbox.sh) is an open-source CLI from [OpenClaw](https://github.com/openclaw/crabbox). It takes the working tree in your Git checkout, syncs it to a remote Linux machine over SSH with rsync, runs a command there, streams the output back, and exits with the remote command's exit code. With `provider: tenki`, that machine is a [Tenki Sandbox](https://tenki.cloud/products/sandbox) session: Crabbox asks the `tenki` CLI to create, resume and terminate it, and connects through Tenki's SSH proxy with a per-session certificate. You don't manage SSH keys or guest IPs.

Tenki's own guide is [tenki.cloud/docs/sandbox/crabbox](https://tenki.cloud/docs/sandbox/crabbox). This example follows it, with one change: every sandbox gets a maximum duration (see [Step 3](#step-3--read-the-config)).

## Prerequisites

- The [`tenki` CLI](https://tenki.cloud/docs/sandbox/cli), signed in with `tenki login`. Crabbox uses the CLI's saved credentials and workspace.
- Crabbox: `brew install openclaw/tap/crabbox`, or an archive from [GitHub Releases](https://github.com/openclaw/crabbox/releases).
- Git and Node.js 20 or newer on your machine. The demo's tests run on the sandbox's Node, not yours.
- For `verify.mjs`, a `tk_` API key in `TENKI_API_KEY`, or the key `tenki login` stored.

## Step 1 — Get the example

```bash
git clone https://github.com/LuxorLabs/cookbook.git
cd cookbook/examples/crabbox-tenki
npm install
```

`npm install` is for `verify.mjs`, which uses `@tenkicloud/sandbox`. `run.mjs` and the `demo/` project have no dependencies.

## Step 2 — Check Crabbox can see Tenki

```bash
tenki login
crabbox doctor
```

The last line of `crabbox doctor` should report `provider=tenki` with `auth=ready`. If it says the CLI isn't logged in, run `tenki login` again.

## Step 3 — Read the config

`demo/` is a small Node project: a `slug()` function and two tests that run with `npm test`. Its `.crabbox.yaml` is the whole integration:

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

- `provider: tenki` and `target: linux` select the Tenki provider. It's Linux only.
- The `tenki` block sizes the sandbox. Crabbox passes these values to `tenki sandbox create` as `--cpu`, `--memory-mb` and `--disk-size-gb`.
- `lease.ttl` and `warmup.keep: false` are this example's change from Tenki's guide. By default `crabbox warmup` creates a sticky session, which has no maximum duration and runs until you stop it. With `warmup.keep: false`, Crabbox passes `lease.ttl` to Tenki as `--max-duration` instead. When the hour is up, Tenki pauses the sandbox rather than terminating it, so you still finish with `crabbox stop`.
- The `test` job saves typing the command. `stop: auto` terminates a sandbox the job created and leaves alone one you passed with `--id`.

## Step 4 — Run the whole loop

```bash
node run.mjs
```

`run.mjs` copies `demo/` into a fresh Git repository in your temp directory (Crabbox decides what to sync by asking Git, so the demo needs its own repo), commits it, and writes a `.env` that Git ignores. Then it drives Crabbox:

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

Crabbox's own output streams to your terminal as it goes. The script ends with a summary line. A non-zero exit from the tests shows as `exit 1`:

```
clean tree: exit 0 · uncommitted edit: exit 1 · .env on the box: no
```

The second run fails because of an edit that exists only in your working tree. Nothing was committed or pushed. The `.env` check passes because Crabbox syncs tracked files plus untracked files Git doesn't ignore, and the demo's `.gitignore` lists `.env`.

## Step 5 — Use it on your own repository

Copy `demo/.crabbox.yaml` to the root of your repository, change the `test` job's `command` to your test command, and lease a box:

```bash
crabbox warmup --slug ci
crabbox run --id ci -- npm test
```

The sandbox starts empty, so install dependencies on the first run. Later runs sync only what changed, and the installed dependencies stay on the box. For a command with `&&` or pipes, use `--shell` with a quoted string. Without it, everything after `--` is one program and its arguments.

Other commands for the warm box:

```bash
crabbox watch --id ci -- npm test   # rerun on every change; exiting leaves the box up
crabbox job run --id ci test        # the job from .crabbox.yaml, on the warm box
crabbox ssh --id ci                 # a shell in the synced workspace
crabbox stop ci                     # terminate the sandbox
```

To block a push when the tests fail, call the job from `.git/hooks/pre-push` and make the hook executable:

```bash
#!/bin/sh
exec crabbox job run --id ci test
```

If a coding agent works in your repository, tell it the checks run on the warm box. [`demo/AGENTS.md`](demo/AGENTS.md) is a section you can paste into your own `AGENTS.md` or `CLAUDE.md`. Its last line, "Leave the box running", is there because an agent that stops the box throws away the installed dependencies.

## Step 6 — Check it works

```bash
node verify.mjs
```

[`verify.mjs`](verify.mjs) reads your key from `TENKI_API_KEY` (or its alias `TENKI_AUTH_TOKEN`), or from the key `tenki login` stored. It builds the demo's manifest with `git ls-files --cached --others --exclude-standard`, the command Crabbox uses, and creates a sandbox with a 10-minute `maxDurationMs`. It copies the manifest to `crabbox/cbx_verify/crabbox-demo` under `/home/tenki`, the same `<work-root>/<lease-id>/<repo-name>` layout Crabbox uses, and runs `npm test` there. Then it makes `run.mjs`'s uncommitted edit, syncs again, and expects the tests to fail. On success it prints:

```
✓ crabbox-tenki: git manifest (6 files, .env left out) → sandbox with rsync → npm test passes → uncommitted edit → npm test fails → dispose
```

This proves that a Tenki sandbox runs the demo's tests from a Crabbox-style manifest, that the image has the `rsync` Crabbox syncs with, and that the ignored `.env` stays out. It doesn't run Crabbox, `tenki login`, the SSH proxy, or the `.crabbox.yaml` above. `run.mjs` is the test of those. `verify.mjs` ignores dispose errors, so the ✓ doesn't prove the sandbox was terminated; its `maxDurationMs` bounds it if dispose fails.

## Clean up

`run.mjs` stops its sandbox in a `finally` block, including when a step throws. If it's interrupted before that, `crabbox list --provider tenki` shows the lease, and `crabbox stop cookbook-demo` terminates it.

A box you leased by hand runs until `crabbox stop`, or until `lease.ttl` pauses it. A paused sandbox keeps its disk and memory, and that saved state counts toward your workspace storage, so stop boxes you're done with. In `tenki sandbox list` and the [Tenki dashboard](https://app.tenki.cloud), Crabbox's sessions carry the tags `crabbox` and `crabbox-provider-tenki`.

## Troubleshooting

- ❌ **`crabbox not found` from `node run.mjs`.** Install Crabbox with `brew install openclaw/tap/crabbox`, or put a release binary on your `PATH`.
- ❌ **`crabbox doctor` says the Tenki CLI isn't logged in.** Run `tenki login`, then `tenki status`. Crabbox doesn't create anything until the CLI has a valid key.
- ❌ **The sandbox ended up in the wrong workspace.** Crabbox uses the workspace of the `tenki` CLI's saved key. Run `tenki login` and pick the workspace, then `crabbox stop` the stray slug.
- ❌ **A test that reads an environment variable passes locally and fails on the box.** Crabbox forwards only allowlisted variables, `CI` and `NODE_OPTIONS` by default. Add `--allow-env NAME` to the run, or list it under `env.allow` in `.crabbox.yaml`. That list replaces the default, so repeat `CI` and `NODE_OPTIONS`.
- ❌ **`No space left on device`.** The default root disk is 5 GiB. Keep `tenki.diskGB: 20` (or more) and lease a new box. An existing sandbox's disk can't grow.
- ❌ **Every run reinstalls dependencies.** You're running without `--id`, so each run gets a new sandbox. Lease one with `crabbox warmup --slug ci` and pass `--id ci`.
- ❌ **``No token. Set TENKI_AUTH_TOKEN, or run `tenki login`.`` from `verify.mjs`.** It found no key in `TENKI_AUTH_TOKEN`, `TENKI_API_KEY`, or `~/.config/tenki/config.yaml`. Export `TENKI_API_KEY`, or run `tenki login`.
- ❌ **`✗ rsync is missing from the image, and Crabbox syncs with it`.** Tenki's default image no longer ships `rsync`, so Crabbox can't sync to a stock sandbox. Start boxes from a [template](https://tenki.cloud/docs/sandbox/templates) that installs it, with `tenki.image` in `.crabbox.yaml`, and report it to Tenki.

## FAQ

**When shouldn't I use this?** As a replacement for CI: the box runs your working tree on a machine with history, and CI runs a commit on a clean one, which is what a merge should require. For tests that need macOS or Windows, because the Tenki provider is Linux only. And for tests that need services on your laptop, such as a local database, unless you run them on the box too.

**Why not keep the box sticky, as Tenki's guide does?** You can. Drop `warmup.keep: false` and `crabbox warmup` creates a sticky session that never hits a deadline, which suits a box you use all day. It also runs, and bills, until you stop it. This example bounds it because a forgotten sticky box has nothing that ends it.

**What happens when the hour is up?** Tenki pauses the sandbox. The disk and memory are kept, and `/home/tenki`, including the synced workspace and installed dependencies, survives. Crabbox's Tenki provider resumes a paused session before it runs a command on it. Neither script runs past the deadline, so that path isn't exercised here; if a run on an expired box fails, `crabbox stop` it and lease a new one.

**Does my `.env` go up?** Not if Git ignores it and has never tracked it. A file committed before it was added to `.gitignore` is still tracked, and still syncs.

**Do I need a Tenki API key for Crabbox?** No. Crabbox uses the `tenki` CLI's saved login. Only `verify.mjs` reads `TENKI_API_KEY`, and it falls back to the same saved key.

## Related

- [Crabbox](https://crabbox.sh): the [Tenki provider page](https://crabbox.sh/providers/tenki.html), [sync](https://crabbox.sh/features/sync.html), [jobs](https://crabbox.sh/features/jobs.html) and the [command reference](https://crabbox.sh/commands/index.html)
- [openclaw/crabbox](https://github.com/openclaw/crabbox) on GitHub
- Tenki's guide: [Crabbox](https://tenki.cloud/docs/sandbox/crabbox), and the post [Run your tests on a warm sandbox before you push](https://tenki.cloud/blog/run-tests-before-you-push-warm-sandbox)
- [Tenki docs](https://tenki.cloud/docs)
- [`../snapshots-pause-resume/`](../snapshots-pause-resume/): pause and resume a sandbox from the SDK
- [`../claude-code-sandbox/`](../claude-code-sandbox/): a coding agent working in a Tenki sandbox
