#!/usr/bin/env bash
set -euo pipefail

# Hard-coded provider settings for OpenRouter (OpenAI-compatible)
OPENAI_BASE_URL="https://openrouter.ai/api/v1"
OPENAI_MODEL="qwen/qwen3-coder"

# Read your key securely from file; do not echo it.
OPENAI_API_KEY="$(cat ~/.openrouter_key)"
export OPENAI_API_KEY OPENAI_BASE_URL OPENAI_MODEL

# Integration test harness expectations
TEST_FILE_NAME="run_shell_command.multibyte.test.js"
INTEGRATION_TEST_FILE_DIR="$(pwd)/.integration-tests/adhoc-shell-multibyte"
export TEST_FILE_NAME INTEGRATION_TEST_FILE_DIR

# Minimal diagnostics (no secrets printed)
echo "Running integration test: $TEST_FILE_NAME"
echo "INTEGRATION_TEST_FILE_DIR=$INTEGRATION_TEST_FILE_DIR"
echo "OPENAI_BASE_URL=$OPENAI_BASE_URL"
echo "OPENAI_MODEL=$OPENAI_MODEL"
if [[ -n "${OPENAI_API_KEY:-}" ]]; then echo "OPENAI_API_KEY is set"; fi

# Execute only the multibyte shell integration test
node --test integration-tests/run_shell_command.multibyte.test.js
