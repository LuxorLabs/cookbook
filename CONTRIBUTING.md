# Contributing to the Tenki Cookbook

This is the examples/cookbook layer for Tenki, and this is your playbook. New here? Read this top to bottom once, then you're set.

## Setup (5 minutes)

1. **Get a Tenki account + key.** Install the CLI and run `tenki login` — it writes your token and default workspace to `~/.config/tenki/config.yaml`. The examples read from there automatically.
2. **Node 20+.**
3. **Run an example to confirm your setup works:**
   ```bash
   cd examples/run-code-in-a-sandbox
   npm install
   node verify.mjs        # ✓ create → exec python3 → 42 → dispose
   ```
   If that prints a ✓, you're ready.

## The one rule (non-negotiable)

**Every example runs on Tenki and proves it in CI.** A public example that doesn't work damages the brand more than a missing one helps.

- Each example ships a **`verify.mjs`** that exercises it against the live Tenki API and **exits non-zero on any failure**.
- CI (`.github/workflows/verify.yml`) runs every `verify.mjs` with a `TENKI_API_KEY` secret. A red build blocks the merge.
- `verify.mjs` proves the *Tenki-facing* part. If an example needs an LLM (an agent turn), verify the tool/backend against Tenki directly — don't require a model key in CI. (See `langchain-code-interpreter` for the pattern.)

## What to build

Any small, runnable example that shows one clear Tenki integration or workflow is welcome. Pick the shipped example closest to your idea and copy the pattern from it.

## Anatomy of an example

```
examples/<name>/
  README.md        # the tutorial — what it does, the whole integration, how to run
  package.json     # deps ("type": "module")
  verify.mjs       # CI-runnable proof it works against Tenki
  <code>           # the example itself (a script, agent/, tool + agent, …)
```

`verify.mjs` reads the token from `TENKI_AUTH_TOKEN` / `TENKI_API_KEY` (CI) or `~/.config/tenki/config.yaml` (local), drives the Tenki-facing code, asserts the result, and cleans up any sandbox it created. Keep it under ~60 lines. Copy one from a shipped example.

**Which template to copy:**
- Direct SDK use → **`run-code-in-a-sandbox`**
- A framework agent + a code-execution tool → **`langchain-code-interpreter`**
- A pluggable sandbox backend for a framework → **`vercel-ai-sdk`**

## Adding an example — step by step

1. `cp -r` the closest template to `examples/<your-name>/`.
2. Swap in your code; keep it to one clear thing.
3. Write `verify.mjs` — assert the Tenki-facing result, clean up.
4. Run it: `node verify.mjs` → must print ✓.
5. Write the `README.md` (the tutorial) — link back to `tenki.cloud`, name the products used.
6. Add a row to the repo `README.md` examples table.
7. Open the PR. CI runs your `verify.mjs`.
8. Write the companion article (the example is the code; the article is the walkthrough).

## Style

- **Short and runnable beats comprehensive.** One clear thing per example.
- Name the Tenki products used; link back to `tenki.cloud`.
- Tenki confines file I/O to `/home/tenki` — use relative paths.
- Note any gotchas inline (e.g. `exec(cmd, { args })` doesn't shell-split; `allowOutbound: true` is needed for network).

## Review flow

Draft → content review (+ an engineer spot-checks technical accuracy) → publish. Then pick the next example and ship it.
