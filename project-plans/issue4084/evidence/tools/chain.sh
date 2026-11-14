#!/bin/bash
# Runs scenario scripts one after another (never in parallel).
# Usage: tmp/verify4084/phaseE/chain.sh name1 name2 ...
# where nameN is the scenario name in scripts/tmux-script.issue4084-<name>.llxprt.json
for name in "$@"; do
  echo "$(date +%s) start $name" >> tmp/verify4084/phaseE/chain.log
  bash tmp/verify4084/phaseE/run.sh "$name" "scripts/tmux-script.issue4084-$name.llxprt.json"
  echo "$(date +%s) end $name $(tail -1 tmp/verify4084/phaseE/$name.harness.log)" >> tmp/verify4084/phaseE/chain.log
done
echo "$(date +%s) chain-done" >> tmp/verify4084/phaseE/chain.log
