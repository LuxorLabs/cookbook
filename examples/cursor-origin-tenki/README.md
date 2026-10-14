# Tenki Code Reviewer on Cursor Origin

[Origin](https://cursor.com/docs/origin) is Cursor's code hosting (early beta, paid Cursor plans): repos, pull requests, and GitHub sync, with Cursor agents working directly on the code. [Tenki Code Reviewer](https://tenki.cloud/products/code-reviewer) is in the Origin App Marketplace ([launch post](https://tenki.cloud/blog/tenki-code-reviewer-cursor-origin)). Once installed, it reviews every pull request on the repos you select and posts a summary, inline findings, a verdict, and a **Tenki Code Review** check.

This example is the scenario from the launch post, ready to push: a small invoices API whose `AGENTS.md` says every team route must check membership, plus a pull request that adds an endpoint which only checks that the user is signed in. The tests still pass. The reviewer is what should catch it.

| Path | What it is |
| --- | --- |
| [`starter/`](starter/) | The repo you push to Origin: `src/app.mjs`, `node:test` tests, and the review rules in [`AGENTS.md`](starter/AGENTS.md) |
| [`pr/app.mjs`](pr/app.mjs) | The PR's version of `src/app.mjs`: adds `GET /teams/:team/invoice-totals` without `requireMember` |
| [`verify.mjs`](verify.mjs) | Runs the repo at each stage (main, PR, fix) in a Tenki sandbox |

## Prerequisites

- A [Tenki account](https://app.tenki.cloud/auth/registration). Reviews are billed per review from your workspace balance, and new accounts start with free credits; see [pricing](https://tenki.cloud/pricing).
- A Cursor plan with Origin access and a claimed codebase name at [cursor.com/codebase](https://cursor.com/codebase).
- The [Origin CLI](https://cursor.com/docs/origin/cli):

```bash
curl -fsSL https://downloads.cursor.com/origin/install.sh | sh   # installs to ~/.local/bin/origin
origin auth login                                                # also sets up the git credential helper
```

## 1. Connect Tenki to your Origin namespace

Either side works:

- **From Tenki:** open **Code Reviewer** in your workspace and select **Install App** next to **Cursor Origin**. Cursor opens its install page; choose **All repositories** or **Select repositories**, review the permissions, and select **Install**.
- **From Cursor:** in codebase settings, open **Apps**, find **Tenki** under **Code Review**, and select **Install**. Cursor sends you to Tenki: sign in with the **same email you use on Cursor**, pick a workspace, and select **Connect**. The link expires after 2 hours.

A workspace connects to one Origin namespace and vice versa. Tenki asks only for read access to code plus write access to PR comments, reviews, checks, and the PR description, and never pushes code ([full list](https://tenki.cloud/docs/reviewer/cursor-origin#permissions)).

## 2. Push the starter repo

```bash
origin repo create invoices-api

cp -r starter ~/invoices-api && cd ~/invoices-api
git init -b main
git add . && git commit -m "Invoices API"
git remote add origin https://origin.cursor.com/<your-namespace>/invoices-api.git
git push -u origin main
```

Create the repo on Origin; don't mirror it from GitHub. Cursor gives apps read-only access to GitHub-synced repos, so Tenki reviews those through its GitHub app instead. If you installed Tenki for **Select repositories**, add `invoices-api` under **Apps → Tenki → Repository Access → Manage** in Cursor's codebase settings; with **All repositories**, new repos are picked up automatically.

[`AGENTS.md`](starter/AGENTS.md) is how you give the reviewer house rules. Tenki reads `AGENTS.md` (or `CLAUDE.md`; `AGENTS.md` wins if both exist) from the repo root, plus any in parent directories of a changed file, and layers it on top of its default checks. There's nothing to configure in the dashboard ([Custom Context](https://tenki.cloud/docs/reviewer/custom-context)).

## 3. Open the pull request

```bash
git switch -c invoice-totals
cp <path-to-cookbook>/examples/cursor-origin-tenki/pr/app.mjs src/app.mjs
npm test                                   # still 3/3 green
git commit -am "Add invoice totals endpoint"

origin pr create -t "Add invoice totals endpoint" --push
origin pr ready
```

`origin pr create` opens a **draft** by default, and Tenki skips drafts until they're published. `origin pr ready` is what starts the review (or pass `--status open` to `create`). Asking a Cursor agent to make the same change and then marking its PR ready works the same way.

## 4. Read the review

Tenki posts "Tenki is reviewing this pull request…" and replaces it with the summary when it finishes.

```bash
origin pr view --comments          # summary comment, verdict, and finding threads
origin pr thread list --unresolved # the inline findings
origin pr checks --watch           # the Tenki Code Review check
```

Expect a finding on the new `invoice-totals` route: any signed-in user can read another team's totals (here, `gus` from globex reading acme's), which breaks the `AGENTS.md` rule. Each finding has a severity, category, explanation, and suggested fix. On Origin the **Tenki Code Review** check fails while any Critical, High, or Medium finding is open, and Tenki doesn't approve.

## 5. Fix it and re-review

Ask Cursor to fix the finding, or apply it yourself:

```diff
 	["GET", /^\/teams\/([^/]+)\/invoice-totals$/, (user, team) => {
-		if (!user) throw new HttpError(401, "sign in required");
+		requireMember(user, team);
 		const totalCents = invoices.filter((i) => i.team === team).reduce((sum, i) => sum + i.amountCents, 0);
```

```bash
git commit -am "Check team membership on invoice totals" && git push
origin pr comment -b "@tenki-reviewer"
```

Pushes aren't re-reviewed by default. Turn on **Review on Push** in **Code Reviewer → Configuration** to skip the comment; each re-review is billed as a review. With no blocking findings left, Tenki approves (**Approve on Clean Review** is on by default), the check passes, and you can `origin pr merge`. The check doesn't block merging unless you require it under the repo's Rules and Protections in Origin.

To dismiss a finding that doesn't apply, reply in its thread with "false positive", "not a bug", "won't fix", "by design", or similar (`origin pr thread reply <thread-id> -b "won't fix: …"`). Tenki won't raise it again.

## Tuning

Settings live in **Code Reviewer → Configuration**, apply to GitHub and Origin alike, and can be overridden per repo ([Settings](https://tenki.cloud/docs/reviewer/settings)):

| Setting | Default | Notes |
| --- | --- | --- |
| Severity Threshold | All four levels | Low findings only appear as nitpicks in the summary |
| Automatic Review | On | Off means review only on `@tenki-reviewer` |
| Review on Push | Off | Re-review after each push |
| Approve on Clean Review | On | Approve when nothing worse than nitpicks is open |
| Comment Detail Level | Standard | **Detailed** adds a "Prompt for AI Agents" block to each finding |
| PR Walkthrough | Off | Adds a walkthrough to the PR description |
| Ignore Usernames | `dependabot[bot]`, `renovate[bot]` | On Origin, enter the author's email address |

## Verify

```bash
npm install
node verify.mjs
```

A real review needs an Origin namespace with the Tenki app installed, so [`verify.mjs`](verify.mjs) checks what this example ships instead. It confirms `AGENTS.md` carries the membership rule and that `pr/app.mjs` differs from the starter only by the new route. Then it boots a Tenki sandbox, uploads the starter repo, and runs the tests plus a probe (`gus` requests acme's totals) at each stage: main (404, no route), the PR (200, the leak, with tests still green), and the fix from step 5 (403). No Cursor account or model key is needed. Needs your Tenki key (`tenki login`, or `TENKI_AUTH_TOKEN`).

## Notes

- Reopened PRs aren't reviewed automatically; comment `@tenki-reviewer`.
- Reviews from both providers show up on the **Reviews** tab of Code Reviewer; filter by provider to see only Origin.
- Troubleshooting: [Tenki isn't reviewing Cursor Origin pull requests](https://tenki.cloud/docs/reviewer/troubleshooting#tenki-isnt-reviewing-cursor-origin-pull-requests).
