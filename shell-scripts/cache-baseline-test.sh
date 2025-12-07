#!/bin/bash
# cache-baseline-test.sh - Test Anthropic prompt caching performance with subagents
#
# This script:
# 1. Clears the debug log directory
# 2. Runs a multi-subagent task to generate cache metrics
# 3. Analyzes the logs to calculate cache hit rate
#
# Usage: ./cache-baseline-test.sh [profile]
# Default profile: sonnetthinking

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "${SCRIPT_DIR}")"
DEBUG_DIR="${HOME}/.llxprt/debug"
PROFILE="${1:-sonnetthinking}"
LOG_FILE="/tmp/cache_baseline_$(date +%Y%m%d_%H%M%S).log"

echo "=== Anthropic Prompt Cache Baseline Test ==="
echo "Profile: ${PROFILE}"
echo "Debug dir: ${DEBUG_DIR}"
echo "Log file: ${LOG_FILE}"
echo ""

# Step 1: Clear debug directory
echo "Step 1: Clearing debug directory..."
rm -rf "${DEBUG_DIR:?}"/*
mkdir -p "${DEBUG_DIR}"
echo "  Done."
echo ""

# Step 2: Run multi-subagent task
echo "Step 2: Running multi-subagent cache test..."
echo "  This will spawn multiple subagents to test cache sharing..."
echo ""

cd "${PROJECT_DIR}"
LLXPRT_DEBUG='llxprt:*' node scripts/start.js \
    --profile-load "${PROFILE}" \
    "use the codereviewer subagent to analyze this project, then use a different task invocation of codereviewer to analyze each identified component" \
    2>&1 | tee "${LOG_FILE}" || true

echo ""
echo "Step 3: Analyzing cache metrics from debug logs..."
echo ""

# Step 3: Analyze cache metrics
# Look for cache_read_input_tokens and cache_creation_input_tokens in logs
echo "=== Cache Metrics Summary ==="

# Extract cache metrics from all debug logs
CACHE_READ_TOTAL=0
CACHE_CREATION_TOTAL=0
INPUT_TOKENS_TOTAL=0

# Check debug logs
if [[ -d "${DEBUG_DIR}" ]]; then
    for logfile in "${DEBUG_DIR}"/*.log; do
        if [[ -f "${logfile}" ]]; then
            # Extract cache_read_input_tokens (portable sed/awk instead of grep -P)
            read_tokens=$(sed -n 's/.*cache_read_input_tokens[": ]*\([0-9][0-9]*\).*/\1/p' "${logfile}" 2>/dev/null | awk '{sum+=$1} END {print sum+0}') || true
            if [[ -n "${read_tokens}" ]] && [[ "${read_tokens}" -gt 0 ]]; then
                CACHE_READ_TOTAL=$((CACHE_READ_TOTAL + read_tokens))
            fi

            # Extract cache_creation_input_tokens (portable sed/awk instead of grep -P)
            creation_tokens=$(sed -n 's/.*cache_creation_input_tokens[": ]*\([0-9][0-9]*\).*/\1/p' "${logfile}" 2>/dev/null | awk '{sum+=$1} END {print sum+0}') || true
            if [[ -n "${creation_tokens}" ]] && [[ "${creation_tokens}" -gt 0 ]]; then
                CACHE_CREATION_TOTAL=$((CACHE_CREATION_TOTAL + creation_tokens))
            fi

            # Extract input_tokens (for reference - portable sed/awk)
            input_tokens=$(sed -n 's/.*"input_tokens"[": ]*\([0-9][0-9]*\).*/\1/p' "${logfile}" 2>/dev/null | awk '{sum+=$1} END {print sum+0}') || true
            if [[ -n "${input_tokens}" ]] && [[ "${input_tokens}" -gt 0 ]]; then
                INPUT_TOKENS_TOTAL=$((INPUT_TOKENS_TOTAL + input_tokens))
            fi
        fi
    done
fi

# Also check the main log file
if [[ -f "${LOG_FILE}" ]]; then
    # Portable sed/awk instead of grep -P (macOS compatible)
    read_tokens=$(sed -n 's/.*cache_read_input_tokens[": ]*\([0-9][0-9]*\).*/\1/p' "${LOG_FILE}" 2>/dev/null | awk '{sum+=$1} END {print sum+0}') || true
    if [[ -n "${read_tokens}" ]] && [[ "${read_tokens}" -gt 0 ]]; then
        CACHE_READ_TOTAL=$((CACHE_READ_TOTAL + read_tokens))
    fi

    creation_tokens=$(sed -n 's/.*cache_creation_input_tokens[": ]*\([0-9][0-9]*\).*/\1/p' "${LOG_FILE}" 2>/dev/null | awk '{sum+=$1} END {print sum+0}') || true
    if [[ -n "${creation_tokens}" ]] && [[ "${creation_tokens}" -gt 0 ]]; then
        CACHE_CREATION_TOTAL=$((CACHE_CREATION_TOTAL + creation_tokens))
    fi

    # Extract input_tokens from main log file (portable sed/awk)
    input_tokens=$(sed -n 's/.*"input_tokens"[": ]*\([0-9][0-9]*\).*/\1/p' "${LOG_FILE}" 2>/dev/null | awk '{sum+=$1} END {print sum+0}') || true
    if [[ -n "${input_tokens}" ]] && [[ "${input_tokens}" -gt 0 ]]; then
        INPUT_TOKENS_TOTAL=$((INPUT_TOKENS_TOTAL + input_tokens))
    fi
fi

echo "Cache Read Tokens (hits):     ${CACHE_READ_TOTAL}"
echo "Cache Creation Tokens (new):  ${CACHE_CREATION_TOTAL}"
echo "Total Input Tokens:           ${INPUT_TOKENS_TOTAL}"

# Calculate hit rate
if [[ $((CACHE_READ_TOTAL + CACHE_CREATION_TOTAL)) -gt 0 ]]; then
    HIT_RATE=$(echo "scale=2; ${CACHE_READ_TOTAL} * 100 / (${CACHE_READ_TOTAL} + ${CACHE_CREATION_TOTAL})" | bc)
    echo ""
    echo "=== CACHE HIT RATE: ${HIT_RATE}% ==="
else
    echo ""
    echo "=== No cache metrics found in logs ==="
    echo "Make sure you're using an Anthropic provider with prompt caching enabled."
fi

echo ""
echo "Full log saved to: ${LOG_FILE}"
echo "Debug logs in: ${DEBUG_DIR}"
