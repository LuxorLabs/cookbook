# Move a workflow to Luxor Runners

Run your GitHub Actions jobs on [Luxor Runners](https://luxor.ai/products/runners) instead of GitHub-hosted runners. You install the Luxor Agent Cloud GitHub App on your organization, then change each job's `runs-on` to a Luxor Agent Cloud label. Steps, secrets, `services:`, Docker, and `actions/cache` stay as they are, because the Linux runners use GitHub's own runner images. Each job runs in a fresh VM that is destroyed when the job ends.

## Set it up with a coding agent

Paste this into Claude Code, Codex, Cursor, or another coding agent:

```text
Move my GitHub Actions jobs to Luxor Runners, following https://github.com/LuxorLabs/cookbook/tree/main/examples/luxor-runners.
1. List every job in .github/workflows/*.yml with its current runs-on value.
2. Replace each ubuntu-latest (or ubuntu-24.04) runs-on with one Linux label from https://luxor.ai/docs/runners/sizes: luxor-ubuntu-small-2c-4g for lint and scripts, luxor-ubuntu-medium-4c-8g for tests. Replace macos-* with a luxor-macos-26-* or luxor-macos-15-* label. Replace a self-hosted label array with a single Luxor Agent Cloud label.
3. Change nothing but runs-on. Leave windows-*, arm runners, and runs-on expressions like ${{ matrix.os }} alone and list them for me.
4. Show me the diff before committing. Remind me that the Luxor Agent Cloud GitHub App must be installed on the organization first.
```

## Quick start

You need:

- A GitHub organization, and permission to install a GitHub App on it.
- A [Luxor Agent Cloud account](https://app.luxor.ai).
- Node.js 20 or later, only for `verify.mjs`.

### 1. Install

Connect the organization: in the [Luxor Agent Cloud dashboard](https://app.luxor.ai), open **Runners** and start the GitHub connection. On GitHub, pick **All repositories** or the ones Luxor Agent Cloud may use, then **Install & Authorize**. You can change that list later under GitHub **Settings > Applications > Installed GitHub Apps > Luxor Agent Cloud > Configure**. One Luxor Agent Cloud workspace connects to one GitHub organization.

Then change `runs-on`. The dashboard's **Migration Wizard** does it for you: pick a repository, choose a size per job, and it opens a pull request that changes only `runs-on`. It skips workflows it can't rewrite safely (YAML anchors, multi-line `runs-on`) and lists them.

To do it by hand, edit `.github/workflows/*.yml`. [`workflow.yml`](workflow.yml) is a Node CI workflow after the change:

```yaml
jobs:
  lint:
    runs-on: luxor-ubuntu-small-2c-4g # was: ubuntu-latest
    ...
  test:
    runs-on: luxor-ubuntu-medium-4c-8g # was: ubuntu-latest
    services:
      postgres:
        image: postgres:17
        ...
  image:
    runs-on: luxor-ubuntu-medium-4c-8g # was: ubuntu-latest
    steps:
      - uses: actions/checkout@v6
      - run: docker build -t app:${{ github.sha }} .
```

Nothing else in it differs from the GitHub-hosted version.

### 2. Set your API key

None needed. GitHub sends the jobs to Luxor Agent Cloud through the GitHub App. Your `secrets.*` stay in GitHub and reach the job the same way they do now.

### 3. Run

Commit the change, or merge the wizard's pull request, and trigger the workflow as usual. In the **Actions** tab, open the run and check that each job ran on the Luxor Agent Cloud label you chose. A job starts in about 15 seconds on average.

### 4. Verify

```bash
git clone https://github.com/LuxorLabs/cookbook.git
cd cookbook/examples/luxor-runners
npm install
node verify.mjs
```

[`verify.mjs`](verify.mjs) needs no GitHub or Luxor Agent Cloud credentials. It reads the label tables from the [live Luxor Agent Cloud docs](https://luxor.ai/docs/runners/sizes), then checks that every job in `workflow.yml` has exactly one documented Luxor Agent Cloud label as its `runs-on`. It also checks that it rejects a `[self-hosted, …]` array, `ubuntu-latest`, and a size that doesn't exist. Running the jobs themselves needs a repository connected to Luxor Agent Cloud.

```
✓ luxor-runners: 3 jobs in workflow.yml → runs-on luxor-ubuntu-small-2c-4g, luxor-ubuntu-medium-4c-8g → each is one of 13 labels in the Luxor Agent Cloud docs
```

## Labels

Use one label as the whole `runs-on` value.

| Linux x64 label | vCPU | Memory |
| --- | --- | --- |
| `luxor-ubuntu-small-2c-4g` | 2 | 4 GB |
| `luxor-ubuntu-medium-4c-8g` | 4 | 8 GB |
| `luxor-ubuntu-large-8c-16g` | 8 | 16 GB |
| `luxor-ubuntu-large-plus-16c-32g` | 16 | 32 GB |

macOS runs on Apple Silicon: `luxor-macos-26-{mini,small,medium,large,xlarge}` (macOS 26, Xcode 26 by default) and `luxor-macos-15-{mini,small,medium,large}` (macOS 15, Xcode 16 by default), from 2 to 14 vCPU. Labels from before the rename keep working. Disk sizes, the full table, and sizing advice are on [Runner Sizes & Labels](https://luxor.ai/docs/runners/sizes) and [Which runner should I use?](https://luxor.ai/docs/runners/which-runner-should-i-use). Rates are on the [pricing page](https://luxor.ai/pricing).

Your plan caps the size. Starter allows up to `luxor-ubuntu-small-2c-4g`, or `luxor-ubuntu-medium-4c-8g` with a payment method on file; Team allows up to 16 vCPU / 32 GB. A job above the cap is cancelled, not queued. See [Limits & Concurrency](https://luxor.ai/docs/runners/limits-and-concurrency).

## What carries over from GitHub-hosted runners

- **Preinstalled tools.** Linux runners use the official [`actions/runner-images`](https://github.com/actions/runner-images) image, Ubuntu 24.04 by default: Node, Python, Go, Java, Rust, Docker, cloud CLIs, and the rest of GitHub's software list. macOS images mirror GitHub's ARM64 macOS lists. See [Runner Images](https://luxor.ai/docs/runners/runner-images).
- **Docker, `services:`, and `container:` jobs.** Per the [runner image docs](https://luxor.ai/docs/runners/runner-images), anything that runs on GitHub-hosted `ubuntu-latest` runs on Luxor Agent Cloud Linux runners with no changes. Docker and BuildKit are installed. Public images are pulled through a Docker Hub mirror, which also avoids Docker Hub's anonymous rate limits. The mirror does not keep build layers between jobs; use `--cache-from`/`--cache-to` as you would on GitHub.
- **`actions/cache` and `setup-node`'s `cache:`.** Luxor Agent Cloud hosts a drop-in Actions cache, and npm, APT, Go, Cargo, Maven, Gradle, CocoaPods, and SwiftPM downloads go through mirrors near the runners. Nothing to configure. See [Caching](https://luxor.ai/docs/runners/caching).
- **Secrets.** Luxor Agent Cloud has no secrets store. GitHub injects `secrets.*` into the job and masks them, as before, and fetching from Vault or a cloud secret manager with OIDC works the same way. See [Secrets & Signing](https://luxor.ai/docs/runners/secrets-and-signing).
- **GitHub's limits.** Luxor Agent Cloud adds no job time limit; GitHub's 6 hours per job still applies.

## What changes

- **Images refresh monthly.** Luxor Agent Cloud brings its images back in line with GitHub's once a month, so a tool version can lag a recent GitHub image update for a short time.
- **There are Linux x64 and macOS labels only.** Leave `windows-*` and Arm Linux jobs on GitHub-hosted runners. Linux labels don't name an Ubuntu version; if a job pins `ubuntu-22.04`, test it on 24.04 first.
- **Concurrency comes from your plan.** Runner jobs and Luxor Sandbox sessions share one concurrent-session limit. Jobs over it queue, and queue time isn't billed.
- **Egress IPs are Luxor Agent Cloud's.** Jobs leave from a fixed Luxor Agent Cloud CIDR, shared across customers by default. If a firewall allowlists GitHub's ranges, ask hello@luxor.ai for the Luxor Agent Cloud range, or for a dedicated range. See [Networking & Egress](https://luxor.ai/docs/runners/networking).

## Moving off self-hosted runners

- **Replace the whole `runs-on` value.** `runs-on: [self-hosted, linux, x64]` becomes `runs-on: luxor-ubuntu-medium-4c-8g`. Luxor Agent Cloud cancels a job whose `runs-on` mixes a Luxor Agent Cloud label with others.
- **Nothing persists between jobs.** Each job gets a fresh VM, so tools you installed once on your own machines and files left on their disks aren't there. Install tools in a step or rely on the image, and keep caches in `actions/cache`. For large caches that change a little each run, use a [sticky disk](../stickydisk-luxor/). Custom images are an Enterprise plan option.
- **Private network access.** Luxor Agent Cloud has no PrivateLink or VPC peering today. Allowlist Luxor Agent Cloud's egress CIDR, or email hello@luxor.ai to scope private connectivity.
- **No runner fleet to run.** The Luxor Agent Cloud GitHub App registers and removes runners on your organization, which is why it asks for the **Administration** permission. See [GitHub App access levels](https://luxor.ai/docs/github/gh-app-access-level).

## Troubleshooting

| Problem | Fix |
| --- | --- |
| The organization doesn't appear in Luxor Agent Cloud | Install the Luxor Agent Cloud GitHub App on it, and make sure your GitHub user is a member. It may already be connected to another Luxor Agent Cloud workspace. |
| Job stays queued | The repository isn't in the app's repository list, Actions is disabled for it, or you're at your plan's concurrency limit. |
| Luxor Agent Cloud cancelled the run | The label isn't a Luxor Agent Cloud label, `runs-on` mixes labels, the size is above your plan's cap, or the workspace has no credit or hit its daily spending limit. Luxor Agent Cloud emails the workspace owner when it cancels a run. |
| Job is killed or slow and flaky | It's short of memory or CPU. Move up one size. |

More in the [runners troubleshooting guide](https://luxor.ai/docs/runners/troubleshooting).

## Notes

- `verify.mjs` checks labels against the docs, not against a live runner. Whether a job's steps pass on Luxor Agent Cloud only shows up when you run the workflow.
- Lint Luxor Agent Cloud labels in your own repository with actionlint by listing them under `self-hosted-runner.labels` in `.github/actionlint.yaml`. actionlint accepts `[self-hosted, luxor-...]` arrays, so it won't catch that mistake. See [Luxor Agent Cloud's actionlint guide](https://luxor.ai/blog/lint-github-actions-workflows-actionlint).

## Related

- [Luxor Runners quickstart](https://luxor.ai/docs/runners/quickstart)
