#!/usr/bin/env bash
# Temporary preflight probe driver for issue #2847 (failed-subset re-run).
set -u
cd "$(dirname "$0")/../.." || exit 1
FILES=$(sed -n 's/^  \(scripts\/tests\/.*\)$/\1/p' project-plans/issue2847/probe-scripts-baseline.log | tr '\n' ' ')
# shellcheck disable=SC2086
bun project-plans/issue2847/probe.ts . ./scripts/tests/test-setup.ts $FILES
