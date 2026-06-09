# Phase 12: OAuth Manager Split Stub

Plan ID: PLAN-20260608-ISSUE1586.P12

## Prerequisites
- Required: Phase 11a completed
- Auth code moved with DI refactoring complete

## Requirements Implemented

### REQ-OAUTH-001.1: OAuthManager interface moves to packages/auth
**Behavior**: GIVEN AuthPrecedenceResolver uses OAuthManager interface, WHEN interface lives in packages/auth, THEN CLI implements it from auth package.

### REQ-OAUTH-001.3: Provider-specific adapters are registered, not hard-coded
**Behavior**: GIVEN a new provider is added, WHEN auth adapter is registered in CLI, THEN no auth package changes required.

## Phase Tasks

1. Verify `OAuthManager` interface is properly exported from `packages/auth/src/precedence.ts` (it moved there in P09).
2. Verify `OAuthTokenRequestMetadata` type is properly exported.
3. Verify `OAuthProvider` interface stays in CLI types.ts (per consistent decision across all artifacts).
4. Add `implements OAuthManager` or structural compatibility marker to CLI `oauth-manager.ts`.
5. Stub any missing auth package exports needed by CLI OAuth composition.

## Design Decisions (consistent across all artifacts)
- **OAuthManager interface**: Owned by `packages/auth` (in precedence.ts)
- **OAuthProvider interface**: Owned by `packages/cli` (in cli/src/auth/types.ts) — used only by CLI adapter classes
- **CLI OAuthManager implementation**: Stays in `packages/cli/src/auth/oauth-manager.ts`

## Verification Commands

```bash
# Compile-time type test: CLI oauth-manager structurally implements auth OAuthManager
npx tsc --noEmit -p packages/cli/tsconfig.json
# This confirms structural compatibility at compile time

# Verify OAuthManager interface is exported from auth
if ! rg -n "export interface OAuthManager" packages/auth/src/precedence.ts 2>/dev/null; then
  echo "FAIL: OAuthManager interface not found in auth precedence.ts"; exit 1
fi

# Verify OAuthProvider stays in CLI
if ! rg -n "export interface OAuthProvider" packages/cli/src/auth/types.ts 2>/dev/null; then
  echo "FAIL: OAuthProvider not found in CLI types.ts"; exit 1
fi

# Forbidden: no runtime instanceof check for type-only interface
if rg -n "instanceof OAuthManager" packages/cli/src/auth --glob '*.ts' 2>/dev/null; then
  echo "FAIL: runtime instanceof on type-only interface"; exit 1
fi
```