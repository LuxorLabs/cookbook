# How to review Cursor Origin pull requests with Tenki Code Reviewer

You finish with an `invoices-api` repo on Origin. Tenki flags its pull request for a missing team-membership check and approves the pull request once you fix it. `node verify.mjs` passes.

About 20 minutes if you already have Origin access. About 6 of that is waiting on two reviews. The launch post puts a review at about 3 minutes.

Origin is in early beta and is not on Cursor's Free or Plus plans. Tenki bills each review to your workspace balance, and this guide runs two reviews.

[Origin](https://cursor.com/docs/origin) is Cursor's code hosting: repos, pull requests, and GitHub sync, with Cursor agents working directly on the code. [Tenki Code Reviewer](https://tenki.cloud/products/code-reviewer) is in the Origin App Marketplace ([launch post](https://tenki.cloud/blog/tenki-code-reviewer-cursor-origin)). Once installed, it reviews every pull request on the repos you select and posts a summary, inline findings, a verdict, and a **Tenki Code Review** check.

This example is the scenario from the launch post, ready to push: a small invoices API whose `AGENTS.md` says every team route must check membership, plus a pull request that adds an endpoint which only checks that the user is signed in. The tests still pass. The reviewer is what should catch it.

| Path | What it is |
| --- | --- |
| [`starter/`](starter/) | The repo you push to Origin: `src/app.mjs`, `node:test` tests, and the review rules in [`AGENTS.md`](starter/AGENTS.md) |
| [`pr/app.mjs`](pr/app.mjs) | The PR's version of `src/app.mjs`: adds `GET /teams/:team/invoice-totals` without `requireMember` |
| [`verify.mjs`](verify.mjs) | Runs the repo at each stage (main, PR, fix) in a Tenki sandbox |

## Prerequisites

- A [Tenki account](https://app.tenki.cloud/auth/registration). Reviews are billed per review from your workspace balance, and new accounts start with free credits; see [pricing](https://tenki.cloud/pricing).
- A Cursor plan that includes Origin ([who can access](https://cursor.com/docs/origin#who-can-access)).
- A claimed codebase name at [cursor.com/codebase](https://cursor.com/codebase). It's the namespace your Origin repos live under. During the beta you can't change it after you claim it, so choose it carefully.
- git, and Node.js 20 or newer for the local test run and `verify.mjs`.
- For `verify.mjs` only: a `tk_` Tenki API key from https://app.tenki.cloud. The reviewer doesn't use one.

## Step 1 — Get the example

```bash
git clone https://github.com/LuxorLabs/cookbook.git
cd cookbook/examples/cursor-origin-tenki
```

Step 4 copies `starter/` out of this directory into a new repo, and Step 9 runs the verify script from here.

## Step 2 — Install the Origin CLI and sign in

The [Origin CLI](https://cursor.com/docs/origin/cli) (`origin`) is separate from the Cursor Agent CLI.

```bash
curl -fsSL https://downloads.cursor.com/origin/install.sh | sh   # installs to ~/.local/bin/origin
origin auth login                                                # also sets up the git credential helper
```

Finish the browser sign-in with the Cursor account that has Origin access. Because the login sets up git's credential helper, the plain `git push` in Step 4 works without further setup.

## Step 3 — Connect Tenki to your Origin namespace

Either side works:

- **From Tenki:** open **Code Reviewer** in your workspace and select **Install App** next to **Cursor Origin**. If GitHub is already connected, use the install button in the **Cursor Origin** row under **Configuration → Connections** instead. Cursor opens its install page; choose **All repositories** or **Select repositories**, review the permissions, and select **Install**.
- **From Cursor:** in codebase settings, open **Apps**, find **Tenki** under **Code Review**, and select **Install**. Cursor sends you to Tenki: sign in with the **same email you use on Cursor**, pick a workspace, and select **Connect**. The link Cursor sends you to expires after 2 hours.

A workspace connects to one Origin namespace and vice versa. Tenki asks only for read access to code plus write access to PR comments, reviews, checks, and the PR description, and never pushes code ([full list](https://tenki.cloud/docs/reviewer/cursor-origin#permissions)).

## Step 4 — Push the starter repo

From the example directory:

```bash
origin repo create invoices-api

cp -r starter ~/invoices-api && cd ~/invoices-api
git init -b main
git add . && git commit -m "Invoices API"
git remote add origin https://origin.cursor.com/<your-namespace>/invoices-api.git
git push -u origin main
```

Without a slash, `origin repo create` puts the repo in your account's namespace. Put that namespace in the remote URL, and make sure it's the one you connected to Tenki in Step 3.

Create the repo on Origin; don't mirror it from GitHub. Cursor gives apps read-only access to GitHub-synced repos, so Tenki reviews those through its GitHub app instead. If you installed Tenki for **Select repositories**, add `invoices-api` under **Apps → Tenki → Repository Access → Manage** in Cursor's codebase settings; with **All repositories**, new repos are picked up automatically.

[`AGENTS.md`](starter/AGENTS.md) is how you give the reviewer house rules. Tenki reads `AGENTS.md` from the repo root, plus any in parent directories of a changed file, and layers those rules on top of its default checks. `CLAUDE.md` works too; if both exist, `AGENTS.md` wins. There's nothing to configure in the dashboard ([Custom Context](https://tenki.cloud/docs/reviewer/custom-context)). This is the whole file the starter ships:

```md
# Review context for the invoices API

## Always flag

- Any route under `/teams/:team/...` that returns team data without calling `requireMember(user, team)` first. Signing in is not enough; the user must belong to that team.
- Money stored or summed as floats. Amounts are integer cents (`amountCents`).

## Focus areas

- The `routes` table in `src/app.mjs`: every new route is an authorization decision.

## Ignore

- `package-lock.json`

## Conventions

- Handlers throw `HttpError(status, message)` for client errors; `handle()` turns it into a response.
```

## Step 5 — Open the pull request

Still in `~/invoices-api`, with `<path-to-cookbook>` set to where you cloned the cookbook in Step 1:

```bash
git switch -c invoice-totals
cp <path-to-cookbook>/examples/cursor-origin-tenki/pr/app.mjs src/app.mjs
npm test                                   # still 3/3 green
git commit -am "Add invoice totals endpoint"

origin pr create -t "Add invoice totals endpoint" --push
origin pr ready
```

The new route sits next to the existing one in the `routes` table. This excerpt from [`pr/app.mjs`](pr/app.mjs) shows the gap: the invoices route calls `requireMember`, and the totals route only checks that there is a user.

```js
export function requireMember(user, team) {
  if (!user) throw new HttpError(401, "sign in required");
  if (!members[team]?.includes(user)) throw new HttpError(403, "not a member of this team");
}

const routes = [
  ["GET", /^\/teams\/([^/]+)\/invoices$/, (user, team) => {
    requireMember(user, team);
    return invoices.filter((i) => i.team === team);
  }],
  ["GET", /^\/teams\/([^/]+)\/invoice-totals$/, (user, team) => {
    if (!user) throw new HttpError(401, "sign in required");
    const totalCents = invoices.filter((i) => i.team === team).reduce((sum, i) => sum + i.amountCents, 0);
    return { team, totalCents };
  }],
];
```

`origin pr create` opens a **draft** by default, and Tenki skips drafts until they're published. `origin pr ready` is what starts the review (or pass `--status open` to `create`). Asking a Cursor agent to make the same change and then marking its PR ready works the same way.

## Step 6 — Read the review

Tenki posts "Tenki is reviewing this pull request…" and replaces it with the summary when it finishes.

```bash
origin pr view --comments          # summary comment, verdict, and finding threads
origin pr thread list --unresolved # the inline findings
origin pr checks --watch           # the Tenki Code Review check
```

Expect a finding on the new `invoice-totals` route: any signed-in user can read another team's totals (here, `gus` from globex reading acme's), which breaks the `AGENTS.md` rule. Each finding has a severity, category, explanation, and suggested fix. On Origin the **Tenki Code Review** check fails while any Critical, High, or Medium finding is open, and Tenki doesn't approve.

## Step 7 — Fix it and re-review

Ask Cursor to fix the finding, or apply it yourself in `src/app.mjs`:

```diff
   ["GET", /^\/teams\/([^/]+)\/invoice-totals$/, (user, team) => {
-    if (!user) throw new HttpError(401, "sign in required");
+    requireMember(user, team);
     const totalCents = invoices.filter((i) => i.team === team).reduce((sum, i) => sum + i.amountCents, 0);
```

```bash
git commit -am "Check team membership on invoice totals" && git push
origin pr comment -b "@tenki-reviewer"
```

Pushes aren't re-reviewed by default, which is why you comment `@tenki-reviewer`. To have each push re-reviewed without the comment, turn on **Review on Push** in **Code Reviewer → Configuration**; each re-review is billed as a review. With no blocking findings left, Tenki approves (**Approve on Clean Review** is on by default), the check passes, and you can `origin pr merge`. The check doesn't block merging unless you require it under the repo's **Rules and Protections** in Origin.

To dismiss a finding that doesn't apply, reply in its thread with "false positive", "not an issue", "not a bug", "won't fix", "by design", "intended behavior", or "working as intended" (`origin pr thread reply <thread-id> -b "won't fix: …"`). Tenki won't raise it again. A negated phrase, such as "this is not a false positive", doesn't count.

## Step 8 — Tune the reviewer (optional)

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

## Step 9 — Check it works

From `cookbook/examples/cursor-origin-tenki`:

```bash
npm install
node verify.mjs
```

[`verify.mjs`](verify.mjs) reads your key from `TENKI_AUTH_TOKEN`, `TENKI_API_KEY`, or the key `tenki login --api-key <key>` stored in `~/.config/tenki/config.yaml`. It installs the latest `@tenkicloud/sandbox` (`>=1.4.1`).

A real review needs an Origin namespace with the Tenki app installed, so the script checks what this example ships instead. It confirms `AGENTS.md` carries the membership rule and that `pr/app.mjs` differs from the starter only by the new route. Then it boots a 1-CPU, 1 GB Tenki sandbox, uploads the starter repo, and at each stage swaps in that stage's `src/app.mjs`, runs the tests, and runs a probe where `gus` requests acme's totals:

```js
  const stages = [];
  for (const [name, app, want] of [["main", starterApp, "404"], ["pr", prApp, "200"], ["fixed", fixedApp, "403"]]) {
    await sandbox.writeFile("invoices-api/src/app.mjs", app);
    const tests = await sh("node --test 2>&1");
    if (tests.exitCode !== 0) throw new Error(`${name}: tests failed\n${stdoutText(tests)}`);
    const probe = await sh(PROBE);
    const status = stdoutText(probe).trim();
    if (status !== want) throw new Error(`${name}: non-member read of acme totals returned ${status}, expected ${want}`);
    stages.push(`${name} tests pass, leak probe ${status}`);
  }
```

The `fixed` stage is the PR's file with the Step 7 change applied. On success it prints:

```
✓ cursor-origin-tenki: AGENTS.md rules + planted bug checked → in a Tenki sandbox: main tests pass, leak probe 404 → pr tests pass, leak probe 200 → fixed tests pass, leak probe 403 → dispose
```

This proves the example still tells the story it claims: no route on main (404), a leak on the PR with the tests still green (200), and the fix closing it (403). It doesn't touch Origin or run Tenki Code Reviewer, so no Cursor account or model key is needed; Steps 5 to 7 are the test of the review itself.

## Troubleshooting

**❌ `command not found: origin` after installing the CLI.** The installer puts the binary in `~/.local/bin`, which isn't on your `PATH`. Add `export PATH="$HOME/.local/bin:$PATH"` to your shell profile (`~/.zshrc` or `~/.bashrc`) and reload it.

**❌ `git push` to `origin.cursor.com` fails.** Git has no Origin credentials yet. Run `origin auth login`, which also sets up the git credential helper, then push again.

**❌ The PR exists but Tenki never posts "Tenki is reviewing this pull request…".** `origin pr create` opened it as a draft, and Tenki skips drafts. Run `origin pr ready`. If the PR isn't a draft, check that `invoices-api` is in Tenki's **Repository Access** in Cursor, and that Cursor Origin shows **Connected** under **Code Reviewer → Configuration → Connections** (use **Reconnect** or **Retry install** if it doesn't). See [Tenki isn't reviewing Cursor Origin pull requests](https://tenki.cloud/docs/reviewer/troubleshooting#tenki-isnt-reviewing-cursor-origin-pull-requests).

**❌ Tenki doesn't review a repo you synced from GitHub.** Cursor gives apps read-only access to GitHub-synced repos. Create the repo on Origin as in Step 4, or connect Tenki's GitHub app to review the GitHub copy.

**❌ No new review after you push the fix.** Pushes aren't re-reviewed by default. Comment `@tenki-reviewer`, or turn on **Review on Push**.

**❌ No review on a reopened PR.** Reopened PRs aren't reviewed automatically. Comment `@tenki-reviewer`.

**❌ The Tenki Code Review check still fails after the re-review.** The check fails while any Critical, High, or Medium finding is open on the PR, including open findings from earlier reviews. Fix them, or dismiss the ones that don't apply by replying in the thread as in Step 7.

**❌ The link from Cursor to Tenki has expired.** It's valid for 2 hours. Install Tenki again from Cursor or from Code Reviewer.

**❌ Tenki says it was installed by a different account.** You're signed in to Tenki with an email other than the one you use on Cursor. Sign in with your Cursor email, then open the link from Cursor again.

**❌ Tenki says this workspace already uses Cursor Origin.** A workspace connects to one namespace. Disconnect the current namespace under **Code Reviewer → Configuration → Connections**, or choose another workspace.

**❌ `` No token. Set TENKI_AUTH_TOKEN, or run `tenki login`. ``** verify.mjs found no key in `TENKI_AUTH_TOKEN`, `TENKI_API_KEY`, or `~/.config/tenki/config.yaml`. Export one, or run `tenki login --api-key <key>`.

**❌ `✗ AGENTS.md is missing …`, `✗ pr/app.mjs …`, or `✗ <stage>: non-member read of acme totals returned …` from verify.mjs.** The script checks the files as this example ships them, so an edit to `starter/` or `pr/` breaks it. Restore them with `git restore starter pr` and run it again.

## FAQ

**When shouldn't I use this?** When the repo you want reviewed is mirrored from GitHub into Origin: apps get read-only access there, so use Tenki's GitHub app instead. When you aren't on a Cursor plan that includes Origin, or don't want to depend on an early-beta host. When you want every push re-reviewed but not billed per review: each re-review with **Review on Push** is billed as a review. And `verify.mjs` is no substitute for trying the reviewer, because it never runs a review.

**Do I need a Tenki API key for reviews?** No. The reviewer works through the Tenki app you install on your namespace. Only `verify.mjs` needs a key.

**Can I use `CLAUDE.md` instead of `AGENTS.md`?** Yes. If both exist, Tenki uses `AGENTS.md` and ignores `CLAUDE.md`; the two aren't merged.

**Where do I see Origin reviews in Tenki?** On the **Reviews** tab of Code Reviewer, which lists reviews from GitHub and Origin. Filter by provider to see only Origin.

**How do I clean up afterward?** Delete the repo with `origin repo delete <your-namespace>/invoices-api`. To stop reviews on the namespace, use **Disconnect** in the **⋯** menu next to Cursor Origin under **Code Reviewer → Configuration → Connections**, or **Suspend** or **Uninstall** Tenki from **Apps** in Cursor's codebase settings. Past reviews stay available in Code Reviewer.

## Related

- [Origin docs](https://cursor.com/docs/origin) and the [Origin CLI](https://cursor.com/docs/origin/cli), with its [pull request commands](https://cursor.com/docs/origin/cli/reference/pull-requests)
- [Tenki Code Reviewer](https://tenki.cloud/products/code-reviewer) and the [launch post](https://tenki.cloud/blog/tenki-code-reviewer-cursor-origin)
- Tenki docs: [Cursor Origin](https://tenki.cloud/docs/reviewer/cursor-origin), [Custom Context](https://tenki.cloud/docs/reviewer/custom-context), [Settings](https://tenki.cloud/docs/reviewer/settings), [Troubleshooting](https://tenki.cloud/docs/reviewer/troubleshooting)
- [Tenki docs](https://tenki.cloud/docs)
