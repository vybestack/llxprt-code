#!/bin/bash
# cache-baseline-test.sh - Test Anthropic prompt caching performance with subagents
#
# This script:
# 1. Selects an isolated benchmark debug directory (non-destructive by default)
# 2. Runs a multi-subagent task to generate cache metrics
# 3. Analyzes the logs to calculate cache hit rate
#
# NON-DESTRUCTIVE BY DEFAULT: the benchmark writes to an isolated temporary
# debug directory so it NEVER clears a user's canonical log/debug directory.
# To benchmark the canonical debug dir instead, set BOTH:
#   LLXPRT_DEBUG_DIR=<absolute path>           (caller-selected, must be absolute)
#   LLXPRT_CACHE_BASELINE_CLEAR_DEBUG=1         (explicit opt-in to clear it)
# A relative or blank LLXPRT_DEBUG_DIR is rejected (ignored) to match the
# Storage override-validity contract; clearing the canonical log dir merely
# because no override was supplied is forbidden.
#
# Usage: ./cache-baseline-test.sh [profile]
# Default profile: sonnetthinking

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "${SCRIPT_DIR}")"
# shellcheck disable=SC1091
. "${SCRIPT_DIR}/llxprt-paths.sh"
# Record the caller's script dir so env-paths defaults resolve from any cwd (#6).
llxprt_paths_init "${SCRIPT_DIR}"

# Determine the benchmark debug directory with non-destructive defaults.
# An explicit, absolute LLXPRT_DEBUG_DIR is the only way to target a real
# debug dir; otherwise benchmark an isolated temp dir.
_BENCH_CLEAR=0
if [[ "${LLXPRT_CACHE_BASELINE_CLEAR_DEBUG:-0}" = "1" ]]; then
    if _DEBUG_DIR="$(llxprt_normalized_abs_override "${LLXPRT_DEBUG_DIR-}")"; then
        DEBUG_DIR="${_DEBUG_DIR}"
        _BENCH_CLEAR=1
    else
        echo "ERROR: LLXPRT_CACHE_BASELINE_CLEAR_DEBUG=1 requires an absolute LLXPRT_DEBUG_DIR." >&2
        echo "       Relative/blank overrides are ignored (Storage contract)." >&2
        exit 1
    fi
else
    # Non-destructive: isolated temp debug dir for this benchmark run.
    DEBUG_DIR="$(mktemp -d -t llxprt-cache-baseline-XXXXXX)/debug"
    # Export so the spawned CLI also writes its debug logs here.
    export LLXPRT_DEBUG_DIR="${DEBUG_DIR}"
fi

PROFILE="${1:-sonnetthinking}"
LOG_FILE="/tmp/cache_baseline_$(date +%Y%m%d_%H%M%S).log"

echo "=== Anthropic Prompt Cache Baseline Test ==="
echo "Profile: ${PROFILE}"
echo "Debug dir: ${DEBUG_DIR}"
echo "Log file: ${LOG_FILE}"
if [[ "${_BENCH_CLEAR}" = "1" ]]; then
    echo "Clear mode: ENABLED (caller-opted-in absolute debug dir)"
else
    echo "Clear mode: disabled (non-destructive isolated benchmark dir)"
fi
echo ""

if ! command -v bun >/dev/null 2>&1; then
    echo "Error: bun is required but not installed." >&2
    exit 1
fi

# Step 1: Prepare debug directory
echo "Step 1: Preparing debug directory..."
if [[ "${_BENCH_CLEAR}" = "1" ]]; then
    rm -rf "${DEBUG_DIR:?}"/*
fi
mkdir -p "${DEBUG_DIR}"
echo "  Done."
echo ""

# Step 2: Run multi-subagent task
echo "Step 2: Running multi-subagent cache test..."
echo "  This will spawn multiple subagents to test cache sharing..."
echo ""

cd "${PROJECT_DIR}"

LLXPRT_DEBUG='llxprt:*' bun scripts/start.ts \
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
