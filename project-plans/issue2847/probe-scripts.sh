#!/usr/bin/env bash
# Temporary preflight probe driver for issue #2847.
set -u
cd "$(dirname "$0")/../.." || exit 1
FILES=$(find scripts/tests -name '*.test.ts' -o -name '*.test.js' | grep -v '\.bun\.test\.' | sort | tr '\n' ' ')
# shellcheck disable=SC2086
bun project-plans/issue2847/probe.ts . ./scripts/tests/test-setup.ts $FILES
