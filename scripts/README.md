# Renaming Tenki to Luxor Agent Cloud

The company and product are being renamed from Tenki (tenki.cloud) to Luxor Agent Cloud (luxor.ai). The cookbook moves in phases, because many of its mentions name packages, environment variables, domains and other projects that change on their own schedules.

| Phase | What changes | Waits for |
| --- | --- | --- |
| 0 | This codemod and its CI checks. No visible change. | nothing |
| 1 | Prose, log lines, and every `tenki.cloud` page link. | the house style; `luxor.ai` already redirects keeping the path |
| 2a | `app.tenki.cloud` and `api.tenki.cloud` links | `app.luxor.ai` serving |
| 2b | `@tenkicloud/*` packages, the `tenki` Python and Go SDKs, `TenkiSandbox`, `TENKI_*` variables, the `tenki` CLI and its config path, container images, our plugin repos | each release under its new name, still accepting the old one |
| 2c | Example folders (`ag2-tenki` becomes `ag2`) and helper names inside examples | phase 2b |
| 3 | Other projects' identifiers, such as `ag2.extensions.tenki` | each upstream adding a `luxor` alias |

## The codemod

`rebrand.rules.mjs` lists every kind of mention:

- **Rules** say what a mention becomes in which phase. A rule with `replace: null` names something whose new name is not decided yet. It classifies the mention, but nothing rewrites it.
- **Protect patterns** name what must stay "tenki" until something outside the cookbook changes. Examples are the sandbox user `/home/tenki`, the preview domain `*.sb.tenki.sh`, and other projects' provider names.

Each rule has a scope:

- **`text`** is Markdown prose. That includes untagged or `text` code fences, which is where the coding-agent prompts live.
- **`comment`** is comments, including Python docstrings.
- **`any`** is everywhere.

`rebrand.mjs` applies the rules. Run it from the repo root:

```bash
node scripts/rebrand.mjs --check                # CI: fail on any mention no rule or protect pattern covers
node scripts/rebrand.mjs --report               # counts by phase, rule and protect pattern
node scripts/rebrand.mjs --dry-run --phase 1    # print every line phase 1 would change
node scripts/rebrand.mjs --write --phase 1      # apply the decided rules up to phase 1
node scripts/rebrand.mjs --write --phase 1 examples/vercel-ai-sdk   # limit to some paths
node --test scripts/rebrand.test.mjs            # the codemod's own tests
```

When `--check` fails on a new mention, decide what it is:

- If the cookbook will rename it, add a rule, with `replace: null` until the name is decided.
- If something else owns it, add a protect pattern that says who.

An open pull request that predates a phase can catch up after rebasing. Run `--write --phase <n>` on its branch, then review the diff and run its `verify.mjs`.

## Checks

- **`.github/workflows/brand.yml`** runs the codemod's tests and `--check` on every push and pull request. It writes the `--report` counts to the job summary.
- **`.github/workflows/links.yml`** runs [lychee](https://github.com/lycheeverse/lychee) over all Markdown, with the settings in `lychee.toml`. It runs on pull requests that touch Markdown and weekly. Use it to confirm that a URL change lands on a live page.
