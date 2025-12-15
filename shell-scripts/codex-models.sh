#!/bin/bash
# codex-models.sh - Fetch the model list from Codex API
# This script tests fetching the models endpoint to understand what's needed
# Matches the exact headers used by codex-rs CLI
#
# Usage: ./codex-models.sh
#
# Prerequisites: curl

set -e

# ============================================================================
# Configuration - Match codex-rs exactly
# ============================================================================
API_BASE="https://chatgpt.com/backend-api/codex"
CLIENT_VERSION="0.72.0"
MODELS_ENDPOINT="${API_BASE}/models?client_version=${CLIENT_VERSION}"
ORIGINATOR="codex_cli_rs"

AUTH_DIR="${HOME}/.llxprt/codex-auth"
AUTH_FILE="${AUTH_DIR}/auth.json"

# Codex's auth file location
CODEX_AUTH_FILE="${HOME}/.codex/auth.json"

# ============================================================================
# Helper functions - Match codex-rs default_client.rs get_codex_user_agent()
# Format: codex_cli_rs/VERSION (OS VERSION; ARCH) TERMINAL_INFO
# ============================================================================

get_user_agent() {
    local version="${CLIENT_VERSION}"
    # Match os_info crate output for macOS
    local os_name os_version arch
    os_name="Mac OS"
    os_version=$(sw_vers -productVersion 2>/dev/null || echo "Unknown")
    arch=$(uname -m)
    # Match terminal::user_agent() output
    local term_info="Terminal_Codex_CLI"
    echo "${ORIGINATOR}/${version} (${os_name} ${os_version}; ${arch}) ${term_info}"
}

# ============================================================================
# Load auth tokens
# ============================================================================

# First try Codex's own auth file, then fall back to our auth file
if [[ -f "${CODEX_AUTH_FILE}" ]]; then
    echo "Loading auth from Codex's auth file: ${CODEX_AUTH_FILE}"
    AUTH_SOURCE="${CODEX_AUTH_FILE}"
    ACCESS_TOKEN=$(python3 -c "import sys, json; d=json.load(open('${CODEX_AUTH_FILE}')); print(d.get('tokens', {}).get('access_token', ''))")
    ACCOUNT_ID=$(python3 -c "import sys, json; d=json.load(open('${CODEX_AUTH_FILE}')); print(d.get('tokens', {}).get('account_id', ''))")
elif [[ -f "${AUTH_FILE}" ]]; then
    echo "Loading auth from ${AUTH_FILE}..."
    AUTH_SOURCE="${AUTH_FILE}"
    ACCESS_TOKEN=$(python3 -c "import sys, json; print(json.load(open('${AUTH_FILE}')).get('access_token', ''))")
    ACCOUNT_ID=$(python3 -c "import sys, json; print(json.load(open('${AUTH_FILE}')).get('account_id', ''))")
else
    echo "ERROR: No auth file found."
    echo "Either run 'codex auth login' or run codex-oauth.sh first."
    exit 1
fi

if [[ -z "${ACCESS_TOKEN}" ]]; then
    echo "ERROR: No access_token found in ${AUTH_SOURCE}"
    exit 1
fi

if [[ -z "${ACCOUNT_ID}" ]]; then
    echo "ERROR: No account_id found in ${AUTH_SOURCE}"
    echo "The ChatGPT-Account-Id header is required for the ChatGPT backend."
    exit 1
fi

AUTH_TOKEN="${ACCESS_TOKEN}"
USER_AGENT=$(get_user_agent)

echo ""
echo "=== Codex Models API Request ==="
echo "  Endpoint: ${MODELS_ENDPOINT}"
echo "  Auth Source: ${AUTH_SOURCE}"
echo "  Account ID: ${ACCOUNT_ID}"
echo "  User Agent: ${USER_AGENT}"
echo ""

# ============================================================================
# Make the API call - Headers match codex-rs exactly:
# - User-Agent: from get_codex_user_agent()
# - originator: codex_cli_rs (from default_client.rs)
# - Authorization: Bearer <token>
# - ChatGPT-Account-Id: <account_id> (note: -Id not -ID, from backend-client/src/client.rs)
# ============================================================================

echo "Making API call to ${MODELS_ENDPOINT}..."
echo ""

# Make the request with HTTP/2 (like reqwest does)
RESPONSE=$(curl -sS --http2 -X GET "${MODELS_ENDPOINT}" \
    -H "User-Agent: ${USER_AGENT}" \
    -H "originator: ${ORIGINATOR}" \
    -H "Authorization: Bearer ${AUTH_TOKEN}" \
    -H "ChatGPT-Account-Id: ${ACCOUNT_ID}" \
    -H "Accept: application/json" \
    -w "\n\nHTTP_STATUS:%{http_code}\n" \
    2>&1)

# Extract HTTP status
HTTP_STATUS=$(echo "${RESPONSE}" | grep "HTTP_STATUS:" | cut -d: -f2)
BODY=$(echo "${RESPONSE}" | sed '/HTTP_STATUS:/d')

echo "--- Response (HTTP ${HTTP_STATUS}) ---"
echo "${BODY}"
echo "--- End Response ---"

# Check if we got JSON or HTML (Cloudflare challenge)
if echo "${BODY}" | grep -q "DOCTYPE html"; then
    echo ""
    echo "WARNING: Received HTML response (likely Cloudflare challenge)"
    echo ""
elif echo "${BODY}" | grep -q '"models"'; then
    echo ""
    echo "SUCCESS: Received models response!"
    # Try to pretty-print the JSON
    echo "${BODY}" | python3 -m json.tool 2>/dev/null || true
fi

echo ""
echo "=== Request Complete ==="
