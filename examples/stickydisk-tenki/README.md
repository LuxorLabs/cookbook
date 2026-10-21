# Sticky disks

Keep dependency caches on a persistent disk between GitHub Actions jobs on [Tenki Runners](https://tenki.cloud/products/runners). A [sticky disk](https://tenki.cloud/docs/runners/sticky-disks) is identified by a key you choose. A job mounts it at a path and uses it like any directory, and when a job allowed to publish succeeds, what it wrote becomes the starting point for the next job with that key. There's no tarball to pack and restore, which suits large caches that change a little each run: `~/.npm`, `~/.cargo`, `~/.gradle`, `~/go/pkg/mod`, compiler caches.

It's a GitHub Action, [`LuxorLabs/stickydisk`](https://github.com/LuxorLabs/stickydisk). Sticky disks are in beta and run on Linux runners only.

## Set it up with a coding agent

Paste this into Claude Code, Codex, Cursor, or another coding agent:

```text
Add a Tenki sticky disk cache to my GitHub Actions workflow, following https://github.com/LuxorLabs/cookbook/tree/main/examples/stickydisk-tenki.
1. Look at my repository's workflows and find the job that installs dependencies (npm, cargo, gradle, or Go modules).
2. Change that job's runs-on to a Linux Tenki runner label such as tenki-standard-medium-4c-8g, if it isn't one already. Ask me first if I'm not already using Tenki Runners.
3. Add a LuxorLabs/stickydisk@v1 step before anything writes to the cache path, with a stable key like npm-node22-v1 and the cache path (for example ~/.npm). Use commit: never in jobs that should only read.
4. Make sure no credentials (for example an .npmrc with a token) are written into the cached path.
5. Show me the diff before committing. Tell me to run the workflow twice on the default branch and check the job summary for source=hit.
```

## Quick start

You need:

- A GitHub repository using [Tenki Runners](https://tenki.cloud/products/runners) on Linux.
- Node.js 20 or later, only for `verify.mjs`.

### 1. Install

Copy [`workflow.yml`](workflow.yml) to `.github/workflows/ci.yml` in a Node project:

```yaml
jobs:
  test:
    runs-on: tenki-standard-medium-4c-8g
    steps:
      - uses: actions/checkout@v6
      # Mount before anything writes to ~/.npm.
      - id: npm-cache
        uses: LuxorLabs/stickydisk@v1
        with:
          key: npm-node22-v1
          path: ~/.npm
      - uses: actions/setup-node@v6
        with:
          node-version: 22
      - run: npm ci
      - run: npm test
      - run: echo "npm cache ${{ steps.npm-cache.outputs.source }} (generation ${{ steps.npm-cache.outputs.generation }})"

  lint:
    runs-on: tenki-standard-medium-4c-8g
    steps:
      - uses: actions/checkout@v6
      - uses: LuxorLabs/stickydisk@v1
        with:
          key: npm-node22-v1
          path: ~/.npm
          commit: never
      # ...setup-node, npm ci, npm run lint
```

Any Linux Tenki label works. Mount before anything writes to the path.

### 2. Set your API key

None needed. The Tenki runner gives each job a sticky disk capability through its environment, and the action uses it.

### 3. Run

Push to the default branch twice. The second run's job summary shows a **Sticky disk** block with `source: hit` and the generation it started from. The `echo` step prints the same.

`test` publishes and `lint` only reads (`commit: never`). They can run at the same time: each job gets its own writable view of the current generation, and `lint`'s writes are discarded.

### 4. Verify

```bash
git clone https://github.com/LuxorLabs/cookbook.git
cd cookbook/examples/stickydisk-tenki
npm install
node verify.mjs
```

[`verify.mjs`](verify.mjs) needs no runner or credentials. It downloads `LuxorLabs/stickydisk@v1`, checks that every `with:` key and output in `workflow.yml` is declared in its `action.yml`, then runs the action's `dist/main.js` and `dist/post.js` with no sticky disk capability. It asserts the mount falls back (`mounted=false`, `source=fallback`), that `fail-on-error: true` fails the step, and that the post step does nothing when nothing was mounted. Set `STICKYDISK_REF=v1.0.5` to check a pinned tag. The mount itself only works on a Tenki runner.

## Inputs and outputs

| Input | Default | |
| --- | --- | --- |
| `key` | | Required. Matched exactly; no prefixes, no `restore-keys` |
| `path` | | Required. An empty or missing directory: absolute, `~/`, or relative to `$GITHUB_WORKSPACE` |
| `commit` | `auto` | `auto` publishes a successful job's writes; `never` reads only |
| `fail-on-error` | `false` | Fail the step instead of running uncached |
| `retries` | `2` | Retries after a failed request to the cache service |
| `retry-delay` | `150ms` | First wait, doubling each retry |
| `retry-max-delay` | `5s` | Longest wait between retries |
| `attempt-timeout` | `35s` mount, `5s` finalize | Longest a single request may take |

The four retry inputs arrived in v1.0.5; `@v1` already points there.

| Output | |
| --- | --- |
| `mounted` | Whether a disk was attached |
| `source` | `hit`, `miss`, `readonly`, or `fallback` |
| `generation` | The generation the job started from, when there is one |

## Keys, scope, and publishing

- **Use a stable key** per cache, like `npm-node22-v1`, and bump it when a tool upgrade makes the old contents useless. Don't put a lockfile hash or commit SHA in it, as you would with `actions/cache`; that prevents reuse.
- **Scope:** keys are scoped to your workspace, repository, region, and runner architecture.
- **Who publishes:** with Branch Protection on (the default), only `push`, `schedule`, and `workflow_dispatch` jobs on the default branch publish. Pull requests get a read-only view even with `commit: auto`. Tenki publishes once GitHub reports the job successful and the disk passes a filesystem check.
- **Never cache credentials.** Every job on the repo can read the current generation, forks included, so keep things like an `.npmrc` with a token out of cached paths.
- **Concurrent publishers:** if two start from the same generation, the first to publish wins and the other is discarded. Use separate keys or a `concurrency` group to order them.

## When storage is unavailable

By default a cache problem doesn't fail the build. If the runner has no capability, sticky disks are off, the budget is full, or the service keeps failing, the action sets `mounted=false` and `source=fallback`, writes the reason to the summary, and the job runs on the runner's own disk. Jobs must work with an empty cache anyway.

To fail instead where a cold run isn't worth the minutes:

```yaml
- uses: LuxorLabs/stickydisk@v1
  with:
    key: cargo-registry-v1
    path: ~/.cargo/registry
    fail-on-error: true
    retries: 1
    attempt-timeout: 4s
```

## Things to know

- Pin `@v1.0.5` or a commit SHA for a fixed version. `v1` moves with each v1 release.
- Allowed paths are under `$GITHUB_WORKSPACE` (not its root), `~/.cache`, `~/.npm`, `~/.cargo`, `~/.gradle`, and `~/go/pkg/mod`, with no symlinks on the way.
- Not supported: `jobs.<id>.container` jobs, macOS runners, and sharing a cache across regions.
- Manage and clear caches under **Runners > Cache & Disks** in the [Tenki dashboard](https://app.tenki.cloud).

## Related

- [Sticky disks](https://tenki.cloud/docs/runners/sticky-disks) in the Tenki docs, with limits and retention
- [`LuxorLabs/stickydisk`](https://github.com/LuxorLabs/stickydisk)
