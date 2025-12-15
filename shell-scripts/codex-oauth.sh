#!/bin/bash
# codex-oauth.sh - OAuth flow for Codex CLI authentication
# This is a toy/test script to validate the OAuth flow requirements
#
# Usage: ./codex-oauth.sh
#
# Prerequisites: curl, openssl, nc (netcat), base64

set -euo pipefail
# Ensure set -e propagates into command substitutions
shopt -s inherit_errexit 2>/dev/null || true

# ============================================================================
# Configuration (from codex-rs source)
# ============================================================================
CLIENT_ID="app_EMoamEEZ73f0CkXaXp7hrann"
ISSUER="https://auth.openai.com"
PORT=1455
REDIRECT_URI="http://localhost:${PORT}/auth/callback"
SCOPES="openid profile email offline_access"
ORIGINATOR="codex_cli_rs"

# Where to store tokens
AUTH_DIR="${HOME}/.llxprt/codex-auth"
AUTH_FILE="${AUTH_DIR}/auth.json"

# ============================================================================
# Helper functions
# ============================================================================

# Generate a random URL-safe base64 string
generate_random_string() {
    openssl rand -base64 64 | tr -d '\n' | tr '+/' '-_' | tr -d '=' || true
}

# Generate PKCE code verifier and challenge (S256)
generate_pkce() {
    local verifier challenge
    verifier=$(generate_random_string)
    # S256: BASE64URL(SHA256(verifier))
    challenge=$(printf '%s' "${verifier}" | openssl dgst -sha256 -binary | openssl base64 | tr '+/' '-_' | tr -d '=\n' || true)
    echo "CODE_VERIFIER=${verifier}"
    echo "CODE_CHALLENGE=${challenge}"
}

# Generate state parameter
generate_state() {
    openssl rand -base64 32 | tr '+/' '-_' | tr -d '=\n' || true
}

# URL encode a string (using stdin to avoid command injection)
urlencode() {
    local string="${1}"
    printf '%s' "${string}" | python3 -c "import sys, urllib.parse; print(urllib.parse.quote(sys.stdin.read(), safe=''))"
}

# ============================================================================
# Main OAuth Flow
# ============================================================================

echo "=== Codex OAuth Authentication ==="
echo ""
echo "Configuration:"
echo "  Client ID: ${CLIENT_ID}"
echo "  Issuer: ${ISSUER}"
echo "  Port: ${PORT}"
echo "  Redirect URI: ${REDIRECT_URI}"
echo ""

# Step 1: Generate PKCE codes
echo "[1/6] Generating PKCE codes..."
pkce_output=$(generate_pkce)
eval "${pkce_output}"
# CODE_VERIFIER and CODE_CHALLENGE are set via eval above
# shellcheck disable=SC2154
echo "  Code Verifier: ${CODE_VERIFIER:0:20}..."
# shellcheck disable=SC2154
echo "  Code Challenge: ${CODE_CHALLENGE:0:20}..."

# Step 2: Generate state
echo "[2/6] Generating state..."
STATE=$(generate_state)
echo "  State: ${STATE:0:20}..."

# Step 3: Build authorization URL
echo "[3/6] Building authorization URL..."

AUTH_URL="${ISSUER}/oauth/authorize?"
AUTH_URL+="response_type=code"
AUTH_URL+="&client_id=$(urlencode "${CLIENT_ID}")"
AUTH_URL+="&redirect_uri=$(urlencode "${REDIRECT_URI}")"
AUTH_URL+="&scope=$(urlencode "${SCOPES}")"
AUTH_URL+="&code_challenge=$(urlencode "${CODE_CHALLENGE}")"
AUTH_URL+="&code_challenge_method=S256"
AUTH_URL+="&id_token_add_organizations=true"
AUTH_URL+="&codex_cli_simplified_flow=true"
AUTH_URL+="&state=$(urlencode "${STATE}")"
AUTH_URL+="&originator=$(urlencode "${ORIGINATOR}")"

echo ""
echo "Authorization URL:"
echo "${AUTH_URL}"
echo ""

# Step 4: Start local HTTP server to capture callback
echo "[4/6] Starting local HTTP server on port ${PORT}..."
echo ""
echo ">>> Opening browser for authentication..."
echo ">>> Please log in with your ChatGPT account."
echo ""

# Open browser (macOS specific, adjust for Linux)
if [[ "${OSTYPE}" == "darwin"* ]]; then
    open "${AUTH_URL}"
elif command -v xdg-open &> /dev/null; then
    xdg-open "${AUTH_URL}"
else
    echo "Please open this URL in your browser:"
    echo "${AUTH_URL}"
fi

# Wait for callback using netcat
# We need to capture the authorization code from the callback
echo "Waiting for callback on http://localhost:${PORT}/auth/callback ..."

# Create a simple HTTP response
HTTP_RESPONSE="HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nConnection: close\r\n\r\n<html><body><h1>Authentication successful!</h1><p>You can close this window.</p></body></html>"

# Use netcat to listen for the callback
# This is a simplistic approach - production code would be more robust
CALLBACK_REQUEST=$(echo -e "${HTTP_RESPONSE}" | nc -l "${PORT}" 2>/dev/null | head -1)

echo ""
echo "Received callback request:"
echo "${CALLBACK_REQUEST}"

# Extract the code and state from the callback
# Expected format: GET /auth/callback?code=XXX&state=YYY HTTP/1.1
CALLBACK_PATH=$(echo "${CALLBACK_REQUEST}" | awk '{print $2}')
echo "Callback path: ${CALLBACK_PATH}"

# Parse query string (macOS compatible - no grep -P)
CALLBACK_CODE=$(echo "${CALLBACK_PATH}" | sed -n 's/.*code=\([^&]*\).*/\1/p')
CALLBACK_STATE=$(echo "${CALLBACK_PATH}" | sed -n 's/.*state=\([^& ]*\).*/\1/p')

if [[ -z "${CALLBACK_CODE}" ]]; then
    echo "ERROR: No authorization code received!"
    exit 1
fi

echo ""
echo "Received authorization code: ${CALLBACK_CODE:0:20}..."
echo "Received state: ${CALLBACK_STATE:0:20}..."

# Verify state
if [[ "${CALLBACK_STATE}" != "${STATE}" ]]; then
    echo "ERROR: State mismatch! Possible CSRF attack."
    echo "  Expected: ${STATE}"
    echo "  Received: ${CALLBACK_STATE}"
    exit 1
fi
echo "State verified successfully."

# Step 5: Exchange authorization code for tokens
echo ""
echo "[5/6] Exchanging authorization code for tokens..."

TOKEN_RESPONSE=$(curl -s -X POST "${ISSUER}/oauth/token" \
    -H "Content-Type: application/x-www-form-urlencoded" \
    -d "grant_type=authorization_code" \
    -d "code=$(urlencode "${CALLBACK_CODE}")" \
    -d "redirect_uri=$(urlencode "${REDIRECT_URI}")" \
    -d "client_id=$(urlencode "${CLIENT_ID}")" \
    -d "code_verifier=$(urlencode "${CODE_VERIFIER}")")

# Check for errors
if echo "${TOKEN_RESPONSE}" | grep -q '"error"'; then
    echo "ERROR: Token exchange failed!"
    echo "${TOKEN_RESPONSE}" | python3 -m json.tool
    exit 1
fi

# Extract tokens
ID_TOKEN=$(echo "${TOKEN_RESPONSE}" | python3 -c "import sys, json; print(json.load(sys.stdin).get('id_token', ''))")
ACCESS_TOKEN=$(echo "${TOKEN_RESPONSE}" | python3 -c "import sys, json; print(json.load(sys.stdin).get('access_token', ''))")
REFRESH_TOKEN=$(echo "${TOKEN_RESPONSE}" | python3 -c "import sys, json; print(json.load(sys.stdin).get('refresh_token', ''))")

if [[ -z "${ID_TOKEN}" ]] || [[ -z "${ACCESS_TOKEN}" ]]; then
    echo "ERROR: Failed to extract tokens from response!"
    echo "${TOKEN_RESPONSE}" | python3 -m json.tool
    exit 1
fi

echo "Tokens received successfully!"
echo "  ID Token: ${ID_TOKEN:0:50}..."
echo "  Access Token: ${ACCESS_TOKEN:0:50}..."
echo "  Refresh Token: ${REFRESH_TOKEN:0:50}..."

# Step 6: Exchange for API key
echo ""
echo "[6/6] Exchanging for API key (token exchange)..."

API_KEY_RESPONSE=$(curl -s -X POST "${ISSUER}/oauth/token" \
    -H "Content-Type: application/x-www-form-urlencoded" \
    -d "grant_type=$(urlencode "urn:ietf:params:oauth:grant-type:token-exchange")" \
    -d "client_id=$(urlencode "${CLIENT_ID}")" \
    -d "requested_token=openai-api-key" \
    -d "subject_token=$(urlencode "${ID_TOKEN}")" \
    -d "subject_token_type=$(urlencode "urn:ietf:params:oauth:token-type:id_token")")

# Check for errors
CODEX_API_KEY=""
if echo "${API_KEY_RESPONSE}" | grep -q '"error"'; then
    echo "WARNING: API key exchange failed (this may be expected for some accounts):"
    echo "${API_KEY_RESPONSE}" | python3 -m json.tool
else
    CODEX_API_KEY=$(echo "${API_KEY_RESPONSE}" | python3 -c "import sys, json; print(json.load(sys.stdin).get('access_token', ''))")
    echo "API Key received: ${CODEX_API_KEY:0:20}..."
fi

# Save tokens with secure permissions
echo ""
echo "Saving tokens to ${AUTH_FILE}..."
mkdir -p "${AUTH_DIR}"
chmod 700 "${AUTH_DIR}"  # Restrict directory access to owner only

cat > "${AUTH_FILE}" << EOF
{
    "id_token": "${ID_TOKEN}",
    "access_token": "${ACCESS_TOKEN}",
    "refresh_token": "${REFRESH_TOKEN}",
    "codex_api_key": "${CODEX_API_KEY}",
    "client_id": "${CLIENT_ID}",
    "issuer": "${ISSUER}",
    "timestamp": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
}
EOF
chmod 600 "${AUTH_FILE}"  # Restrict file access to owner only

echo ""
echo "=== Authentication Complete ==="
echo ""
echo "Tokens saved to: ${AUTH_FILE}"
echo ""
echo "You can now use codex-call.sh to test the API."
