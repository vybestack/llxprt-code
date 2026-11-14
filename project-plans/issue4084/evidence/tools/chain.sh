#!/bin/bash
# Runs scenario scripts one after another (never in parallel).
# Usage: project-plans/issue4084/evidence/tools/chain.sh name1 name2 ...
# where nameN is the scenario name in scripts/tmux-script.issue4084-<name>.llxprt.json
tools=$(cd "$(dirname "$0")" && pwd)
cd "$tools/../../../.." || exit 1
mkdir -p tmp/verify4084/phaseE
for name in "$@"; do
  echo "$(date +%s) start $name" >> tmp/verify4084/phaseE/chain.log
  bash "$tools/run.sh" "$name" "scripts/tmux-script.issue4084-$name.llxprt.json"
  echo "$(date +%s) end $name $(tail -1 tmp/verify4084/phaseE/$name.harness.log)" >> tmp/verify4084/phaseE/chain.log
done
echo "$(date +%s) chain-done" >> tmp/verify4084/phaseE/chain.log
