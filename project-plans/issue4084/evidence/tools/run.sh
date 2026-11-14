#!/bin/bash
# Usage: project-plans/issue4084/evidence/tools/run.sh <run-name> <scenario-script>
# Runs one tmux scenario detached-friendly and records start/end epoch seconds.
# Works from any directory; paths are relative to the repository root.
set -u
name=$1
script=$2
cd "$(dirname "$0")/../../../.." || exit 1
base=tmp/verify4084/phaseE
out=$base/runs/$name
rm -rf "$out"
mkdir -p "$out"
git rev-parse HEAD > "$out/commit.txt"
date +%s > "$out/start-epoch.txt"
bun scripts/tmux-harness.ts --script "$script" --out-dir "$out" > "$base/$name.harness.log" 2>&1
code=$?
date +%s > "$out/end-epoch.txt"
echo "harness-exit $code" >> "$base/$name.harness.log"
