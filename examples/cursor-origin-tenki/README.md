# Cursor Origin

[Tenki Code Reviewer](https://tenki.cloud/products/code-reviewer) reviews pull requests on [Cursor Origin](https://cursor.com/docs/origin) and enforces the rules in your repo's `AGENTS.md`. It posts a summary, inline findings, a verdict, and a **Tenki Code Review** check on every PR in the repos you select.

This example is a small invoices API with one house rule: every `/teams/:team/...` route must check team membership. You push it to Origin, open a PR that adds an endpoint without that check, and Tenki flags it even though the tests pass. Fix it, ask for a re-review, and Tenki approves.

| Path | What it is |
| --- | --- |
| [`starter/`](starter/) | The repo you push: `src/app.mjs`, `node:test` tests, and the review rules in [`AGENTS.md`](starter/AGENTS.md) |
| [`pr/app.mjs`](pr/app.mjs) | The PR's `src/app.mjs`: adds `GET /teams/:team/invoice-totals` without `requireMember` |
| [`verify.mjs`](verify.mjs) | Runs the repo at each stage (main, PR, fix) in a Tenki sandbox |

## Requirements

- A Cursor plan that includes Origin ([who can access](https://cursor.com/docs/origin#who-can-access)) and a codebase name claimed at [cursor.com/codebase](https://cursor.com/codebase). The name can't be changed during the beta.
- A [Tenki account](https://app.tenki.cloud/auth/registration). Reviews are billed per review from your workspace balance ([pricing](https://tenki.cloud/pricing)).
- git and Node.js 20 or later.

## Quick start

### 1. Get the example

```bash
git clone https://github.com/LuxorLabs/cookbook.git
cd cookbook/examples/cursor-origin-tenki
```

### 2. Install the Origin CLI and sign in

```bash
curl -fsSL https://downloads.cursor.com/origin/install.sh | sh   # installs to ~/.local/bin/origin
origin auth login                                                # also sets up git credentials
```

Sign in with the Cursor account that has Origin access.

### 3. Connect Tenki to your Origin namespace

Do this from either side:

- **Tenki:** in **Code Reviewer**, select **Install App** next to **Cursor Origin** (or, if GitHub is already connected, the install button in the **Cursor Origin** row under **Configuration → Connections**). On Cursor's page, choose **All repositories** or **Select repositories** and select **Install**.
- **Cursor:** in codebase settings, open **Apps**, find **Tenki** under **Code Review**, and select **Install**. On Tenki, sign in with the same email you use on Cursor, pick a workspace, and select **Connect**. The link expires after 2 hours.

One Tenki workspace connects to one Origin namespace. Tenki gets read access to code and write access to PR comments, reviews, checks, and the PR description. It never pushes code ([permissions](https://tenki.cloud/docs/reviewer/cursor-origin#permissions)).

### 4. Push the starter repo

```bash
origin repo create invoices-api

cp -r starter ~/invoices-api && cd ~/invoices-api
git init -b main
git add . && git commit -m "Invoices API"
git remote add origin https://origin.cursor.com/<your-namespace>/invoices-api.git
git push -u origin main
```

Use the namespace you connected in step 3. Create the repo on Origin rather than syncing it from GitHub: apps get read-only access to GitHub-synced repos. If you installed Tenki for **Select repositories**, add `invoices-api` under **Apps → Tenki → Repository Access → Manage**.

### 5. Open the pull request

```bash
git switch -c invoice-totals
cp <path-to-cookbook>/examples/cursor-origin-tenki/pr/app.mjs src/app.mjs
npm test                                   # 3/3 pass
git commit -am "Add invoice totals endpoint"

origin pr create -t "Add invoice totals endpoint" --push
origin pr ready
```

`origin pr create` opens a draft, and Tenki doesn't review drafts. `origin pr ready` starts the review. (`--status open` on `create` does the same.)

The new route only checks that a user is signed in:

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

### 6. Read the review

```bash
origin pr view --comments          # summary, verdict, and finding threads
origin pr thread list --unresolved # inline findings
origin pr checks --watch           # the Tenki Code Review check
```

Tenki flags the `invoice-totals` route: any signed-in user, such as `gus` from globex, can read acme's totals, which breaks the `AGENTS.md` rule. Each finding has a severity, category, explanation, and suggested fix. The check fails while any Critical, High, or Medium finding is open.

### 7. Fix it and re-review

Apply the fix in `src/app.mjs`, or ask Cursor to:

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

Pushes aren't re-reviewed unless **Review on Push** is on, so the comment asks for one. With no blocking findings left, Tenki approves, the check passes, and you can `origin pr merge`. The check only blocks merging if you require it under the repo's **Rules and Protections**.

## Review rules with `AGENTS.md`

Tenki reads `AGENTS.md` from the repo root and from parent directories of each changed file, and applies those rules on top of its default checks. `CLAUDE.md` also works; if both exist, Tenki uses `AGENTS.md` only. Nothing is configured in the dashboard ([Custom Context](https://tenki.cloud/docs/reviewer/custom-context)). The starter ships:

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

To dismiss a finding, reply in its thread with "false positive", "not an issue", "not a bug", "won't fix", "by design", "intended behavior", or "working as intended", for example `origin pr thread reply <thread-id> -b "won't fix: …"`. Tenki won't raise it again. Negations such as "this is not a false positive" don't count.

## Settings

Settings are in **Code Reviewer → Configuration**. They apply to GitHub and Origin and can be overridden per repo ([Settings](https://tenki.cloud/docs/reviewer/settings)).

| Setting | Default | Notes |
| --- | --- | --- |
| Severity Threshold | All four levels | Low findings appear only as nitpicks in the summary |
| Automatic Review | On | Off means review only on `@tenki-reviewer` |
| Review on Push | Off | Re-review after each push. Each re-review is billed. |
| Approve on Clean Review | On | Approve when only nitpicks are open |
| Comment Detail Level | Standard | **Detailed** adds a "Prompt for AI Agents" block to each finding |
| PR Walkthrough | Off | Adds a walkthrough to the PR description |
| Ignore Usernames | `dependabot[bot]`, `renovate[bot]` | On Origin, use the author's email address |

Origin reviews appear on the **Reviews** tab of Code Reviewer alongside GitHub reviews. Filter by provider to see only Origin.

## Verify the example

`verify.mjs` checks the files this example ships, without Origin or a review. It confirms `AGENTS.md` has the membership rule and that `pr/app.mjs` differs from the starter only by the new route. Then, in a Tenki sandbox, it runs the tests at each stage and requests acme's totals as `gus`: 404 on main (no route), 200 on the PR (the leak), 403 after the fix.

It needs a Tenki API key (`tk_...`) in `TENKI_AUTH_TOKEN` or `TENKI_API_KEY`, or saved with `tenki login --api-key <key>`. The reviewer itself does not use a key.

```bash
npm install
node verify.mjs
```

```
✓ cursor-origin-tenki: AGENTS.md rules + planted bug checked → in a Tenki sandbox: main tests pass, leak probe 404 → pr tests pass, leak probe 200 → fixed tests pass, leak probe 403 → dispose
```

## Troubleshooting

| Problem | Fix |
| --- | --- |
| `command not found: origin` | Add `export PATH="$HOME/.local/bin:$PATH"` to your shell profile and reload it. |
| `git push` to `origin.cursor.com` fails | Run `origin auth login` to set up git credentials. |
| Tenki never starts reviewing | The PR is a draft: run `origin pr ready`. Otherwise check that `invoices-api` is in Tenki's **Repository Access** in Cursor and that Cursor Origin shows **Connected** under **Code Reviewer → Configuration → Connections**. See [Tenki isn't reviewing Cursor Origin pull requests](https://tenki.cloud/docs/reviewer/troubleshooting#tenki-isnt-reviewing-cursor-origin-pull-requests). |
| A repo synced from GitHub isn't reviewed | Apps are read-only on synced repos. Create the repo on Origin, or use Tenki's GitHub app on the GitHub copy. |
| No review after a push or on a reopened PR | Comment `@tenki-reviewer`, or turn on **Review on Push**. |
| The check still fails after the re-review | A Critical, High, or Medium finding is still open, possibly from an earlier review. Fix or dismiss it. |
| The link from Cursor to Tenki expired | It lasts 2 hours. Start the install again. |
| "Installed by a different account" | Sign in to Tenki with your Cursor email and open the link again. |
| "This workspace already uses Cursor Origin" | Disconnect the current namespace under **Connections**, or pick another workspace. |
| ``No token. Set TENKI_AUTH_TOKEN, or run `tenki login`.`` | `verify.mjs` found no key. Export one or run `tenki login --api-key <key>`. |
| `✗ AGENTS.md is missing …` or `✗ <stage>: non-member read …` | `starter/` or `pr/` was edited. Run `git restore starter pr`. |

## Clean up

```bash
origin repo delete <your-namespace>/invoices-api
```

To stop reviews on the namespace, select **Disconnect** in the **⋯** menu next to Cursor Origin under **Code Reviewer → Configuration → Connections**, or suspend or uninstall Tenki from **Apps** in Cursor's codebase settings. Past reviews stay in Code Reviewer.

## Related

- [Tenki Code Reviewer on Cursor Origin](https://tenki.cloud/docs/reviewer/cursor-origin) and the [launch post](https://tenki.cloud/blog/tenki-code-reviewer-cursor-origin)
- Tenki docs: [Custom Context](https://tenki.cloud/docs/reviewer/custom-context), [Settings](https://tenki.cloud/docs/reviewer/settings), [Troubleshooting](https://tenki.cloud/docs/reviewer/troubleshooting)
- [Origin docs](https://cursor.com/docs/origin), [Origin CLI](https://cursor.com/docs/origin/cli), and its [pull request commands](https://cursor.com/docs/origin/cli/reference/pull-requests)
