#!/usr/bin/env bash
# Fetch the Hermes fork that carries the Tenki terminal backend, at a pinned commit.
#
# The backend (tools/environments/tenki.py) isn't in a Hermes release yet, so this
# example runs it from opencolin/hermes-tenki. REF is the tenki-sdk-1.x branch's
# commit that moved the backend to the `tenki` 1.x SDK (opencolin/hermes-tenki#6).
set -euo pipefail

REPO="${HERMES_FORK:-https://github.com/opencolin/hermes-tenki}"
REF="${HERMES_REF:-2890bd33bee044a7b219b825cca8e656f5f3493c}"
DEST="$(cd "$(dirname "$0")" && pwd)/hermes-agent"

if [ -f "$DEST/tools/environments/tenki.py" ]; then
  echo "Using the existing checkout at $DEST"
  exit 0
fi

git init -q "$DEST"
git -C "$DEST" fetch -q --depth 1 "$REPO" "$REF"
git -C "$DEST" checkout -q FETCH_HEAD
echo "Hermes checkout at $DEST ($REF)"
