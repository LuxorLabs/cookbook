#!/usr/bin/env bash
# Install one example's dependencies and run its verify.mjs. Used by the CI matrix.
#
#   .verify-skip       present → the example is skipped; its first line is the reason
#   .verify-requires   one env var per line; any unset → skipped, not failed
set -u
d="${1:?example dir}"
summary="${GITHUB_STEP_SUMMARY:-/dev/null}"

if [ -f "${d}.verify-skip" ]; then
  reason="$(head -n 1 "${d}.verify-skip")"
  echo "::notice title=${d} skipped::${reason}"
  echo "| ${d} | skipped | ${reason} |" >> "$summary"
  exit 0
fi
if [ -f "${d}.verify-requires" ]; then
  while IFS= read -r var || [ -n "$var" ]; do
    [ -z "$var" ] && continue
    if [ -z "${!var:-}" ]; then
      echo "::notice title=${d} skipped::${var} is not set"
      echo "| ${d} | skipped | \`${var}\` is not set |" >> "$summary"
      exit 0
    fi
  done < "${d}.verify-requires"
fi

cd "$d"
if [ -f package.json ]; then npm install --no-audit --no-fund || { echo "| ${d} | failed | npm install |" >> "$summary"; exit 1; }; fi
if [ -f requirements.txt ]; then python -m pip install -q -r requirements.txt || { echo "| ${d} | failed | pip install |" >> "$summary"; exit 1; }; fi
if node verify.mjs; then
  echo "| ${d} | ✓ | |" >> "$summary"
else
  echo "| ${d} | ✗ | see job log |" >> "$summary"
  exit 1
fi
