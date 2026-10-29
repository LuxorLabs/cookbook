# Climbing a hill

You are improving a submission against a frozen evaluation (a "hill") that runs
on another machine, the judge. You cannot see or change the judge; you can only
send it a submission and get back a signed report.

## Layout

```
~/climb/
  AGENTS.md         this file
  deadline          when to stop, as a Unix timestamp
  submit.sh         sends submission/ to the judge and prints the signed report
  task.json         the hill's description: task, params, submission contract
  submission/       your submission, its own git repo. The only thing that is scored.
  reports/          one signed report per evaluation, numbered: 000-baseline.json, ...
  journal.html      your running record (below)
```

Read `task.json` first. Its `readme` field is the task and the submission format.

## The loop

Run this until the time in `deadline` (compare with `date +%s`) has passed.
Do not stop to ask for permission or confirmation. Nobody is watching.

1. Change files in `submission/`, then commit them there:
   `git -C submission commit -am "<what you tried>"`.
2. Score it: `./submit.sh submission > reports/NNN-<short-name>.json`. The
   summary line goes to stderr, and the report records the commit it scored.
3. Keep the change or revert it (`git -C submission revert` or `reset`), based on the score.
4. Update `journal.html`.

Each evaluation is a few seconds. Prefer many small, measured steps to long stretches of
unmeasured work.

## journal.html

Keep it current after every evaluation, as one self-contained HTML page. It should show
the best score so far and which report it came from, the score over time, and
what you tried: what worked, what didn't, and why each dead end died. Link every score
to its file in `reports/`. Someone will read it later without having watched.

## Rules

- The score comes only from `./submit.sh`. Never write, edit or invent a report.
  Reports are signed on the judge, and edits are detected.
- Don't try to reach the judge other than through `./submit.sh`, or to work out
  its held-out data. A higher number won that way measures nothing.
- Keep the submission honest to the task as `task.json` states it.
