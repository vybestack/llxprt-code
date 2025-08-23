#!/bin/bash
# @plan:PLAN-20250823-AUTHFIXES.P15
# @requirement:REQ-004
# Verify OAuth integration works end-to-end

set -e

echo "=== OAuth Integration Verification ==="

# 1. Check token persistence
echo "1. Testing token persistence..."
TOKEN_DIR="$HOME/.llxprt/oauth"
mkdir -p "$TOKEN_DIR"
echo '{"access_token":"test","expiry":9999999999,"token_type":"Bearer"}' > "$TOKEN_DIR/test.json"

# Start CLI and check no auth required
echo "/auth test" | timeout 5 npm run cli 2>&1 | grep -q "authenticated" && \
  echo "✓ Token loaded from disk" || \
  echo "✗ Token not loaded"

# 2. Test logout
echo "2. Testing logout..."
echo "/auth test logout" | timeout 5 npm run cli 2>&1
[ ! -f "$TOKEN_DIR/test.json" ] && \
  echo "✓ Token removed on logout" || \
  echo "✗ Token not removed"

# 3. Test multiple providers
echo "3. Testing multiple providers..."
echo '{"access_token":"qwen","expiry":9999999999,"token_type":"Bearer"}' > "$TOKEN_DIR/qwen.json"
echo '{"access_token":"anthropic","expiry":9999999999,"token_type":"Bearer"}' > "$TOKEN_DIR/anthropic.json"

echo "/auth qwen logout" | timeout 5 npm run cli 2>&1
[ ! -f "$TOKEN_DIR/qwen.json" ] && [ -f "$TOKEN_DIR/anthropic.json" ] && \
  echo "✓ Independent provider sessions" || \
  echo "✗ Provider sessions not independent"

# 4. Check no magic strings
echo "4. Checking magic strings removed..."
! grep -r "USE_LOGIN_WITH_GOOGLE" packages/cli/src packages/core/src --exclude-dir=test && \
  echo "✓ Magic strings removed" || \
  echo "✗ Magic strings still present"

echo "=== Integration Verification Complete ==="