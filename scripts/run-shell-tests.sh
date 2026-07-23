#!/bin/sh
# run-shell-tests.sh - Runs all behavioral shell-script tests (*.test.sh).
#
# Each .test.sh file is a self-contained POSIX-portable test that exits 0
# on success and non-zero on failure. This runner discovers them and
# invokes each, aggregating the result.
#
# Run: npm run test:shell

set -u

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SHELL_SCRIPTS_DIR="${SCRIPT_DIR}/../shell-scripts"

failures=0
ran=0

for test_script in "${SHELL_SCRIPTS_DIR}"/*.test.sh; do
    [ -f "${test_script}" ] || continue
    ran=$((ran + 1))
    name="$(basename "${test_script}")"
    echo "--- Running ${name} ---"
    if sh "${test_script}"; then
        echo "PASS: ${name}"
    else
        echo "FAIL: ${name}"
        failures=$((failures + 1))
    fi
done

echo ""
if [ "${ran}" -eq 0 ]; then
    echo "No shell test scripts found (*.test.sh)"
    exit 1
fi
if [ "${failures}" -gt 0 ]; then
    echo "${failures} shell test(s) FAILED (out of ${ran})"
    exit 1
fi
echo "All ${ran} shell test(s) PASSED"
exit 0
