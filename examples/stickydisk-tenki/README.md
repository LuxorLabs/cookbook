# Sticky disks on Tenki runners

A [sticky disk](https://tenki.cloud/docs/runners/sticky-disks) is a disk that [Tenki Runners](https://tenki.cloud/products/runners) keep between GitHub Actions jobs, identified by a key you choose. A job mounts it at a path and uses it like any other directory; when a job that is allowed to publish succeeds, what it wrote becomes the starting point for the next job with the same key. There is no tarball to pack and restore, which suits large caches that change a little on every run: `~/.npm`, `~/.cargo`, `~/.gradle`, `~/go/pkg/mod`, compiler caches.

It's a GitHub Action, [`LuxorLabs/stickydisk`](https://github.com/LuxorLabs/stickydisk), not an SDK call. A compatible Tenki runner hands each job a sticky disk capability through its environment, and the action uses it to ask Tenki for a mount. Sticky disks are in beta and run on Linux runners only.

## The workflow (`workflow.yml`)

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

Any Linux Tenki label works; no separate sticky disk label is needed. The action's post step always runs and finalizes the disk, with a publish request only when `commit` is `auto`. Tenki publishes once GitHub reports the job successful and the disk passes a filesystem check.

`test` publishes and `lint` only reads. They can run at the same time: each job gets its own writable view of the current generation, and `lint`'s writes are thrown away when it ends.

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

The action also writes a **Sticky disk** block to the job summary: mount mode, generation, fallback reason, the previous candidate's outcome, and publication state.

## Keys, scope, and publishing

Use a stable key per cache, like `npm-node22-v1`, and bump it when a tool upgrade makes the old contents useless. Unlike `actions/cache`, don't put a lockfile hash or commit SHA in it; that prevents reuse. Keys are scoped to your workspace, repository, region, and runner architecture, so two repos using `npm-cache` get two disks.

With Branch Protection on (the default for new workspaces), only `push`, `schedule`, and `workflow_dispatch` jobs on the default branch publish; pull requests get a read-only view even with `commit: auto`. Every job on the repo can read the current generation, forks included, so **never leave credentials (an `.npmrc` with a token, say) in a cached path.**

If two publishing jobs start from the same generation, the first to publish wins and the other candidate is discarded; changes are never merged. Use separate keys or a workflow `concurrency` group if publishers must run in order.

## When storage is unavailable

A cache problem shouldn't fail your build, so by default it doesn't. If the runner has no capability, sticky disks are off, the budget is full, or the service is still failing after its retries, the action sets `mounted=false` and `source=fallback`, writes the reason to the summary, and the job runs on the runner's own disk. Your jobs must work with an empty cache anyway.

Set `fail-on-error: true` where a cold run isn't worth the minutes:

```yaml
- uses: LuxorLabs/stickydisk@v1
  with:
    key: cargo-registry-v1
    path: ~/.cargo/registry
    fail-on-error: true
    retries: 1
    attempt-timeout: 4s
```

## Verify

```bash
npm install
node verify.mjs
```

No Tenki runner or credentials needed. [`verify.mjs`](verify.mjs) downloads `LuxorLabs/stickydisk@v1` from GitHub, the same tarball a runner fetches, and checks that every `with:` key and `outputs.*` reference in `workflow.yml` is declared in its `action.yml`. Then it runs the action's real `dist/main.js` and `dist/post.js` with an Actions-style environment and no sticky disk capability. It asserts the mount falls back (`mounted=false`, `source=fallback`, "storage unavailable" in the summary), that `fail-on-error: true` fails the step, and that the post step is a no-op when nothing was mounted. Set `STICKYDISK_REF=v1.0.5` to check a pinned tag.

The mount itself can't be exercised off a Tenki runner: the capability (`TENKI_STICKYDISK_URL` / `TENKI_STICKYDISK_TOKEN`) is issued per job by the runner, and there's no Sandbox API or CLI for it. To see a `hit`, run the workflow twice on a Tenki runner and read the job summary.

## Notes

- Pin `@v1.0.5` or a commit SHA for a fixed version; release tags are immutable, and `v1` moves with each v1 release.
- Mount before anything writes to the path. A step that fills the directory first leaves the action nothing to mount.
- Allowed paths are under `$GITHUB_WORKSPACE` (not the workspace root itself), `~/.cache`, `~/.npm`, `~/.cargo`, `~/.gradle`, and `~/go/pkg/mod`, with no symlinks on the way.
- Not supported: `jobs.<id>.container` jobs, macOS runners, and sharing a cache across regions.
- Manage and clear caches under **Runners > Cache & Disks** in the [Tenki dashboard](https://app.tenki.cloud). Full limits and retention: [Sticky Disks docs](https://tenki.cloud/docs/runners/sticky-disks).
