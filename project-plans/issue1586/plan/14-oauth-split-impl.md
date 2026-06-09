# Phase 14: OAuth Manager Split Implementation

Plan ID: PLAN-20260608-ISSUE1586.P14

## Prerequisites
- Required: Phase 13a completed

## Phase Tasks

1. Ensure all P13 tests pass.
2. Finalize auth package public API: all OAuth-related exports are in index.ts (OAuthManager, OAuthTokenRequestMetadata, etc.).
3. Ensure CLI oauth-manager.ts imports OAuthManager interface from auth package.
4. Ensure CLI provider adapters import base types (OAuthError, OAuthToken, etc.) from auth package.
5. Verify OAuthProvider interface stays in CLI types.ts.
6. Verify no circular dependency between auth and CLI.

## Verification Commands

```bash
npm run test --workspace @vybestack/llxprt-code-auth
npm run test --workspace @vybestack/llxprt-code
npm run typecheck --workspace @vybestack/llxprt-code-auth
npm run typecheck --workspace @vybestack/llxprt-code

# Verify no auth→CLI dependency
if rg -n "@vybestack/llxprt-code[^-]" packages/auth/src --glob '*.ts' 2>/dev/null; then
  echo "FAIL: auth imports CLI package"; exit 1
fi

# Verify OAuthProvider in CLI
if ! rg -n "export interface OAuthProvider" packages/cli/src/auth/types.ts 2>/dev/null; then
  echo "FAIL: OAuthProvider not found in CLI types.ts"; exit 1
fi
```