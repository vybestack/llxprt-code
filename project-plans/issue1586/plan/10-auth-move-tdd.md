# Phase 10: Auth Code Move TDD

Plan ID: PLAN-20260608-ISSUE1586.P10

## Prerequisites
- Required: Phase 09a completed
- Moved files and stubs exist in packages/auth

## Requirements Implemented

### REQ-TEST-001.1: Integration tests written BEFORE implementation
### REQ-TEST-001.3: Tests prove auth precedence, token store, OAuth flows, proxy auth

## Phase Tasks

**P10 creates or adapts behavioral tests with precise expected pass/fail criteria.** Tests relocated in P09 were a refactoring exception (tests already existed; relocation is not new TDD). P10 is where new behavioral tests with explicit pass/fail expectations are authored for the DI-refactored auth components.

Write behavioral tests for the DI-refactored auth components that will make stubs pass:

### Tests for KeyringTokenStore (DI version)
- Test: saveToken → getToken round-trip with in-memory ISecureStore test double; assert on stored/retrieved token data, not on mock method call counts
- Test: removeToken deletes from ISecureStore; assert on state, not on mock calls
- Test: listProviders returns saved providers
- Test: error handling when ISecureStore throws

### Tests for AuthPrecedenceResolver (DI version)
- Test: resolveAuth follows precedence chain: auth-key → API → env → OAuth
- Test: OAuthManager injection works
- Test: cache invalidation via ISettingsService events

### Tests for CodexDeviceFlow (DI version)
- Test: initiateAuth with optional IDebugLogger

### Tests for proxy components
- Test: ProxyTokenStore delegates via ProxySocketClient
- Test: ProxyProviderKeyStorage delegates via ProxySocketClient

### Compile/public import tests for auth package main entry (shared verifier Checks 7 and 8)
- Test: `AuthPrecedenceResolver` is exported from `packages/auth/src/index.ts` (canonical re-export specifier check, not substring)
- Test: `flushRuntimeAuthScope` is exported from `packages/auth/src/index.ts`
- Test: core factory exports (`createKeyringTokenStore`, `createAuthPrecedenceResolver`) are available from `@vybestack/llxprt-code-core` (deferred until P17 when factories are implemented)

## TDD Pass/Fail Expectation (precise per-component criteria)
- **Moved-as-is files PASS:** types.ts, token-merge.ts, token-sanitization.ts, proxy/framing.ts, proxy/proxy-socket-client.ts, proxy/proxy-token-store.ts, proxy/proxy-provider-key-storage.ts, anthropic-device-flow.ts, qwen-device-flow.ts, oauth-errors.ts — these have no DI refactoring and should pass their existing tests unchanged.
- **precedence.ts after import refactoring:** Tests for precedence.ts may pass after its core imports are replaced with DI interfaces in P09 stub step. If precedence.ts still has unrefactored imports, its tests will fail with import resolution errors. Expected: PASS after P09 refactoring, or FAIL with import errors if not yet refactored.
- **KeyringTokenStore DI stub tests NATURALLY FAIL:** KeyringTokenStore is a stub that throws NotYetImplemented. Its behavioral tests should exercise observable behavior (ISecureStore round-trip, removeToken, listProviders, error handling) and will naturally fail because the stub doesn't implement them yet. **Tests must NOT assert on `NotYetImplemented` or `throw new Error('Not yet implemented')`.**
- **AuthPrecedenceResolver DI stub tests NATURALLY FAIL:** Similar — assert on observable behavior (resolution chain, cache invalidation), not on stub error messages.
- **CodexDeviceFlow DI stub tests NATURALLY FAIL:** Assert on flow behavior, not on stub mechanism.

All P10 tests that are expected to fail MUST be clearly documented with the expected failure reason (e.g., "stub NotYetImplemented — will pass after P11 implementation").

## Phase Scope Clarification (P10 vs P09 vs P11)

### Production runtime implementations are P09 moved source, NOT P10 work
The following production files under `packages/auth/src/` contain full runtime implementations (not stubs):
- `keyring-token-store.ts` — complete KeyringTokenStore with ISecureStore DI, filesystem locks, save/get/remove/list
- `auth-precedence-resolver.ts` — complete AuthPrecedenceResolver with precedence chain, OAuthManager, cache invalidation
- `flows/codex-device-flow.ts` — complete CodexDeviceFlow with PKCE, token exchange, device flow, refresh

**These are pre-existing implementations that were moved from `core/src/auth/` during P09.** P09 moved all 15 original core auth production source files as-is into `packages/auth/src/`. P10 did NOT introduce, modify, or implement any production runtime behavior. The runtime implementations in these files represent P09 moved source awaiting P11 DI refactor verification.

P10 scope is strictly **test-only**: creating 4 new behavioral DI test files (`keyring-token-store.di.test.ts`, `auth-precedence-resolver.di.test.ts`, `codex-device-flow.di.test.ts`, `public-exports.test.ts`) with 74 tests total.

### Moved-as-is legacy tests and toHaveBeenCalled*
Pre-existing test files moved in P09 (e.g., `authRuntimeScope.test.ts`, `invalidateProviderCache.test.ts`, `auth-integration.spec.ts`, `oauth-logout-cache-invalidation.spec.ts`, `oauth-errors.spec.ts`) contain `toHaveBeenCalled*` assertions. These are **moved-as-is legacy tests** — they were written before the auth extraction project and were relocated without modification in P09. The no-mock-theater rule applies to **new P10 DI test files only**. P10-added test files contain zero `toHaveBeenCalled*` assertions (verified by search).

## Verification Commands

```bash
set -euo pipefail
npm run test --workspace @vybestack/llxprt-code-auth
# Informational: moved-as-is tests expected to pass; P10 DI tests expected to pass
# (production runtime code was moved in P09 with full implementations, not stubs)
```