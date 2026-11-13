# How to run an unattended hills optimization loop with the evaluator out of the agent's reach

**Audience:** you want a coding agent to improve a measurable number for hours without you watching, and you want to trust the number when you come back. You know Python and have used Claude Code or OpenCode.
**Time:** about 5 minutes to set up and run the check (the check takes about 15 seconds), plus however long you let the agent climb.
**Outcome:** two Tenki sandboxes. A judge holds a frozen [hills](https://github.com/autolab-ai/hills) evaluation and the key that signs its scores. A climber runs an agent that improves a submission and can only get a score by sending its work to the judge. At the end you download a folder of signed reports, the submission's git history, and the agent's `journal.html`.

> **Honesty note:** the judge runs `hills eval` on whatever the climber sends. In the hill used here (`circle-packing`) the evaluator only reads a JSON file. A hill whose evaluator *runs* the submitted code (the `nanogpt-10min` example runs `train.py`) would run that code on the judge, next to the signing key. For those, use hills' own container environment (`spec_version: 3`, `environment.image`) or a separate judge user.

## Why bother

[hills](https://github.com/autolab-ai/hills) (from [Autolab](https://github.com/autolab-ai)) freezes an evaluation: you write `eval.py` and any held-out data in `private/`, `hills commit` locks them under a tree hash, and every score after that comes back signed with a key at `~/.autolab/hills/key`. The agent edits only its submission.

hills is open about the limit of that. Its README says the tool defends against fooling yourself, not against a determined attacker: `private/` holds "ordinary files", and the key is safe only because it sits outside the folder the agent works in. An agent with a shell on your laptop, running as you, can read both.

Here the agent runs on a different machine. The climber sandbox has no hills install, no hill, no `private/` and no key. Its only route to a score is an HTTP request to the judge, which returns a report signed on the judge. The numbers the agent reports are numbers the judge measured.

Tenki gives you both machines from one script and keeps them running while you are away. Every score comes from the same judge machine. For hills that measure on hardware, the hardware is recorded in the score's primary config, and hills won't rank scores from different machines against each other.

## Prerequisites

- Python 3.12 or later and [uv](https://docs.astral.sh/uv/).
- A Tenki API key (`tk_…`). Create one at https://app.tenki.cloud.
- For Step 5 only: a model key for the agent. `ANTHROPIC_API_KEY` or `OPENROUTER_API_KEY` works with the default OpenCode setup. `OPENAI_API_KEY` or `OPENCODE_API_KEY` works too if you pass `--model`.
- Node.js, only if you run the check through the `node verify.mjs` shim.

You don't install hills locally. It is installed on the judge.

## Step 1 — Get the example

```bash
git clone https://github.com/LuxorLabs/cookbook.git
cd cookbook/examples/hills-tenki
```

Every later command runs from this directory. It holds:

| File | Runs on | What it does |
| --- | --- | --- |
| [`climb.py`](climb.py) | your machine | `up`, `status` and `down` for the two sandboxes |
| [`judge.py`](judge.py) | judge | HTTP front for one frozen hill: `GET /describe`, `POST /eval`, `POST /verify` |
| [`submit.sh`](submit.sh) | climber | packs the submission folder, posts it to `/eval`, prints the signed report |
| [`climber.md`](climber.md) | climber | the agent's instructions, installed as `AGENTS.md` (and `CLAUDE.md`) |
| [`verify.py`](verify.py) | your machine | the no-model check in Step 4 |

## Step 2 — Install

```bash
uv venv --python 3.12
uv pip install -r requirements.txt
```

That installs the Tenki Python SDK (`tenki>=1.4.1`). Nothing else runs locally.

## Step 3 — Authenticate

```bash
export TENKI_API_KEY=tk_...
```

Or run `tenki login --api-key <key>` once. The scripts read the key from `~/.config/tenki/config.yaml` when the variable isn't set.

## Step 4 — Check the judge and the wall between the machines

```bash
.venv/bin/python verify.py
```

```
  judge: circle-packing @ 3d7315c5d8f6 on https://….us.sb.tenki.sh
  climber: submit.sh → PASSED sum_radii=2.5414  (master@3da6f1b)
✓ hills-tenki: judge freezes circle-packing → climber has no key → no token: 401 → submit.sh: PASSED sum_radii=2.5414 signed @ 3d7315c5d8f6 → signature valid → edited score: invalid
```

This creates both sandboxes and runs the whole path without a model. The judge installs `hills==0.12.1`, creates the `circle-packing` hill (pack 26 circles in the unit square, maximize the sum of the radii), freezes it, and serves `judge.py` on a preview URL. The climber gets the hill's example packing as its submission. The check then confirms that:

- the climber has no hills install, state or key;
- `/eval` without the bearer token answers 401;
- `submit.sh` scores the example at 2.5414, signed for the frozen tree hash and tied to the submission's git commit;
- the signing key exists on the judge only;
- the judge accepts the report's signature, and rejects it once the score is edited.

Both sandboxes are terminated at the end, pass or fail. The check needs no model key, so it doesn't exercise an agent turn. Step 5 does.

## Step 5 — Start a climb

```bash
export OPENROUTER_API_KEY=...   # or ANTHROPIC_API_KEY
.venv/bin/python climb.py up --hours 1
```

```
judge    01a1…  circle-packing @ 3d7315c5d8f6  https://….us.sb.tenki.sh
climber  01a1…  opencode (openrouter/anthropic/claude-sonnet-5.5) for 1.0h

It runs without you. Check in with `python climb.py status`; finish with `python climb.py down`.
```

`up` sets up the judge the same way as Step 4, then the climber:

```
~/judge.env       JUDGE_URL and JUDGE_TOKEN, read by submit.sh (outside the agent's folder)
~/agent.env       your model key
~/climb/
  AGENTS.md       climber.md (CLAUDE.md links to it)
  deadline        now + --hours, as a Unix timestamp
  submit.sh
  task.json       the judge's GET /describe: the task, params and submission format
  submission/     the hill's example packing, committed as "baseline"; its own git repo
  reports/        000-baseline.json, scored before the agent starts
```

Then it starts the agent in a loop and returns. Each turn runs `opencode run` (or `claude -p`). When the agent stops before the deadline, the loop sends "Keep climbing" with `--continue`:

```bash
cd ~/climb
opencode run -m openrouter/anthropic/claude-sonnet-5.5 "Read AGENTS.md and start climbing."
while [ "$(date +%s)" -lt "$(cat deadline)" ]; do
  opencode run -m openrouter/anthropic/claude-sonnet-5.5 --continue "The deadline in ./deadline has not passed. Keep climbing."
  sleep 5  # don't spin if the agent exits straight away, e.g. on a model error
done
```

The agent follows `AGENTS.md`: edit `submission/`, commit, `./submit.sh submission > reports/NNN-name.json`, keep or revert, update `journal.html`, repeat.

Options:

- `--agent claude` runs Claude Code (`claude -p --dangerously-skip-permissions`) instead of OpenCode. It needs `ANTHROPIC_API_KEY`.
- `--model` picks the model. With OpenCode, the default is `anthropic/claude-sonnet-5-5` when `ANTHROPIC_API_KEY` is set, else `openrouter/anthropic/claude-sonnet-5.5` when `OPENROUTER_API_KEY` is set. With any other key, `--model` is required: OpenCode's own default can be a model without tool use.
- `--hours` sets the deadline. Each sandbox's lifetime cap is that plus 30 minutes. At the cap a sandbox pauses rather than ending, and it is deleted a day later if you never run `down`.

## Step 6 — Check in

```bash
.venv/bin/python climb.py status
```

This prints the last lines of the agent's log, every report with its score, and the time left. It doesn't interrupt the agent.

## Step 7 — Collect the results and clean up

```bash
.venv/bin/python climb.py down
```

`down` downloads the climber's `~/climb` folder, the agent's log included, to `runs/<timestamp>/`, then terminates both sandboxes.

In a 20-minute test run, OpenCode with Claude Sonnet 5.5 (through OpenRouter) wrote a multistart SLSQP optimizer and moved the score from 2.5414 to 2.6343. The best known packing is about 2.6358. It then spent the rest of the time on random restarts and basin hopping that found nothing better, and its journal records each of those dead ends. Open `runs/<timestamp>/journal.html` for the agent's account of the run. Each row should link to the signed report behind it in `reports/`, and `submission/` holds the git history of every attempt.

A report verifies only on the machine that signed it, which was the judge, and `down` terminates the judge. So check any report you doubt before running `down`. The judge's `/verify` endpoint runs `hills verify` for you:

```bash
tenki sandbox exec --session hills-tenki-climber -c \
  '. ~/judge.env && curl -sS -H "Authorization: Bearer $JUDGE_TOKEN" --data-binary @climb/reports/000-baseline.json "$JUDGE_URL/verify"'
```

## Use your own hill

`climb.py` freezes the `circle-packing` template that ships with hills. To judge your own task, build the hill with hills first (`hills new <name>`, write `eval.py`, put held-out data in `private/`, `hills commit`). Then change `start_judge` to put that hill on the judge (a `hills bundle <name>` file uploaded and unpacked with `hills unbundle` keeps the same tree hash) and set `HILL`. Keep `private/` off the climber. That separation is the point of the setup.

## Troubleshooting

**❌ `No model key. Set one of ANTHROPIC_API_KEY, OPENAI_API_KEY, OPENCODE_API_KEY, OPENROUTER_API_KEY.`** `up` found none of these in your environment. Export one, then run `up` again.

**❌ The log shows `No endpoints found that support tool use`.** OpenCode picked a model without tool use. Pass `--model` with a model that has tool use.

**❌ The log shows `permission requested: external_directory (…); auto-rejecting`.** In `opencode run`, OpenCode rejects tool calls that touch paths outside the folder it was started in. Everything the agent needs is in `~/climb` for this reason. If you add files for the agent, put them there too.

**❌ `submit.sh` prints `401`.** The request reached the judge without the right token. `~/judge.env` on the climber holds the token `up` generated. A new `up` makes new sandboxes and a new token.

## FAQ

**Can the agent still cheat?** It can't edit the evaluator, read `private/`, or sign a report, because none of those are on its machine. It holds the judge's bearer token, which only lets it submit work for scoring. It can still overfit to whatever `eval.py` measures. Choosing a metric that matches what you want is still your job, and the hills README spends a section on it.

**Why the bearer token, when the preview URL is already hard to guess?** A Tenki preview URL is public to anyone who has it. `judge.py` checks its own token on every `POST`, with a constant-time comparison. `GET /describe` is open because it returns only the task description.

**Why one evaluation at a time?** `judge.py` uses a single-threaded server, so evaluations queue. Every score is then measured with the judge's CPU to itself, which keeps timed hills comparable.

**When shouldn't I use this?**
- When your hill needs a GPU. Tenki sandboxes are CPU only, so `nanogpt-10min` and other GPU hills are out.
- When your hill runs the submitted code and you haven't isolated it from the key (see the honesty note).
- When you want hills' whole guided flow, where your own agent agrees a plan with you and you run `hills commit` yourself. Use the hills skill on your machine for that (`npx skills add autolab-ai/hills`). This example starts after that step, with a hill that is already frozen.

## Related

- [hills](https://github.com/autolab-ai/hills): the README, [SPEC](https://github.com/autolab-ai/hills/blob/main/docs/SPEC.md) and agent skill.
- [Tenki Sandbox docs](https://tenki.cloud/docs/sandbox)
- [Harbor](../harbor-tenki/): agent evals and benchmarks with one Tenki sandbox per trial.
- [OpenCode](../opencode-sandbox/): OpenCode as a headless server in a sandbox.
