#!/usr/bin/env bash
# Score a submission folder on the judge. Prints the signed report (JSON) on
# stdout and a one-line summary on stderr, so `./submit.sh > reports/004-x.json`
# keeps the report and still shows you the number.
# Usage: ./submit.sh [folder]   (default: ./submission). Reads ~/judge.env.
set -euo pipefail
source ~/judge.env  # JUDGE_URL, JUDGE_TOKEN
dir=${1:-submission}

# The whole folder goes, .git included, so the report records which commit was scored.
report=$(tar -czf - -C "$dir" . | curl -sS --fail-with-body --max-time 3700 \
  -H "Authorization: Bearer $JUDGE_TOKEN" --data-binary @- "$JUDGE_URL/eval")
echo "$report"
python3 - "$report" >&2 <<'EOF'
import json, sys
r = json.loads(sys.argv[1])
metrics = " ".join(f"{m['name']}={m['value']}" for m in r.get("metrics") or [])
print(f"{'PASSED' if r.get('passed') else 'FAILED'} {metrics}  ({r.get('submission_git') or 'not a git checkout'})")
EOF
