# Move a workflow to Tenki Runners

Run your GitHub Actions jobs on [Tenki Runners](https://tenki.cloud/products/runners) instead of GitHub-hosted runners. You install the Tenki GitHub App on your organization, then change each job's `runs-on` to a Tenki label. Steps, secrets, `services:`, Docker, and `actions/cache` stay as they are, because the Linux runners use GitHub's own runner images. Each job runs in a fresh VM that is destroyed when the job ends.

## Set it up with a coding agent

Paste this into Claude Code, Codex, Cursor, or another coding agent:

```text
Move my GitHub Actions jobs to Tenki Runners, following https://github.com/LuxorLabs/cookbook/tree/main/examples/tenki-runners.
1. List every job in .github/workflows/*.yml with its current runs-on value.
2. Replace each ubuntu-latest (or ubuntu-24.04) runs-on with one Linux label from https://tenki.cloud/docs/runners/sizes: tenki-standard-small-2c-4g for lint and scripts, tenki-standard-medium-4c-8g for tests. Replace macos-* with a tenki-macos-26-* or tenki-macos-15-* label. Replace a self-hosted label array with a single Tenki label.
3. Change nothing but runs-on. Leave windows-*, arm runners, and runs-on expressions like ${{ matrix.os }} alone and list them for me.
4. Show me the diff before committing. Remind me that the Tenki GitHub App must be installed on the organization first.
```

## Quick start

You need:

- A GitHub organization, and permission to install a GitHub App on it.
- A [Tenki account](https://app.tenki.cloud).
- Node.js 20 or later, only for `verify.mjs`.

### 1. Install

Connect the organization: in the [Tenki dashboard](https://app.tenki.cloud), open **Runners** and start the GitHub connection. On GitHub, pick **All repositories** or the ones Tenki may use, then **Install & Authorize**. You can change that list later under GitHub **Settings > Applications > Installed GitHub Apps > Tenki > Configure**. One Tenki workspace connects to one GitHub organization.

Then change `runs-on`. The dashboard's **Migration Wizard** does it for you: pick a repository, choose a size per job, and it opens a pull request that changes only `runs-on`. It skips workflows it can't rewrite safely (YAML anchors, multi-line `runs-on`) and lists them.

To do it by hand, edit `.github/workflows/*.yml`. [`workflow.yml`](workflow.yml) is a Node CI workflow after the change:

```yaml
jobs:
  lint:
    runs-on: tenki-standard-small-2c-4g # was: ubuntu-latest
    ...
  test:
    runs-on: tenki-standard-medium-4c-8g # was: ubuntu-latest
    services:
      postgres:
        image: postgres:17
        ...
  image:
    runs-on: tenki-standard-medium-4c-8g # was: ubuntu-latest
    steps:
      - uses: actions/checkout@v6
      - run: docker build -t app:${{ github.sha }} .
```

Nothing else in it differs from the GitHub-hosted version.

### 2. Set your API key

None needed. GitHub sends the jobs to Tenki through the GitHub App. Your `secrets.*` stay in GitHub and reach the job the same way they do now.

### 3. Run

Commit the change, or merge the wizard's pull request, and trigger the workflow as usual. In the **Actions** tab, open the run and check that each job ran on the Tenki label you chose. A job starts in about 15 seconds on average.

### 4. Verify

```bash
git clone https://github.com/LuxorLabs/cookbook.git
cd cookbook/examples/tenki-runners
npm install
node verify.mjs
```

[`verify.mjs`](verify.mjs) needs no GitHub or Tenki credentials. It reads the label tables from the [live Tenki docs](https://tenki.cloud/docs/runners/sizes), then checks that every job in `workflow.yml` has exactly one documented Tenki label as its `runs-on`. It also checks that it rejects a `[self-hosted, …]` array, `ubuntu-latest`, and a size that doesn't exist. Running the jobs themselves needs a repository connected to Tenki.

```
✓ tenki-runners: 3 jobs in workflow.yml → runs-on tenki-standard-small-2c-4g, tenki-standard-medium-4c-8g → each is one of 12 labels in the Tenki docs
```

## Labels

Use one label as the whole `runs-on` value.

| Linux x64 label | vCPU | Memory |
| --- | --- | --- |
| `tenki-standard-small-2c-4g` | 2 | 4 GB |
| `tenki-standard-medium-4c-8g` | 4 | 8 GB |
| `tenki-standard-large-8c-16g` | 8 | 16 GB |
| `tenki-standard-large-plus-16c-32g` | 16 | 32 GB |

macOS runs on Apple Silicon: `tenki-macos-26-{mini,small,medium,large}` (macOS 26, Xcode 26 by default) and `tenki-macos-15-{mini,small,medium,large}` (macOS 15, Xcode 16 by default), from 2 to 8 vCPU. Disk sizes, the full table, and sizing advice are on [Runner Sizes & Labels](https://tenki.cloud/docs/runners/sizes) and [Which runner should I use?](https://tenki.cloud/docs/runners/which-runner-should-i-use). Rates are on the [pricing page](https://tenki.cloud/pricing).

Your plan caps the size. Starter allows up to `tenki-standard-small-2c-4g`, or `tenki-standard-medium-4c-8g` with a payment method on file; Team allows up to 16 vCPU / 32 GB. A job above the cap is cancelled, not queued. See [Limits & Concurrency](https://tenki.cloud/docs/runners/limits-and-concurrency).

## What carries over from GitHub-hosted runners

- **Preinstalled tools.** Linux runners use the official [`actions/runner-images`](https://github.com/actions/runner-images) image, Ubuntu 24.04 by default: Node, Python, Go, Java, Rust, Docker, cloud CLIs, and the rest of GitHub's software list. macOS images mirror GitHub's ARM64 macOS lists. See [Runner Images](https://tenki.cloud/docs/runners/runner-images).
- **Docker, `services:`, and `container:` jobs.** Per the [runner image docs](https://tenki.cloud/docs/runners/runner-images), anything that runs on GitHub-hosted `ubuntu-latest` runs on Tenki Linux runners with no changes. Docker and BuildKit are installed. Public images are pulled through a Docker Hub mirror, which also avoids Docker Hub's anonymous rate limits. The mirror does not keep build layers between jobs; use `--cache-from`/`--cache-to` as you would on GitHub.
- **`actions/cache` and `setup-node`'s `cache:`.** Tenki hosts a drop-in Actions cache, and npm, APT, Go, Cargo, Maven, Gradle, CocoaPods, and SwiftPM downloads go through mirrors near the runners. Nothing to configure. See [Caching](https://tenki.cloud/docs/runners/caching).
- **Secrets.** Tenki has no secrets store. GitHub injects `secrets.*` into the job and masks them, as before, and fetching from Vault or a cloud secret manager with OIDC works the same way. See [Secrets & Signing](https://tenki.cloud/docs/runners/secrets-and-signing).
- **GitHub's limits.** Tenki adds no job time limit; GitHub's 6 hours per job still applies.

## What changes

- **Images refresh monthly.** Tenki brings its images back in line with GitHub's once a month, so a tool version can lag a recent GitHub image update for a short time.
- **There are Linux x64 and macOS labels only.** Leave `windows-*` and Arm Linux jobs on GitHub-hosted runners. Linux labels don't name an Ubuntu version; if a job pins `ubuntu-22.04`, test it on 24.04 first.
- **Concurrency comes from your plan.** Runner jobs and Tenki Sandbox sessions share one concurrent-session limit. Jobs over it queue, and queue time isn't billed.
- **Egress IPs are Tenki's.** Jobs leave from a fixed Tenki CIDR, shared across customers by default. If a firewall allowlists GitHub's ranges, ask hello@tenki.cloud for the Tenki range, or for a dedicated range. See [Networking & Egress](https://tenki.cloud/docs/runners/networking).

## Moving off self-hosted runners

- **Replace the whole `runs-on` value.** `runs-on: [self-hosted, linux, x64]` becomes `runs-on: tenki-standard-medium-4c-8g`. Tenki cancels a job whose `runs-on` mixes a Tenki label with others.
- **Nothing persists between jobs.** Each job gets a fresh VM, so tools you installed once on your own machines and files left on their disks aren't there. Install tools in a step or rely on the image, and keep caches in `actions/cache`. For large caches that change a little each run, use a [sticky disk](../stickydisk-tenki/). Custom images are an Enterprise plan option.
- **Private network access.** Tenki has no PrivateLink or VPC peering today. Allowlist Tenki's egress CIDR, or email hello@tenki.cloud to scope private connectivity.
- **No runner fleet to run.** The Tenki GitHub App registers and removes runners on your organization, which is why it asks for the **Administration** permission. See [GitHub App access levels](https://tenki.cloud/docs/github/gh-app-access-level).

## Troubleshooting

| Problem | Fix |
| --- | --- |
| The organization doesn't appear in Tenki | Install the Tenki GitHub App on it, and make sure your GitHub user is a member. It may already be connected to another Tenki workspace. |
| Job stays queued | The repository isn't in the app's repository list, Actions is disabled for it, or you're at your plan's concurrency limit. |
| Tenki cancelled the run | The label isn't a Tenki label, `runs-on` mixes labels, the size is above your plan's cap, or the workspace has no credit or hit its daily spending limit. Tenki emails the workspace owner when it cancels a run. |
| Job is killed or slow and flaky | It's short of memory or CPU. Move up one size. |

More in the [runners troubleshooting guide](https://tenki.cloud/docs/runners/troubleshooting).

## Notes

- `verify.mjs` checks labels against the docs, not against a live runner. Whether a job's steps pass on Tenki only shows up when you run the workflow.
- Lint Tenki labels in your own repository with actionlint by listing them under `self-hosted-runner.labels` in `.github/actionlint.yaml`. actionlint accepts `[self-hosted, tenki-…]` arrays, so it won't catch that mistake. See [Tenki's actionlint guide](https://tenki.cloud/blog/lint-github-actions-workflows-actionlint).

## Related

- [Tenki Runners quickstart](https://tenki.cloud/docs/runners/quickstart)
