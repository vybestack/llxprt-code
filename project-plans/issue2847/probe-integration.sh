#!/usr/bin/env bash
# Temporary preflight probe driver for issue #2847 (integration-tests load check).
#
# These tests need real provider credentials, so they cannot pass locally. What
# this checks is that each file LOADS and COLLECTS under Bun — i.e. the failure
# is the same provider-config error Vitest reports, not a Bun incompatibility.
set -u
cd "$(dirname "$0")/../../integration-tests" || exit 1
for file in *.test.ts; do
  output=$(bun test --preload ../test-setup/augment-bun-vi.ts \
    --preload ./setup-quota-guard.ts --timeout 20000 "$file" 2>&1)
  if printf '%s' "$output" | grep -q "Unhandled error between tests"; then
    echo "LOAD-FAIL $file"
    printf '%s\n' "$output" | grep -A6 "Unhandled error between tests" | head -10
  else
    ran=$(printf '%s' "$output" | grep -cE '^\((pass|fail|skip)\)')
    echo "LOADED $file ($ran tests collected)"
  fi
done
