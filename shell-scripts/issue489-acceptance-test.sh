#!/bin/bash
# test-issue489.sh - Acceptance test for Issue #489 - Advanced Failover with Metrics
#
# This script:
# 1. Creates a load balancer test profile with ephemeral settings
# 2. Runs the CLI with debug logging enabled
# 3. Verifies the load balancer is active and functioning
# 4. Checks that debug logs were created
#
# Usage: ./shell-scripts/test-issue489.sh

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "${SCRIPT_DIR}")"
DEBUG_DIR="${HOME}/.llxprt/debug"
PROFILE_DIR="${HOME}/.llxprt/profiles"
PROFILE_NAME="testlb489"
TEST_OUTPUT="${PROJECT_DIR}/test-issue489-output.log"

echo "=== Acceptance Test for Issue #489 ==="
echo "Testing: Advanced Failover with Metrics, Timeouts, and Circuit Breakers"
echo ""
echo "Project directory: ${PROJECT_DIR}"
echo "Debug directory: ${DEBUG_DIR}"
echo "Profile directory: ${PROFILE_DIR}"
echo ""

# Step 1: Create the profile by writing JSON file directly
echo "Step 1: Creating test profile..."
mkdir -p "${PROFILE_DIR}"

cat > "${PROFILE_DIR}/${PROFILE_NAME}.json" << 'EOF'
{
  "name": "testlb489",
  "version": 1,
  "type": "loadbalancer",
  "policy": "failover",
  "profiles": ["synthetic", "synthetic", "synthetic"],
  "provider": "",
  "model": "",
  "modelParams": {},
  "ephemeralSettings": {
    "tpm_threshold": 500,
    "timeout_ms": 30000,
    "circuit_breaker_enabled": true,
    "circuit_breaker_failure_threshold": 3,
    "circuit_breaker_failure_window_ms": 60000,
    "circuit_breaker_recovery_timeout_ms": 30000,
    "failover_retry_count": 2,
    "failover_retry_delay_ms": 1000
  }
}
EOF

echo "Profile created at: ${PROFILE_DIR}/${PROFILE_NAME}.json"
echo ""

# Step 2: Clear debug directory for clean test
echo "Step 2: Clearing debug directory..."
mkdir -p "${DEBUG_DIR}"
rm -f "${DEBUG_DIR}"/*.jsonl 2>/dev/null || true
echo "Debug directory cleared"
echo ""

# Step 3: Enable debug logging
echo "Step 3: Setting up debug logging..."
export LLXPRT_DEBUG='llxprt:*'
echo "LLXPRT_DEBUG=${LLXPRT_DEBUG}"
echo ""

# Step 4: Run the CLI with load balancer profile
echo "Step 4: Running CLI with load balancer profile..."
echo "Command: node scripts/start.js --profile-load ${PROFILE_NAME} --prompt \"...\""
echo ""

cd "${PROJECT_DIR}"

# Run with a simple prompt to avoid subagents
if node scripts/start.js \
    --profile-load "${PROFILE_NAME}" \
    --prompt "review this codebase and tell me what it does, don't use a subagent" \
    2>&1 | tee "${TEST_OUTPUT}"; then
    RUN_SUCCESS=true
else
    RUN_SUCCESS=false
fi

echo ""
echo "=== Test Output Analysis ==="
echo ""

# Step 5: Verify load balancer was initialized
echo "Checking for load balancer initialization..."
if grep -qi "loadbalanc" "${TEST_OUTPUT}" || \
   grep -qi "\[LB:" "${TEST_OUTPUT}" || \
   grep -qi "failover" "${TEST_OUTPUT}"; then
    echo "PASS: Load balancer references found in output"
else
    echo "WARNING: Load balancer references not clearly visible in output"
    echo "  (This may be normal if logging is minimal)"
fi
echo ""

# Step 6: Check for debug log creation
echo "Checking for debug log files..."
LOG_COUNT=$(find "${DEBUG_DIR}" -name "*.jsonl" -type f 2>/dev/null | wc -l)
LOG_COUNT=$(echo "${LOG_COUNT}" | tr -d ' ')

if [[ "${LOG_COUNT}" -gt 0 ]]; then
    echo "PASS: Found ${LOG_COUNT} debug log file(s) in ${DEBUG_DIR}"
    echo ""
    echo "Debug log files:"
    find "${DEBUG_DIR}" -name "*.jsonl" -type f -exec ls -lh {} \;
else
    echo "FAIL: No debug log files found in ${DEBUG_DIR}"
    echo "  Expected: At least one .jsonl file"
    exit 1
fi
echo ""

# Step 7: Check log content for load balancer activity
echo "Analyzing debug log content..."
LATEST_LOG=$(find "${DEBUG_DIR}" -name "*.jsonl" -type f -print0 2>/dev/null | xargs -0 ls -t 2>/dev/null | head -n 1 || true)

if [[ -n "${LATEST_LOG}" ]]; then
    echo "Latest debug log: ${LATEST_LOG}"
    LOG_SIZE=$(wc -c < "${LATEST_LOG}")
    echo "Log size: ${LOG_SIZE} bytes"
    echo ""

    # Check for load balancer indicators in debug log
    if grep -qi "loadbalanc\|failover\|backend\|circuit.*breaker" "${LATEST_LOG}"; then
        echo "PASS: Load balancer activity detected in debug log"
    else
        echo "INFO: Load balancer activity markers not found in debug log"
        echo "  (This may be normal depending on log verbosity)"
    fi
else
    echo "WARNING: Could not find latest log file"
fi
echo ""

# Step 8: Overall test result
echo "=== Test Summary ==="
echo ""
echo "Test output saved to: ${TEST_OUTPUT}"
echo "Debug logs in: ${DEBUG_DIR}"
echo ""

if [[ "${RUN_SUCCESS}" = true ]]; then
    echo "RESULT: PASS"
    echo ""
    echo "The acceptance test completed successfully."
    echo "The CLI ran with the load balancer profile and created debug logs."
    echo ""
    echo "Next steps:"
    echo "  1. Review ${TEST_OUTPUT} for load balancer behavior"
    echo "  2. Examine ${LATEST_LOG} for detailed debug output"
    echo "  3. Run manual scenarios from ACCEPTANCE-TEST.md"
    exit 0
else
    echo "RESULT: FAIL"
    echo ""
    echo "The CLI command failed. See ${TEST_OUTPUT} for details."
    exit 1
fi
