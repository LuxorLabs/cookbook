# The Tenki to Luxor rename

Tenki is now **Luxor Agent Cloud**, at [luxor.ai](https://luxor.ai). The cookbook was renamed in one pass by `rebrand.mjs`. The rename covered:

- Prose, log lines and page titles.
- Every `tenki.cloud` link, including `app.` and `api.`.
- The `@tenkicloud/*` packages, which became `@luxorai/*` at the same versions.
- `TenkiSandbox`, which became `LuxorSandbox`.
- The `tenki` CLI, which became `luxor`, and its config file, now `~/.config/luxor/config.yaml`.
- Runner labels: `tenki-standard-*` became `luxor-ubuntu-*` and `tenki-macos-*` became `luxor-macos-*`, as on [luxor.ai/docs/runners](https://luxor.ai/docs/runners/sizes). The old labels keep working.
- The example folders: `examples/<name>-tenki` became `examples/<name>-luxor`.
- The helper files and names the examples define themselves.

## What still says tenki, and why

`rebrand.rules.mjs` lists each kept name as a protect pattern with its reason:

| Kept | Why |
| --- | --- |
| `TENKI_API_KEY`, `TENKI_AUTH_TOKEN`, `TENKI_WORKSPACE_ID` | The SDKs read `LUXORAI_*` first and these as a fallback. SDK-only examples read and document `LUXORAI_*` (`env-luxorai.mjs`); plugin examples keep `TENKI_*`, which those plugins read themselves |
| `~/.config/tenki/config.yaml` | Read as a fallback after `~/.config/luxor/config.yaml`, for keys saved by the old `tenki login` |
| The `tenki` Python package and `tenki_sandbox` module, `tenki-sdk-go`, the `LuxorLabs/tenki-*` repos | Not renamed upstream yet |
| `tenki_*` MCP tool names, the OpenClaw and AgentBox plugin id `tenki`, the Convex component's `Tenki` class | What the `@luxorai` packages still call them |
| `/home/tenki`, `*.sb.tenki.sh`, `tenki/anchor` and `tenki/tinyfish` images | Platform names |
| `ag2.extensions.tenki`, `@computesdk/tenki`, PraisonAI's `compute.tenki`, `prefect-tenki`, `nemo-gym-tenki`, other providers named `tenki` | Other projects' identifiers |
| `Copyright (c) 2026 Tenki Cloud` in `LICENSE` | Legal entity; change with counsel |

When one of these is renamed upstream, move its pattern from `protect` to `rules` with the new name, then run the codemod again.

## The codemod

Each rule has a scope:

- **`text`** is Markdown prose, including untagged or `text` code fences, which is where the coding-agent prompts live.
- **`comment`** is comments.
- **`string`** is string literals, including Python docstrings.
- **`code`** is identifiers and inline code.
- **`any`** is everywhere.

A small tokenizer tells these apart, so a prose rule never touches an identifier.

```bash
node scripts/rebrand.mjs --check                # CI: fail on any "tenki" no rule or protect pattern covers
node scripts/rebrand.mjs --report               # counts by rule and protect pattern
node scripts/rebrand.mjs --dry-run              # print every line the rules would change
node scripts/rebrand.mjs --write                # apply them; running it twice changes nothing
node --test scripts/rebrand.test.mjs            # the codemod's own tests
```

An open pull request written before the rename can catch up after rebasing:

1. Move its folder with `git mv examples/x-tenki examples/x-luxor`.
2. Run `node scripts/rebrand.mjs --write`.
3. Review the diff and run its `verify.mjs`.

When `--check` fails on a new mention, decide what it is. If the cookbook should say luxor, add a rule. If something outside the cookbook still owns the name, add a protect pattern that says who.

## Checks

- **`.github/workflows/brand.yml`** runs the tests and `--check` on every push and pull request.
- **`.github/workflows/links.yml`** runs [lychee](https://github.com/lycheeverse/lychee) over all Markdown, with the settings in `lychee.toml`, on pull requests that touch Markdown and weekly.
