#!/bin/bash
# Usage: tmp/verify4084/phaseE/run.sh <run-name> <scenario-script>
# Runs one tmux scenario detached-friendly and records start/end epoch seconds.
set -u
name=$1
script=$2
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
