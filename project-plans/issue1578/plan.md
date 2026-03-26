# Issue #1578: Decompose oauth-manager.ts and Rationalize OAuth Auth System

## Objective

Decompose `packages/cli/src/auth/oauth-manager.ts` (2,841 lines, ~50 methods) from a God Object into cohesive, single-responsibility modules. Simultaneously fix DRY violations across the four CLI OAuth providers and correct SoC violations where provider-specific logic is embedded in the general manager.

No backward-compatibility re-exports or runtime shim layers. All consumers are updated to import from the correct source module.

## Acceptance Criteria

From the issue:
- No single file exceeds 800 lines
- No single function exceeds 80 lines
- All existing tests pass
- Test coverage does not decrease

Additional quality criteria:
- `OAuthProvider` interface lives in `types.ts`, not in the 2,841-line file
- Runtime helper functions live in dedicated utility modules, not in `types.ts`
- Shared code duplicated across 4 CLI OAuth providers is extracted
- Deprecated `refreshIfNeeded()` stubs (dead code in all 4 providers) are removed
- Provider-specific usage methods move out of OAuthManager
- No backward-compatibility re-exports from oauth-manager.ts
- Zero Gemini-specific `if (providerName === 'gemini')` branches in the manager layer — all regularized via generic provider extension points or removed as dead/duplicate code

## Current State Analysis

### oauth-manager.ts Responsibilities (SoC Violations)

The file is simultaneously:
1. **Provider Registry** — register, get, toggle enabled, getSupportedProviders
2. **Token Coordinator** — getToken, getOAuthToken, peekStoredToken with TOCTOU locking
3. **Proactive Renewal Scheduler** — timers, backoff, per-profile scheduling
4. **Auth Flow Orchestrator** — authenticate, authenticateMultipleBuckets with stdin/MessageBus UI
5. **Session/Bucket Manager** — metadata-scoped session buckets, scope keys
6. **Profile Bucket Resolver** — getProfileBuckets, getCurrentProfileSessionBucket, getCurrentProfileSessionMetadata (runtime/settings dependent)
7. **Auth Status/Logout Service** — getAuthStatus, logout, logoutAll, clearProviderAuthCaches
8. **Usage Info Aggregator** — getAnthropicUsageInfo, getAllCodexUsageInfo, getAllGeminiUsageInfo
9. **Provider-specific Utilities** — isQwenCompatibleUrl, getHigherPriorityAuth, unwrapLoggingProvider

### Oversized Methods (>80 lines)

| Method | Lines | Destination Module |
|--------|-------|-----------|
| `authenticateMultipleBuckets` | 340 | Auth Flow Orchestrator |
| `getToken` | 329 | Token Access Coordinator |
| `getOAuthToken` | 277 | Token Access Coordinator |
| `authenticate` | 197 | Auth Flow Orchestrator |
| `runProactiveRenewal` | 118 | Proactive Renewal Manager |
| `logout` | 103 | Auth Status Service |
| `getProfileBuckets` | 97 | Token Access Coordinator |
| `configureProactiveRenewalsForProfile` | 75 | Proactive Renewal Manager |
| `clearProviderAuthCaches` | ~96 | Auth Status Service |

### DRY Violations in CLI OAuth Providers

The four CLI OAuth providers (anthropic-oauth-provider.ts, codex-oauth-provider.ts, gemini-oauth-provider.ts, qwen-oauth-provider.ts) duplicate several patterns, though not all patterns exist in all 4:

1. `InitializationState` enum — identical 4-value enum in all 4 files (values: `NotStarted`, `InProgress`, `Completed`, `Failed`)
2. `ensureInitialized()` state machine — present in all 4, near-identical but with subtle differences:
   - Anthropic, Gemini, Qwen wrap errors in `OAuthErrorFactory.fromUnknown()` and store `initializationError`
   - Codex has a simpler version: no `initializationError` field, no `OAuthError` wrapping, just rethrows
3. State fields: `initializationState`, `initializationPromise` in all 4; `initializationError` in Anthropic, Gemini, Qwen only (not Codex)
4. `setAddItem()` callback — all 4; `addItem || globalOAuthUI.getAddItem()` fallback in Anthropic, Gemini, Qwen
5. `errorHandler`/`retryHandler` — `new GracefulErrorHandler(new RetryHandler())` in Anthropic, Gemini, Qwen; Codex has no `errorHandler`/`retryHandler`
6. `waitForAuthCode()`/`submitAuthCode()`/`cancelAuth()` — identical Promise dialog pattern in **Anthropic and Gemini only**; Codex and Qwen do NOT have these methods (they use callback server / device flow patterns instead)
7. `isTokenExpired()` with 30-second buffer — identical in **Anthropic and Qwen only**; not present in Codex or Gemini
8. `hasValidRefreshToken()` validation — only in **Anthropic** (with string length checks); not duplicated in other providers (Qwen checks `!currentToken.refresh_token` inline)
9. Deprecated `refreshIfNeeded()` — identical dead code stubs returning null with deprecation warning in all 4

### Production Consumers (15 files)

| File | Imports |
|------|---------|
| `ui/commands/authCommand.ts` | `OAuthManager` class |
| `ui/commands/types.ts` | type `OAuthManager` |
| `config/profileBootstrap.ts` | type `OAuthManager` |
| `auth/migration.ts` | `OAuthProvider` interface |
| `auth/anthropic-oauth-provider.ts` | `OAuthProvider` interface |
| `auth/gemini-oauth-provider.ts` | `OAuthProvider` interface |
| `auth/codex-oauth-provider.ts` | `OAuthProvider` interface |
| `auth/qwen-oauth-provider.ts` | `OAuthProvider` interface |
| `auth/BucketFailoverHandlerImpl.ts` | type `OAuthManager` |
| `providers/providerManagerInstance.ts` | `OAuthManager` class, `OAuthManagerRuntimeMessageBusDeps` type |
| `providers/oauth-provider-registration.ts` | `OAuthManager` class |
| `runtime/runtimeAccessors.ts` | `OAuthManager` |
| `runtime/runtimeContextFactory.ts` | `OAuthManager` |
| `runtime/runtimeRegistry.ts` | `OAuthManager` |
| `runtime/runtimeLifecycle.ts` | `OAuthManager` |

### Test Consumers (additional files importing from oauth-manager)

Test files that import `OAuthManager` and/or `OAuthProvider` from `oauth-manager.ts` — these must have their imports updated alongside production code. Notable test files outside `auth/`:

| File | Imports |
|------|---------|
| `integration-tests/oauth-buckets.integration.spec.ts` | `OAuthManager`, `OAuthProvider` |
| `integration-tests/model-params-isolation.integration.test.ts` | type `OAuthManager` |
| `integration-tests/modelParams.integration.test.ts` | type `OAuthManager` |
| `integration-tests/oauth-timing.integration.test.ts` | `OAuthManager` |
| `runtime/runtimeLifecycle.spec.ts` | `OAuthManager` |
| `runtime/runtime-oauth-messagebus.test.ts` | `OAuthManager` |
| `ui/commands/authCommand.test.ts` | `OAuthManager` |
| `ui/commands/authCommand.codex.test.ts` | `OAuthManager` |
| `auth/proxy/__tests__/factory-detection-wiring.test.ts` | `OAuthManager` |
| `auth/__tests__/oauthManager.safety.test.ts` | `unwrapLoggingProvider`, type `OAuthProvider` |

**Important:** The safety test imports `unwrapLoggingProvider` directly from `oauth-manager.js`. This must be updated to import from `auth-utils.js` in Phase 1.

**Important:** In addition to the test files listed above, ~16 test files **within** `auth/` import `OAuthProvider` and/or `OAuthManager` from `oauth-manager.js` (e.g., `oauth-manager.spec.ts`, `oauth-manager.auth-lock.spec.ts`, `oauth-manager.token-reuse.spec.ts`, `BucketFailoverHandlerImpl.spec.ts`, etc.). These are included in the "33 test files" count. During Phase 1, any test file importing `OAuthProvider` from `oauth-manager.js` must be updated to import from `./types.js`. Test files that import only `OAuthManager` (which remains in `oauth-manager.ts`) do not need import changes in Phase 1 but may need updates if they also import `OAuthProvider` in the same import statement — the import must be split.

### Test Files (21,430 lines across 33 files)

Tests instantiate `OAuthManager` directly and mock `OAuthProvider` implementations. The public API surface of `OAuthManager` must remain identical — tests should pass without modification to their assertions, only import paths change where types move.

### Architecture Layers

```
Core Package (packages/core):
  BaseProvider → AuthPrecedenceResolver → OAuthManager (minimal interface in precedence.ts)
  Interface: getToken(provider), isAuthenticated(provider), optional getOAuthToken?, isOAuthEnabled?

CLI Package (packages/cli):
  OAuthManager class (2841 lines) → OAuthProvider interface → {Anthropic,Codex,Gemini,Qwen}OAuthProvider
  Support: MultiBucketAuthenticator, OAuthBucketManager, BucketFailoverHandlerImpl
```

### Key Coupling Points

1. **Profile resolution helpers** (`getProfileManagerCtor`, `createProfileManager`, `isLoadBalancerProfileLike`, `getOAuthBucketsFromProfile`) are defined as top-level functions at lines 108-181 and consumed by TWO different concerns:
   - Proactive renewal: `configureProactiveRenewalsForProfile` (line 1699)
   - Token access: `getProfileBuckets` (line 2449)
   These must go to a shared module accessible by both.

2. **Runtime MessageBus + Config** are used by token access (line 2613: `requireRuntimeMessageBus`), auth flow orchestration (lines 2613+), and auth status/logout (`clearProviderAuthCaches` at line 1905 which dynamically imports `../runtime/runtimeSettings.js`).

3. **`getToken` calls `authenticateMultipleBuckets`** (lines 1065-1088) — the token coordinator must be able to trigger auth flows, creating a dependency from token access → auth flow. Resolved via callback injection.

4. **Gemini special cases** exist in FIVE locations and are **regularized** (not merely relocated) during this refactoring. See "Gemini Regularization Strategy" section below.

5. **`clearProviderAuthCaches`** (line 1905) dynamically imports `../runtime/runtimeSettings.js` to access `getCliProviderManager` and `getCliRuntimeContext`. This method needs runtime access regardless of which module owns it.

### Gemini Regularization Strategy

The current code has 5 Gemini-specific branches scattered across `oauth-manager.ts`. Rather than relocating these to extracted modules (which would perpetuate the SoC violation), we regularize each one:

| # | Location | Current Behavior | Fix | Phase |
|---|----------|-----------------|-----|-------|
| G1 | `isAuthenticated` (line 629) | Hardcoded `if providerName === 'gemini' && isOAuthEnabled('gemini')` returns true | Add optional `isAuthenticated?(): Promise<boolean>` to `OAuthProvider` interface. **Contract constraint:** This method is ONLY consulted when `isOAuthEnabled(providerName)` is true. It is intended for providers that manage authentication externally (e.g., Gemini's LOGIN_WITH_GOOGLE) where the manager's token-store/expiry check is not the source of truth. Providers that use the standard token-store flow (Anthropic, Codex, Qwen) should NOT implement this method — their auth status is correctly determined by the default token-store + expiry check. If a provider does implement it, its semantics are: "I can confirm authentication status independent of the token store." `GeminiOAuthProvider` implements it (always returns true — LOGIN_WITH_GOOGLE handles auth transparently). `AuthStatusService.isAuthenticated()` checks `provider.isAuthenticated?.()` ONLY when `isOAuthEnabled(providerName)` is true. When OAuth is disabled, the override is never consulted. No provider-name check needed. | Phase 1 (interface), Phase 7 (AuthStatusService), Phase 10 (GeminiOAuthProvider impl) |
| G2 | `logout` (lines 721-750) | Manager deletes `~/.llxprt/oauth_creds.json` and `~/.llxprt/google_accounts.json` | **Remove from manager.** `GeminiOAuthProvider.logout()` already calls `clearLegacyTokens()` at line 413, which deletes these exact same files. The manager calls `provider.logout(token)` at line 689 before this block, so the provider already handles cleanup. This is pure duplication. | Phase 7 |
| G3 | `clearProviderAuthCaches` (lines 1941-1953) | Gemini-specific branch calls `clearAuthCache()` (redundant — already called generically at line 1929) and `clearAuth()` | **Generalize:** Call `clearAuth?.()` for ALL runtime-resolved **core** providers (this method operates on core `BaseProvider` instances obtained via `getCliProviderManager()`, NOT CLI `OAuthProvider` instances). `BaseProvider.clearAuth()` is an optional method (line 442). Core `GeminiProvider` overrides it to also clear `GEMINI_API_KEY` env var (line 662). Other core providers either inherit the base no-op or have compatible overrides. **Each cleanup call (`clearAuthCache`, `clearAuth`, `clearState`) must be wrapped in its own independent try/catch** — a failure in one must NOT skip the remaining cleanup steps or the final `flushRuntimeAuthScope()`. Pattern: `for (const fn of [() => provider.clearAuthCache?.(), () => provider.clearAuth?.(), () => provider.clearState?.()]) { try { fn(); } catch (e) { logger.debug(...); } }` followed by `flushRuntimeAuthScope()` outside the loop. Remove the `if (provider.name === 'gemini')` branch entirely. | Phase 7 |
| G4 | `getToken` (lines 1096-1103) | Catches `Error('USE_EXISTING_GEMINI_OAUTH')` and returns null | **Remove dead code.** Grep of entire codebase confirms nothing throws this error — it exists only in the catch block. This is vestigial code from a removed Gemini flow. | Phase 5 |
| G5 | `getAllGeminiUsageInfo` (line 2327) | Hardcoded `tokenStore.listBuckets('gemini')` | **No change needed.** This is inside `getAllGeminiUsageInfo()` — it's expected to be Gemini-specific since the function itself is provider-specific. Moves to `provider-usage-info.ts` as planned. | Phase 8 |

**Key insight for G2:** `GeminiOAuthProvider.logout()` (line 400-427) already performs comprehensive cleanup:
1. Clears `currentToken` in memory
2. Calls `tokenStore.removeToken('gemini')` 
3. Calls `clearLegacyTokens()` — deletes `oauth_creds.json` and `google_accounts.json`
4. Calls `clearOauthClientCache()` from core

The manager's duplicate file deletion (G2) and the generic `clearProviderAuthCaches` call (G3) are both redundant with the provider's own cleanup. After regularization, all Gemini cleanup lives in `GeminiOAuthProvider` and core `GeminiProvider` — where it belongs.

**Key insight for G3:** The `clearProviderAuthCaches` method operates on **CORE** providers (resolved via `getCliProviderManager().getProviderByName()`), not CLI `OAuthProvider` instances. The current code uses `unwrapLoggingProvider(targetProvider as OAuthProvider | undefined)` which is a typing hack — it casts a core provider to the CLI `OAuthProvider` type. After extraction to `AuthStatusService`, the implementation should use a core-compatible typing approach:

```typescript
// In auth-status-service.ts — clearProviderAuthCaches:
// The provider returned by getCliProviderManager() is a core BaseProvider instance,
// not a CLI OAuthProvider. Use structural duck-typing for cache clearing methods
// rather than casting to OAuthProvider.
const provider = providerManager.getProviderByName(providerName);
if (!provider) return;

// Generic cache/state clearing — all via duck-typed optional checks
if ('clearAuthCache' in provider && typeof provider.clearAuthCache === 'function') {
  provider.clearAuthCache();
}
if ('clearAuth' in provider && typeof provider.clearAuth === 'function') {
  try { provider.clearAuth(); } catch (e) { logger.debug(...); }
}
if ('clearState' in provider && typeof provider.clearState === 'function') {
  provider.clearState();
}
```

The core `GeminiProvider` already has `clearState()` (line 654), `clearAuth()` (line 662), and `clearAuthCache()` (line 673) overrides. The generic duck-typed calls capture all of these without any provider-name branching. `unwrapLoggingProvider` is still needed to peel through the logging wrapper (it remains in `auth-utils.ts`), but its generic type parameter should be broadened from `T extends OAuthProvider | undefined` to `T extends { name: string } | undefined` to avoid the CLI→core type mismatch.

## Field/Method Migration Matrix

Every private field and public/private method in `OAuthManager` mapped to its destination.

### Private Fields (lines 223-249)

| Field | Line | Destination |
|-------|------|-------------|
| `providers: Map<string, OAuthProvider>` | 223 | ProviderRegistry |
| `tokenStore: TokenStore` | 224 | Shared (passed to all modules) |
| `settings?: LoadedSettings` | 225 | Shared (passed to modules that need it) |
| `inMemoryOAuthState: Map<string, boolean>` | 227 | ProviderRegistry |
| `sessionBuckets: Map<string, string>` | 229 | OAuthBucketManager (enhanced) |
| `bucketResolutionLocks: Map<string, Promise<void>>` | 230 | TokenAccessCoordinator |
| `proactiveRenewals: Map<...>` | 231-233 | ProactiveRenewalManager |
| `proactiveRenewalFailures: Map<string, number>` | 234 | ProactiveRenewalManager |
| `proactiveRenewalInFlight: Set<string>` | 235 | ProactiveRenewalManager |
| `proactiveRenewalTokens: Map<string, string>` | 236 | ProactiveRenewalManager |
| `runtimeMessageBus?: MessageBus` | 238 | AuthFlowOrchestrator (only consumer is `requireRuntimeMessageBus` → `authenticateMultipleBuckets`) |
| `config?: Config` | 239 | Shared (injected into TokenAccessCoordinator + AuthFlowOrchestrator; also passed to usage-info functions at call time) |
| `userDismissedAuthPrompt` | 243 | AuthFlowOrchestrator (used only in `authenticateMultipleBuckets`) |

### Top-Level Constants and Logger (lines 27-30)

| Symbol | Line | Destination |
|--------|------|-------------|
| `logger` | 27 | Each extracted module creates its own `DebugLogger` with a descriptive namespace (e.g., `'llxprt:oauth:registry'`, `'llxprt:oauth:renewal'`, `'llxprt:oauth:token'`, etc.) |
| `MAX_PROACTIVE_RENEWAL_FAILURES` | 30 | proactive-renewal-manager.ts |

### Top-Level Functions (lines 32-181)

| Function | Lines | Destination | Exported? |
|----------|-------|-------------|-----------|
| `isAuthOnlyEnabled` | 32-45 | auth-utils.ts | Yes |
| `isLoggingWrapperCandidate` | 48-54 | auth-utils.ts | No (private helper for `unwrapLoggingProvider`) |
| `hasRequestMetadata` | 58-67 | auth-utils.ts | Yes (used by TokenAccessCoordinator in `getOAuthToken` line 1210) |
| `unwrapLoggingProvider` | 74-97 | auth-utils.ts | Yes |
| `getProfileManagerCtor` | 108-117 | profile-utils.ts | No (internal, accessed via `createProfileManager`) |
| `createProfileManager` | 120-125 | profile-utils.ts | Yes |
| `isLoadBalancerProfileLike` | 127-140 | profile-utils.ts | Yes |
| `getOAuthBucketsFromProfile` | 143-181 | profile-utils.ts | Yes |

### Top-Level State (lines 103-106)

| Symbol | Line | Destination |
|--------|------|-------------|
| `ProfileManagerCtor` type alias | 103-104 | profile-utils.ts (not exported) |
| `profileManagerCtorPromise` | 106 | profile-utils.ts (module-level `let`, not exported) |

### Public Methods

| Method | Lines | Destination |
|--------|-------|-------------|
| `registerProvider` | 316-349 | ProviderRegistry |
| `getProvider` | 351-358 | ProviderRegistry |
| `getSupportedProviders` | 1768-1775 | ProviderRegistry |
| `toggleOAuthEnabled` | 1777-1798 | ProviderRegistry |
| `isOAuthEnabled` | 1800-1810 | ProviderRegistry |
| `getToken` | 784-1111 | TokenAccessCoordinator |
| `peekStoredToken` | 1113-1134 | TokenAccessCoordinator |
| `getOAuthToken` | 1136-1411 | TokenAccessCoordinator |
| `authenticate` | 360-555 | AuthFlowOrchestrator |
| `authenticateMultipleBuckets` | 2501-2839 | AuthFlowOrchestrator |
| `getAuthStatus` | 557-616 | AuthStatusService |
| `isAuthenticated` | 618-655 | AuthStatusService |
| `logout` | 657-752 | AuthStatusService |
| `logoutAll` | 760-775 | AuthStatusService |
| `logoutAllBuckets` | 2080-2091 | AuthStatusService |
| `getAuthStatusWithBuckets` | 2099-2155 | AuthStatusService |
| `listBuckets` | 2092-2097 | AuthStatusService |
| `setSessionBucket` | 2007-2020 | OAuthBucketManager |
| `getSessionBucket` | 2022-2029 | OAuthBucketManager |
| `clearSessionBucket` | 2060-2067 | OAuthBucketManager |
| `clearAllSessionBuckets` | 2069-2078 | OAuthBucketManager |
| `getAnthropicUsageInfo` | 2156-2197 | provider-usage-info.ts |
| `getAllAnthropicUsageInfo` | 2199-2249 | provider-usage-info.ts |
| `getAllCodexUsageInfo` | 2251-2321 | provider-usage-info.ts |
| `getAllGeminiUsageInfo` | 2323-2359 | provider-usage-info.ts |
| `getHigherPriorityAuth` | 1836-1880 | provider-usage-info.ts |
| `getTokenStore` | 1827-1834 | Facade (stays) |
| `configureProactiveRenewalsForProfile` | 1687-1766 | ProactiveRenewalManager |

### Private Methods

| Method | Lines | Destination |
|--------|-------|-------------|
| `withBucketResolutionLock` | 270-300 | TokenAccessCoordinator |
| `requireRuntimeMessageBus` | 302-314 | AuthFlowOrchestrator (only called from `authenticateMultipleBuckets` at line 2613) |
| `normalizeBucket` | 1413-1418 | ProactiveRenewalManager (all 5 call sites are in renewal methods) |
| `getProactiveRenewalKey` | 1420-1422 | ProactiveRenewalManager |
| `clearProactiveRenewal` | 1424-1433 | ProactiveRenewalManager |
| `setProactiveTimer` | 1435-1469 | ProactiveRenewalManager |
| `scheduleProactiveRetry` | 1471-1508 | ProactiveRenewalManager |
| `scheduleProactiveRenewal` | 1510-1567 | ProactiveRenewalManager |
| `runProactiveRenewal` | 1569-1685 | ProactiveRenewalManager |
| `setOAuthEnabledState` | 1812-1825 | ProviderRegistry (private→public: called by AuthFlowOrchestrator.authenticate via providerRegistry) |
| `isQwenCompatibleUrl` | 1882-1903 | provider-usage-info.ts (module-private, only called by `getHigherPriorityAuth`) |
| `clearProviderAuthCaches` | 1905-2005 | AuthStatusService |
| `getSessionBucketScopeKey` | 2362-2373 | OAuthBucketManager |
| `getCurrentProfileSessionBucket` | 2031-2058 | TokenAccessCoordinator |
| `getCurrentProfileSessionMetadata` | 2374-2402 | TokenAccessCoordinator |
| `getProfileBuckets` | 2404-2499 | TokenAccessCoordinator |

## Visibility Changes (private → public)

Methods that are `private` on `OAuthManager` but must become `public` on their destination class because they are called across module boundaries:

| Method | Current Visibility | Destination | Called By (Cross-Module) |
|--------|-------------------|-------------|--------------------------|
| `scheduleProactiveRenewal` | private (line 1510) | ProactiveRenewalManager | TokenAccessCoordinator (`getOAuthToken` lines 1317, 1339, 1366, 1394) |
| `clearProactiveRenewal` | private (line 1424) | ProactiveRenewalManager | AuthStatusService needs `clearRenewalsForProvider(providerName)` — see note below |
| `getCurrentProfileSessionBucket` | private (line 2031) | TokenAccessCoordinator | AuthStatusService (`logout` line 675, `getAuthStatusWithBuckets` line 2110) |
| `getCurrentProfileSessionMetadata` | private (line 2374) | TokenAccessCoordinator | AuthStatusService (`logout` line 670, `getAuthStatusWithBuckets` line 2108, usage-info methods) |
| `getProfileBuckets` | private (line 2404) | TokenAccessCoordinator | Stays private — only called within TokenAccessCoordinator (`getToken`, `getOAuthToken`) |
| `getSessionBucketScopeKey` | private (line 2362) | OAuthBucketManager | Exposed as public for test verification of key format |
| `normalizeBucket` | private (line 1413) | ProactiveRenewalManager | Stays private — all 5 call sites are within ProactiveRenewalManager |
| `setOAuthEnabledState` | private (line 1812) | ProviderRegistry | AuthFlowOrchestrator (`authenticate` lines 388, 410, 446, 467, 491, 528) via `providerRegistry.setOAuthEnabledState()` |

**Note on `clearProactiveRenewal`:** Currently, `logout()` does NOT cancel proactive renewal timers for the logged-out provider/bucket. After decomposition, `AuthStatusService.logout()` should call `this.proactiveRenewalManager.clearRenewalsForProvider(providerName, bucket)` to clean up timers. This is a **behavioral improvement** (not just a move). Expose a public `clearRenewalsForProvider(providerName: string, bucket?: string)` method on `ProactiveRenewalManager` that calls the internal `clearProactiveRenewal` for the matching key(s). Document this in Phase 7 as an intentional improvement.

## Target Architecture

```
packages/cli/src/auth/
├── types.ts                        (~125 lines, existing re-exports + OAuthTokenRequestMetadata re-export + OAuthProvider [with optional isAuthenticated()] + OAuthManagerRuntimeMessageBusDeps + BucketFailoverOAuthManagerLike + AuthenticatorInterface)
├── auth-utils.ts                   (~80 lines, NEW - provider wrapper/auth-parsing helpers)
├── profile-utils.ts                (~100 lines, NEW - profile manager/bucket extraction helpers)
├── oauth-manager.ts                (~400-500 lines, thin facade)
├── provider-registry.ts            (~200 lines, NEW)
├── proactive-renewal-manager.ts    (~350 lines, NEW)
├── token-access-coordinator.ts     (~550 lines, NEW - includes profile-aware bucket resolution)
├── auth-flow-orchestrator.ts       (~450 lines, NEW)
├── auth-status-service.ts          (~350 lines, NEW)
├── provider-usage-info.ts          (~200 lines, NEW)
├── OAuthBucketManager.ts           (~230 lines, enhanced from ~151)
├── oauth-provider-base.ts          (~150 lines, NEW - shared provider utilities)
├── anthropic-oauth-provider.ts     (~530 lines, reduced from 604)
├── codex-oauth-provider.ts         (~480 lines, reduced from 547)
├── gemini-oauth-provider.ts        (~510 lines, reduced from 575)
├── qwen-oauth-provider.ts          (~380 lines, reduced from 446)
├── MultiBucketAuthenticator.ts     (204 lines, unchanged)
├── BucketFailoverHandlerImpl.ts    (662 lines, unchanged)
└── (all existing test files — import paths updated, assertions unchanged)
```

### Dependency Graph (No Cycles)

```
OAuthManager (facade) implements BucketFailoverOAuthManagerLike
  ├── ProviderRegistry             (no deps on other new modules)
  ├── OAuthBucketManager           (no deps on other new modules)
  ├── ProactiveRenewalManager      (depends on ProviderRegistry via callbacks; uses profile-utils.ts)
  ├── TokenAccessCoordinator       (depends on Registry, Renewal, BucketManager, facadeRef)
  │   └── setAuthenticator(...)    (callback to AuthFlowOrchestrator, set post-construction)
  ├── AuthFlowOrchestrator         (depends on Registry, BucketManager, facadeRef — NOT Renewal)
  ├── AuthStatusService            (depends on Registry, Renewal, BucketManager, TokenAccessCoordinator)
  └── provider-usage-info          (standalone functions, receives deps as params)

Shared utilities (profile-utils.ts has module-level state for import caching):
  ├── types.ts                     (interfaces + re-exports from core)
  ├── auth-utils.ts                (unwrapLoggingProvider, isAuthOnlyEnabled, hasRequestMetadata, etc.)
  └── profile-utils.ts             (createProfileManager, getOAuthBucketsFromProfile, etc.)
```

Dependency flow is acyclic:
- `ProviderRegistry` ← no deps on other new modules
- `OAuthBucketManager` ← no deps on other new modules
- `ProactiveRenewalManager` ← depends on ProviderRegistry (via callbacks)
- `TokenAccessCoordinator` ← depends on Registry, Renewal, BucketManager, facade ref (set in constructor)
- `AuthFlowOrchestrator` ← depends on Registry, BucketManager, facade ref (NOT Renewal — neither `authenticate` nor `authenticateMultipleBuckets` call `scheduleProactiveRenewal`)
- `AuthStatusService` ← depends on Registry, Renewal, BucketManager, TokenAccessCoordinator
- `TokenAccessCoordinator` → `AuthFlowOrchestrator` ← via `setAuthenticator` callback (not a module import)
- No module imports another module that imports it back

Note: `TokenAccessCoordinator` depends on `AuthFlowOrchestrator` because `getToken()` can trigger `authenticateMultipleBuckets()`. This is injected via a `setAuthenticator` callback — not a direct import — to avoid circular dependencies. Before `setAuthenticator` is called, any attempt to use the authenticator throws a clear error (tested).

**Barrel export / circular import risk mitigation:** This plan does NOT introduce a barrel `index.ts` file. Each module imports from specific files (`./types.js`, `./provider-registry.js`, etc.). Barrel exports would risk masking circular imports. The acyclic dependency graph must be verified after Phase 9 using `npx madge --circular packages/cli/src/auth/`. Additionally, `types.ts` must NOT import from any extracted module — it contains only interfaces and re-exports from `@vybestack/llxprt-code-core`. If `types.ts` were to import from e.g., `provider-registry.ts` (which imports from `types.ts`), a circular dependency would form.

### Critical: BucketFailoverHandlerImpl `this`-passing Pattern

`BucketFailoverHandlerImpl` is constructed with an `OAuthManager` reference in two places:
- `getOAuthToken` (line 1228): `new BucketFailoverHandlerImpl(profileBuckets, providerName, this, requestMetadata)`
- `authenticateMultipleBuckets` (line 2825): `new BucketFailoverHandlerImpl(buckets, providerName, this, requestMetadata)`

After extraction, these methods live in `TokenAccessCoordinator` and `AuthFlowOrchestrator` respectively, where `this` is NOT the `OAuthManager` facade. `BucketFailoverHandlerImpl` calls `.getSessionBucket()`, `.setSessionBucket()`, `.getOAuthToken()`, `.authenticate()` on the passed instance.

**Solution:** Define a narrow interface for the subset of `OAuthManager` that `BucketFailoverHandlerImpl` needs, and have both `TokenAccessCoordinator` and `AuthFlowOrchestrator` receive a reference satisfying this interface (the facade itself). The facade passes itself when constructing these sub-modules:

```typescript
// In types.ts:
export interface BucketFailoverOAuthManagerLike {
  getSessionBucket(provider: string, metadata?: OAuthTokenRequestMetadata): string | undefined;
  setSessionBucket(provider: string, bucket: string, metadata?: OAuthTokenRequestMetadata): void;
  getOAuthToken(providerName: string, bucket?: string): Promise<OAuthToken | null>;
  authenticate(providerName: string, bucket?: string): Promise<void>;
  authenticateMultipleBuckets(providerName: string, buckets: string[], requestMetadata?: OAuthTokenRequestMetadata): Promise<void>;
  getTokenStore(): TokenStore;
}
// NOTE: getOAuthToken uses `bucket?: string` (not `string | unknown`) because BucketFailoverHandlerImpl
// only ever passes string bucket names. The facade's implementation still accepts the wider type internally.
// This interface also depends on OAuthToken, TokenStore, and OAuthTokenRequestMetadata — all re-exported
// from types.ts, so no additional imports are needed for consumers of this interface.
```

**Why `authenticateMultipleBuckets` and `getTokenStore` are required:** AST grep of `BucketFailoverHandlerImpl.ts` reveals 19 call sites on `this.oauthManager`:
- `getSessionBucket` (3 sites) — bucket cursor sync
- `setSessionBucket` (7 sites) — session state updates on failover
- `getOAuthToken` (5 sites) — token retrieval/refresh during failover
- `authenticate` (1 site) — Pass 3 foreground reauth
- `authenticateMultipleBuckets` (1 site) — `ensureBucketsAuthenticated()` at line 612
- `getTokenStore` (2 sites) — direct disk token reads at lines 172, 259 for classification

All 6 methods must be on the interface for `BucketFailoverHandlerImpl` to compile against it.

`TokenAccessCoordinator` and `AuthFlowOrchestrator` store this reference and pass it when constructing `BucketFailoverHandlerImpl`. The facade passes `this` when creating the sub-modules. `BucketFailoverHandlerImpl.ts` is updated to import `BucketFailoverOAuthManagerLike` instead of `type { OAuthManager }`.

**Alternative:** Keep the `type { OAuthManager }` import as-is and simply pass the facade reference through. Both approaches work; the narrow interface is cleaner but adds a type to maintain.

## Lock Semantic Preservation Checklist

The following lock patterns MUST be preserved exactly during extraction. Any change to acquisition order, timeout values, or error propagation is a regression:

1. **Bucket resolution lock** (`withBucketResolutionLock`, lines 270-300): Serializes concurrent `getOAuthToken` calls for the same provider using a promise chain. Moves to TokenAccessCoordinator.

2. **Auth lock** (acquired via `tokenStore.acquireAuthLock`, released via `tokenStore.releaseAuthLock`): Used in `authenticate` (line 374) with `waitMs: 60000, staleMs: 360000`. Must maintain the disk-check-under-lock + TOCTOU double-check pattern. Moves to AuthFlowOrchestrator.

3. **Refresh lock** (acquired via `tokenStore.acquireRefreshLock`, released via `tokenStore.releaseRefreshLock`): Used in multiple locations with DIFFERENT timing parameters:
   - `authenticate` inner refresh (line 429): `waitMs: 10000, staleMs: 30000` → AuthFlowOrchestrator
   - `getToken` disk-check path (line 947): `waitMs: 5000, staleMs: 30000` → TokenAccessCoordinator
   - `getOAuthToken` (line 1297): `waitMs: 10000, staleMs: 30000` → TokenAccessCoordinator
   - `runProactiveRenewal` (line 1595): `waitMs: 10000, staleMs: 30000` → ProactiveRenewalManager
   Each location's exact `waitMs`/`staleMs` values must be preserved during extraction. Note: `getToken` uses shorter `waitMs: 5000` because it's on the hot path and should not block user interaction for too long.

4. **Lock acquisition order**: `authenticate` acquires auth-lock FIRST (`acquireAuthLock` at line 374), THEN conditionally acquires refresh-lock (`acquireRefreshLock` at line 429) inside the auth-lock scope. This nesting order prevents deadlocks and must be preserved in AuthFlowOrchestrator.

5. **Error propagation**: Auth lock failure in `authenticate` throws an error if no valid disk token exists (line 398-401). Refresh lock failures generally fall through gracefully. Each module must preserve its specific error handling pattern.

6. **Cross-module lock integration test (Phase 11):** Add at least one integration-level race test that exercises the full lock acquisition sequence across module boundaries. Specifically: concurrent `getToken` + `authenticate` calls on the same provider/bucket, verifying that (a) auth-lock serializes authenticate calls, (b) refresh-lock contention between `getOAuthToken` (TokenAccessCoordinator) and `runProactiveRenewal` (ProactiveRenewalManager) resolves without deadlock, and (c) `getToken`'s shorter `waitMs: 5000` refresh lock times out gracefully when a longer `authenticate` refresh is in progress. This test must run against the real extracted modules (not mocks) with an in-memory TokenStore stub, to catch any lock acquisition order or timing regressions introduced by the decomposition.

7. **Lock-order assertion test (Phase 6):** Add a test in `AuthFlowOrchestrator` that instruments `tokenStore.acquireAuthLock` and `tokenStore.acquireRefreshLock` with call-order tracking spies, then calls `authenticate()`. Assert that `acquireAuthLock` is called BEFORE `acquireRefreshLock` on every code path. This catches any accidental reordering during decomposition that could introduce deadlocks.

8. **Lock-release-on-exception assertions (Phases 5, 6):** After decomposition, add tests for each extracted module that acquires locks to verify locks are released on error paths. Specifically: (a) `TokenAccessCoordinator.getOAuthToken` — force an exception after refresh-lock acquired → assert `releaseRefreshLock` called in finally; (b) `AuthFlowOrchestrator.authenticate` — force exception after auth-lock acquired → assert `releaseAuthLock` called; (c) same for nested refresh-lock inside auth-lock scope. These catch any finally-block regression during method decomposition.

9. **Constructor purity invariant (Phase 9):** Add a test that constructs `OAuthManager` with spy-instrumented sub-module factories and verifies that NO method calls flow through the `facadeRef` during construction. Specifically: the `getOAuthToken` and `authenticateMultipleBuckets` spies on `facadeRef` must have zero calls after `new OAuthManager(...)` completes. This prevents partially-initialized `this` access hazards.

## Core Package Import Map per Extracted Module

Each extracted module needs specific imports from `@vybestack/llxprt-code-core`. This section documents them to prevent compilation failures during extraction. The current oauth-manager.ts imports all of these at lines 10-20; after extraction each module imports only what it needs.

| Module | Core Imports |
|--------|-------------|
| `types.ts` | `OAuthToken`, `AuthStatus`, `TokenStore`, `KeyringTokenStore` (existing re-exports), plus `OAuthTokenRequestMetadata` (re-exported as `export type` — used by `BucketFailoverOAuthManagerLike` and `AuthenticatorInterface` in this same file, and by consumers like `OAuthBucketManager` and `TokenAccessCoordinator`) |
| `auth-utils.ts` | `import type { OAuthTokenRequestMetadata }` — can come from `./types.js` (after Phase 1 adds the re-export) or directly from core; `import type { OAuthProvider }` from `./types.js` (for `unwrapLoggingProvider<T extends OAuthProvider \| undefined>` generic constraint). No value imports from core needed — all functions are pure runtime logic using only their parameters. |
| `profile-utils.ts` | `ProfileManager` (dynamic import) |
| `provider-registry.ts` | `DebugLogger` from `@vybestack/llxprt-code-core`; also `LoadedSettings`, `SettingScope` from `../config/settings.js` (CLI-internal, NOT core package) |
| `proactive-renewal-manager.ts` | `DebugLogger`, `mergeRefreshedToken`, `OAuthTokenWithExtras`; also imports `OAuthToken`, `TokenStore` from `./types.js` and `OAuthProvider` from `./types.js` (via constructor callback return type) |
| `token-access-coordinator.ts` | `DebugLogger`, `Config`, `mergeRefreshedToken`, `OAuthTokenRequestMetadata`, `OAuthTokenWithExtras`, `debugLogger`; NOTE: does NOT need `MessageBus` (moved to AuthFlowOrchestrator) |
| `auth-flow-orchestrator.ts` | `DebugLogger`, `mergeRefreshedToken`, `OAuthTokenRequestMetadata`, `OAuthTokenWithExtras`, `debugLogger`, `MessageBus`, `Config` |
| `auth-status-service.ts` | `DebugLogger`, `flushRuntimeAuthScope`; type-only: `OAuthTokenRequestMetadata`, `OAuthToken`, `AuthStatus` (all three are type aliases / interfaces — used only in type positions, never constructed via `new`) |
| `provider-usage-info.ts` | `DebugLogger`, `getSettingsService`, `Config`; also needs type `LoadedSettings` from `../config/settings.js` (for `getHigherPriorityAuth` parameter); dynamic imports: `fetchAnthropicUsage`, `fetchCodexUsage`, `fetchGeminiQuota` (each imported inline in their respective function bodies, not at module top level) |

**Critical note:** `mergeRefreshedToken` and `OAuthTokenWithExtras` are used in 4 locations across 3 modules (ProactiveRenewalManager line 1658, TokenAccessCoordinator lines 988 and 1353, AuthFlowOrchestrator line 458). Each of these modules MUST import both symbols from core. The `as OAuthTokenWithExtras` cast pattern (e.g., `currentToken as OAuthTokenWithExtras`) must be preserved exactly — it enables `mergeRefreshedToken` to access extended token fields beyond the base `OAuthToken` interface.

**Import style note:** `OAuthTokenWithExtras` is used ONLY in `as` cast expressions (e.g., `currentToken as OAuthTokenWithExtras`), which are erased at compile time. Therefore it MUST be imported with `import type` (or via inline `type` in the import specifier: `import { type OAuthTokenWithExtras, mergeRefreshedToken } from ...`). The source already uses `type OAuthTokenWithExtras` at line 18. Each extracted module must preserve this `type`-only import to satisfy `isolatedModules`/`verbatimModuleSyntax` if enabled.

## TypeScript-Specific Concerns

This section documents cross-cutting TypeScript concerns that apply across multiple phases.

### 1. `type` vs Value Imports

The current oauth-manager.ts uses inline `type` annotations in its core import (line 17-18):
```typescript
type OAuthTokenRequestMetadata,
type OAuthTokenWithExtras,
```

When redistributing imports to extracted modules:
- **`OAuthTokenWithExtras`** — always `import type` (only used in `as` casts, never at runtime)
- **`OAuthTokenRequestMetadata`** — always `import type` (only used in parameter/return type positions and in `hasRequestMetadata` type predicate return type — never as a runtime value)
- **`OAuthToken`** — value import from `./types.js` (used at runtime: constructed, compared, properties accessed)
- **`AuthStatus`** — `import type` everywhere (it's a Zod-inferred type alias `z.infer<typeof AuthStatusSchema>`, not a class; objects satisfying it are plain object literals)
- **`TokenStore`** — value import where `instanceof` checks or runtime construction occurs; `import type` where used only as parameter/field type annotation (e.g., `OAuthBucketManager` already uses `import type { TokenStore }`)
- **`Config`**, **`MessageBus`** — value imports (used as constructor parameters, method calls made on instances)
- **`DebugLogger`** — value import (instantiated with `new DebugLogger(...)`)
- **`mergeRefreshedToken`** — value import (called at runtime)
- **`flushRuntimeAuthScope`** — value import (called at runtime)
- **`getSettingsService`** — value import (called at runtime)
- **`debugLogger`** — value import (the singleton instance, called with `.log()`)

Each extracted module should follow the existing project convention observed in `OAuthBucketManager.ts` and test files: use `import type` where the import is type-position-only.

### 2. `OAuthProvider` Import Split: Value vs Type

Test files that `import { OAuthProvider }` from `oauth-manager.js` fall into two categories:
- **Value usage** (needs value import): Files that use `implements OAuthProvider` in mock class declarations (e.g., `oauth-manager.spec.ts` line 25: `class MockOAuthProvider implements OAuthProvider`). TypeScript requires a value import for `implements` even though it's erased at runtime, because the interface must be resolvable. However, TypeScript interfaces CAN use `import type` with `implements` — the `implements` clause is purely a compile-time check. So `import type { OAuthProvider }` works with `implements OAuthProvider`.
- **Type-only usage**: Files that use `type OAuthProvider` in the import (e.g., `oauth-manager.auth-lock.spec.ts` line 11: `import { OAuthManager, type OAuthProvider }`).

**Resolution:** Since `OAuthProvider` is an interface (not a class), `import type { OAuthProvider }` works in ALL positions including `implements`. All consumer updates in Phase 1 can use `import type { OAuthProvider } from './types.js'` uniformly. If the project's `tsconfig.json` has `verbatimModuleSyntax: true`, this is mandatory for type-only imports. Verify the tsconfig setting before Phase 1 implementation.

### 3. Dual `sessionBuckets` Map — OAuthManager vs OAuthBucketManager

**Critical finding:** `OAuthManager` (line 229) and `OAuthBucketManager` (line 25) each maintain their own independent `sessionBuckets: Map<string, string>`. `OAuthManager` does NOT currently use `OAuthBucketManager` at all — `OAuthBucketManager` is only consumed in its own test file. These are two parallel, unconnected implementations.

Phase 4 must CONSOLIDATE these into a single `sessionBuckets` Map owned by `OAuthBucketManager`. The existing `OAuthBucketManager.setSessionBucket(provider, bucket)` (no metadata parameter) must be replaced with the metadata-aware version from `OAuthManager`. The `OAuthBucketManager.resolveBucket()` method (lines 59-70) may also need updating since the new metadata-scoped session lookup changes resolution semantics. Existing `OAuthBucketManager.spec.ts` tests for the simple session bucket API must be updated to match the new metadata-aware signatures.

### 4. `AuthenticatorInterface` — Definitive Placement

The plan's Phase 5 shows `AuthenticatorInterface` defined "in types.ts (or at the top of token-access-coordinator.ts)". This should be `types.ts` definitively, because:
- It references `OAuthTokenRequestMetadata` which is re-exported from `types.ts`
- It's implemented by `AuthFlowOrchestrator` and consumed by `TokenAccessCoordinator` — placing it in either module's file would create a coupling; `types.ts` is the neutral ground
- It parallels `BucketFailoverOAuthManagerLike` which is also in `types.ts`

### 5. `ProfileManagerCtor` Type Alias Preservation

The `ProfileManagerCtor` type at line 103-104 uses the TypeScript-specific `typeof import(...)` pattern:
```typescript
type ProfileManagerCtor = (typeof import('@vybestack/llxprt-code-core'))['ProfileManager'];
```
This is a compile-time-only construct that extracts the constructor type via a dynamic import type. When moved to `profile-utils.ts`, this pattern must be preserved exactly — it cannot be simplified to a regular import because the actual `import('@vybestack/llxprt-code-core')` happens at runtime inside `getProfileManagerCtor()`, not at module load time. The type alias provides type safety for the cached promise without pulling in the core package as a static dependency.

### 6. Core Import Map Correction

The `provider-registry.ts` row in the Core Package Import Map incorrectly lists `LoadedSettings` and `SettingScope` as if they come from `@vybestack/llxprt-code-core`. They actually come from `../config/settings.js` (a CLI package module, line 8 of oauth-manager.ts). This is a CLI-internal import, not a core import.

### 7. `BucketFailoverOAuthManagerLike` Interface — Signature Simplification

The proposed `BucketFailoverOAuthManagerLike.getOAuthToken` parameter is `bucket?: string | unknown`. While this matches the `OAuthManager.getOAuthToken` signature, `BucketFailoverHandlerImpl` only ever passes string bucket names (never `OAuthTokenRequestMetadata` objects). The interface can use the narrower `bucket?: string` since it defines the contract for `BucketFailoverHandlerImpl`'s usage, not the full `OAuthManager` API. This makes the interface self-documenting. The facade's implementation method still accepts the wider type internally.

## Test Strategy

**Hybrid approach** appropriate for a refactoring task:

1. **Behavior lock:** All 33 existing test files (21,430 lines) serve as integration-level behavior tests through `OAuthManager`'s public API. They MUST pass at every phase. No assertions change.

2. **New unit tests per extracted module:** Written BEFORE the extraction code. Focus on the public API of each new class/module, validating isolated behavior.

3. **Import/compile verification:** Each phase runs `npm run typecheck` first to verify import graph, then `npm run test`.

4. **Per-phase line count enforcement:** Every phase that creates or modifies a file runs `wc -l` on that file to confirm it stays under 800 lines. This prevents drift toward God Object recurrence.

5. **Golden tests for sensitive areas:**
   - Session bucket scoping: test exact key generation (`"provider"` vs `"provider::profileId"`) and fallback precedence (scoped → profile → unscoped)
   - Lock behavior: test that lock parameters (waitMs/staleMs) are preserved
   - Gemini regularization: test provider-override `isAuthenticated` path (G1), test logout doesn't do filesystem ops (G2), test `clearAuth?.()` called generically (G3), test no `USE_EXISTING_GEMINI_OAUTH` special-casing (G4)

## Implementation Phases

Each phase is delegated to `typescriptexpert` for implementation then `deepthinker` for verification. Phases must be executed in order — each builds on the previous.

---

### Phase 1: Extract Type Layer and Utility Modules

**Goal:** Move interfaces into `types.ts` (preserving existing re-exports) and create two new utility modules: `auth-utils.ts` for provider/auth helpers and `profile-utils.ts` for profile resolution helpers. This is a prerequisite for all subsequent extractions.

**Test-first steps:**
1. Identify all test files that import `OAuthProvider` or `OAuthManagerRuntimeMessageBusDeps` from `./oauth-manager.js`
2. Update those test imports to use `./types.js` (and `../auth-utils.js` for `unwrapLoggingProvider`) **before** moving production symbols
3. Run `npm run typecheck` / `npm run test` and capture expected RED failures (missing exports from new locations)
4. Move interfaces/functions in production code and update all production consumers to new modules (`types.ts`, `auth-utils.ts`, `profile-utils.ts`)
5. Re-run `npm run typecheck` / `npm run test` to GREEN

> Phase 1 sequencing note: import rewiring and production symbol moves happen in a single cohesive phase (single PR/commit unit). There is no requirement that the code compiles between steps 2 and 4; RED is expected until the move is completed.
>
> Execution safety: perform Phase 1 on the feature branch only; do not push or merge intermediate RED commits. Only phase-end GREEN (typecheck + tests) is eligible for commit.

**What moves to `types.ts` (added alongside existing re-exports):**

Current `types.ts` re-exports `OAuthToken`, `AuthStatus`, `TokenStore`, `KeyringTokenStore` from core. These stay. Added:
- `OAuthProvider` interface (oauth-manager.ts lines 187-220) **with one addition:** optional `isAuthenticated?(): Promise<boolean>` method (Gemini regularization G1 — allows providers to override the default token-store-based auth check without hardcoding provider names in the manager)
- `OAuthManagerRuntimeMessageBusDeps` interface (oauth-manager.ts lines 22-25)

**What moves to `auth-utils.ts` (new file, runtime utility functions):**
- `unwrapLoggingProvider<T>()` function (lines 74-97)
- `isLoggingWrapperCandidate()` predicate (lines 48-54) — private helper for `unwrapLoggingProvider`, not exported
- `hasRequestMetadata()` predicate (lines 58-67) — used by `getOAuthToken` (→ TokenAccessCoordinator in Phase 5) and by `clearProviderAuthCaches` indirectly. Kept in auth-utils.ts as a shared utility since it's consumed by multiple modules.
- `isAuthOnlyEnabled()` function (lines 32-45) — only used by `getHigherPriorityAuth` (→ provider-usage-info.ts in Phase 8); kept in auth-utils.ts to avoid circular dependencies since provider-usage-info.ts should not import from token-access-coordinator.ts

**What moves to `profile-utils.ts` (new file, profile resolution helpers):**
- `getProfileManagerCtor()` (lines 108-117)
- `createProfileManager()` (lines 120-125)
- `isLoadBalancerProfileLike()` (lines 127-140)
- `getOAuthBucketsFromProfile()` (lines 143-181)
- The `ProfileManagerCtor` type alias (lines 103-104)
- The module-level `let profileManagerCtorPromise` variable (line 106) — this is a cached dynamic import promise used by `getProfileManagerCtor()`. It becomes module-level state in `profile-utils.ts`, which is correct behavior (caching the dynamic import resolution).

These are consumed by both `ProactiveRenewalManager` (Phase 3) and `TokenAccessCoordinator` (Phase 5), so they must be in a shared module.

**Consumer import updates (production):**
- `migration.ts` — `OAuthProvider` from `./types.js`
- All 4 OAuth provider files — `OAuthProvider` from `./types.js`
- `providerManagerInstance.ts` — `OAuthManagerRuntimeMessageBusDeps` from `./types.js`

**Consumer import updates (tests):**
- `__tests__/oauthManager.safety.test.ts` — `unwrapLoggingProvider` from `../auth-utils.js`, type `OAuthProvider` from `../types.js`
- All 14+ test files importing `OAuthProvider` from `oauth-manager.js` — update to `./types.js` (or leave importing from `oauth-manager.js` if they also import `OAuthManager` class, since `OAuthProvider` will no longer be re-exported from there — they must switch to `./types.js`)

**TypeScript-specific notes:**
- `unwrapLoggingProvider<T>` currently has generic constraint `T extends OAuthProvider | undefined`. However, `clearProviderAuthCaches` uses it on core `BaseProvider` instances (not CLI `OAuthProvider`). The constraint should be broadened to `T extends { name: string } | undefined` — the only property `unwrapLoggingProvider` actually accesses on the unwrapped result is `name` (and `wrappedProvider` via duck typing). This broader constraint allows the function to work with both CLI `OAuthProvider` and core `BaseProvider` instances without unsafe casting. `auth-utils.ts` then needs `import type { OAuthProvider }` only if other functions in the module reference it — `unwrapLoggingProvider` itself no longer needs it.
- `auth-utils.ts` needs `import type { OAuthTokenRequestMetadata } from '@vybestack/llxprt-code-core'` for the `hasRequestMetadata` type predicate's return type (`handler is { getRequestMetadata: () => OAuthTokenRequestMetadata | undefined }`). This is a structural type predicate — the narrowed type is inlined, not a named interface reference. The `OAuthTokenRequestMetadata` import is type-only.
- `OAuthProvider` is a TypeScript interface (not a class), so `import type { OAuthProvider }` works everywhere, including `implements OAuthProvider` in mock test classes and production provider implementations. All Phase 1 consumer updates (both production and test files) can uniformly use `import type { OAuthProvider } from './types.js'`. Verify the project's `tsconfig.json` for `verbatimModuleSyntax` or `isolatedModules` settings before implementation — if either is enabled, type-only imports are mandatory for interface-only symbols.

**oauth-manager.ts changes:**
- Remove the moved interfaces/functions/helpers
- Import them from `./types.js`, `./auth-utils.js`, `./profile-utils.js`
- Do NOT re-export them
- `SettingScope` import from `../config/settings.js` stays (used by `setOAuthEnabledState`)

**Verification:** `npm run typecheck && npm run test`

**Phase 1 exit gate — repo-wide import search to confirm migration complete:**
```bash
# Must return ZERO results (no remaining imports of OAuthProvider from oauth-manager)
grep -rn "OAuthProvider" --include='*.ts' packages/cli/src/ | grep -v node_modules | grep -v dist | grep "from.*oauth-manager"
# Must return ZERO results
grep -rn "OAuthManagerRuntimeMessageBusDeps" --include='*.ts' packages/cli/src/ | grep -v node_modules | grep -v dist | grep "from.*oauth-manager"
# Must return ZERO results
grep -rn "unwrapLoggingProvider" --include='*.ts' packages/cli/src/ | grep -v node_modules | grep -v dist | grep "from.*oauth-manager"
# HARD GATE: types.ts must remain a dependency leaf (no imports from extracted auth modules)
grep -rn "from.*provider-registry\|from.*token-access\|from.*auth-flow\|from.*auth-status\|from.*proactive-renewal\|from.*provider-usage\|from.*oauth-provider-base" packages/cli/src/auth/types.ts
```

**Phase-local cycle check (after Phase 1):**
```bash
npx madge --circular --extensions ts packages/cli/src/auth/
```
Must report zero cycles before moving to Phase 2.

**Subagent delegation:**
- `typescriptexpert`: Implement Phase 1 (test import updates first, then production moves, run import gates above, run full verification suite: `npm run test && npm run lint && npm run typecheck && npm run format && npm run build`)
- `deepthinker`: Review — verify types.ts preserves existing re-exports, auth-utils.ts has only runtime functions, profile-utils.ts has only profile helpers, import gates pass

---

### Phase 2: Extract Provider Registry → `provider-registry.ts`

**Goal:** Extract provider registration, discovery, and enabled-state management into a cohesive class. This has no dependencies on other new modules.

**Test-first steps:**
1. Write unit tests for `ProviderRegistry` in `packages/cli/src/auth/__tests__/provider-registry.spec.ts`:
   - `registerProvider` stores and retrieves providers by name
   - `registerProvider` rejects null/undefined provider
   - `registerProvider` rejects provider without valid name
   - `registerProvider` rejects provider missing `initiateAuth`/`getToken`/`refreshToken` methods (runtime duck-type validation — preserves existing validation at lines 326-336)
   - `getProvider` returns undefined for unknown providers
   - `getSupportedProviders` returns all registered provider names
   - `toggleOAuthEnabled` flips state and persists to settings
   - `isOAuthEnabled` reads from settings then falls back to in-memory state
   - `setOAuthEnabledState` sets in-memory state directly
   - Handles case where settings are undefined (in-memory only)
   - `hasExplicitInMemoryOAuthState` returns true only when explicitly set
2. Run tests (RED — ProviderRegistry doesn't exist yet)
3. Implement `ProviderRegistry`
4. Run tests (GREEN)
5. Update oauth-manager.ts to compose `ProviderRegistry` internally
6. All existing tests pass

**What moves:**
- State: `providers` Map, `inMemoryOAuthState` Map
- Methods: `registerProvider`, `getProvider`, `getSupportedProviders`, `toggleOAuthEnabled`, `isOAuthEnabled`, `setOAuthEnabledState`
- Exposes: `hasExplicitInMemoryOAuthState(providerName)` — used by `getToken()` logic

**TypeScript-specific notes:**
- `toggleOAuthEnabled` is declared `async` returning `Promise<boolean>` but contains no `await`. The `ProviderRegistry` version should be synchronous (`toggleOAuthEnabled(...): boolean`) since the class owns the logic. The facade preserves the original `async` signature for backward compatibility — callers that `await manager.toggleOAuthEnabled(...)` continue to work since awaiting a non-Promise value is a no-op. The facade simply returns the sync result (TypeScript allows returning `T` from an `async` function that returns `Promise<T>`).
- `setOAuthEnabledState` uses `SettingScope.User` from `'../config/settings.js'` — the ProviderRegistry must import both `LoadedSettings` and `SettingScope` from `../config/settings.js`. These are CLI-internal types, NOT from `@vybestack/llxprt-code-core`. `LoadedSettings` is a class (value import needed since it's used as a parameter type AND its `.merged` / `.setValue()` properties are accessed at runtime). `SettingScope` is an enum (value import needed since enum members are runtime values).
- `OAuthProvider` interface must be imported as `import type { OAuthProvider } from './types.js'` (moved in Phase 1). It's used only in the `Map<string, OAuthProvider>` field type and `registerProvider` parameter type — all type positions.

**Constructor:**
```typescript
import { LoadedSettings, SettingScope } from '../config/settings.js';
import type { OAuthProvider } from './types.js';

constructor(private settings?: LoadedSettings)
```

**Estimated size:** ~200 lines

**Phase 2 exit gate (mandatory):**
- New `provider-registry.spec.ts` passes
- Existing oauth-manager/provider registration tests pass unchanged
- `toggleOAuthEnabled` facade method parity preserved (`Promise<boolean>` signature at facade)
- No direct `providers`/`inMemoryOAuthState` map access remains in facade logic outside registry delegation

**Subagent delegation:**
- `typescriptexpert`: Implement Phase 2 (new tests first, then extraction, then facade wiring, run full verification suite)
- `deepthinker`: Review — verify SoC boundaries, DI pattern, existing tests pass

---

### Phase 3: Extract Proactive Renewal Manager → `proactive-renewal-manager.ts`

**Goal:** Extract all proactive token renewal logic — timers, backoff, scheduling, profile configuration — into a self-contained class. Uses `profile-utils.ts` for profile resolution.

**Test-first steps:**
1. Existing test file `__tests__/oauthManager.proactive-renewal.test.ts` (504 lines) tests renewal via OAuthManager — must continue passing through facade.
2. Write unit tests for `ProactiveRenewalManager` in `packages/cli/src/auth/__tests__/proactive-renewal-manager.spec.ts`:
   - `scheduleProactiveRenewal` calculates correct delay from token expiry
   - `scheduleProactiveRenewal` skips tokens with no refresh_token
   - `scheduleProactiveRenewal` skips entirely when `LLXPRT_CREDENTIAL_SOCKET` env var is set (proxy mode — host process handles refresh)
   - `runProactiveRenewal` refreshes token via provider and persists result
   - `runProactiveRenewal` handles refresh failure with retry backoff
   - `runProactiveRenewal` preserves refresh lock parameters (waitMs: 10000, staleMs: 30000)
   - Retry backoff caps at `MAX_PROACTIVE_RENEWAL_FAILURES` then stops
   - `clearAllTimers` cancels all scheduled renewals
   - `clearProactiveRenewal` removes a single renewal entry
   - `configureProactiveRenewalsForProfile` schedules for each bucket in profile
   - `configureProactiveRenewalsForProfile` handles load-balancer profiles recursively
3. Run tests (RED)
4. Implement `ProactiveRenewalManager` (importing from `./profile-utils.js`)
5. Run tests (GREEN)
6. Wire into oauth-manager.ts constructor

**What moves:**
- State: `proactiveRenewals` Map, `proactiveRenewalFailures` Map, `proactiveRenewalInFlight` Set, `proactiveRenewalTokens` Map
- Methods: `scheduleProactiveRenewal` (public — called by TokenAccessCoordinator), `runProactiveRenewal`, `setProactiveTimer`, `clearProactiveRenewal`, `scheduleProactiveRetry`, `getProactiveRenewalKey`, `configureProactiveRenewalsForProfile`, `normalizeBucket` (all 5 call sites are in renewal methods)
- Constant: `MAX_PROACTIVE_RENEWAL_FAILURES`
- **New methods (not in source):**
  - `clearAllTimers()`: Iterates `proactiveRenewals`, calls `clearTimeout` on each, clears all maps/sets. Needed for lifecycle cleanup when OAuthManager is destroyed.
  - `clearRenewalsForProvider(providerName: string, bucket?: string)`: Clears proactive renewal(s) matching the given provider (and optionally bucket). Called by `AuthStatusService.logout()` — this is a behavioral improvement (current code does NOT cancel renewal timers on logout).

**Constructor:**
```typescript
import type { OAuthProvider } from './types.js';
import type { OAuthTokenWithExtras } from '@vybestack/llxprt-code-core';
import { DebugLogger, mergeRefreshedToken } from '@vybestack/llxprt-code-core';
import { OAuthToken, TokenStore } from './types.js';

constructor(
  private tokenStore: TokenStore,
  private getProvider: (name: string) => OAuthProvider | undefined,
  private isOAuthEnabled: (name: string) => boolean,
)
```

**TypeScript-specific:** The constructor uses callback-based DI rather than importing `ProviderRegistry` — this avoids a module-level dependency and keeps the dependency graph clean. The callback types (`(name: string) => OAuthProvider | undefined` and `(name: string) => boolean`) are inlined in the constructor signature. `OAuthProvider` appears only in the return type of the callback, so it's a type-position-only import. `mergeRefreshedToken` is a value import (called at runtime in `runProactiveRenewal` line 1657). `OAuthTokenWithExtras` is type-only (used only in `as` casts).

**Method decomposition for 80-line limit:**
- `runProactiveRenewal` (118 lines) → `acquireRefreshLock` + `performTokenRefresh` + `handleRefreshFailure` (each ≤80 lines)

**Estimated size:** ~350 lines

**Phase 3 exit gate (mandatory):**
- New `proactive-renewal-manager.spec.ts` passes
- Existing `oauthManager.proactive-renewal.test.ts` passes unchanged through facade
- `MAX_PROACTIVE_RENEWAL_FAILURES` constant migrated and enforced in tests
- `clearAllTimers` and `clearRenewalsForProvider` behavior covered by tests
- Refresh-lock parameter test (`waitMs: 10000`, `staleMs: 30000`) passes

**Subagent delegation:**
- `typescriptexpert`: Implement Phase 3 (new tests first, extract, decompose oversized methods, run full verification suite)
- `deepthinker`: Review — verify method sizes ≤80 lines, timer cleanup, lock parameters preserved, existing renewal tests pass

---

### Phase 4: Enhance `OAuthBucketManager.ts` with Metadata-Scoped Session Buckets

**Goal:** Extend OAuthBucketManager with metadata-scoped session bucket operations. These are simple Map operations with scoped key generation — no runtime/settings dependencies.

**Important boundary:** Profile-aware resolution (`getProfileBuckets`, `getCurrentProfileSessionBucket`, `getCurrentProfileSessionMetadata`) stays OUT of OAuthBucketManager because those methods depend on dynamic imports of `../runtime/runtimeSettings.js` and `createProfileManager()`. Those move to `TokenAccessCoordinator` in Phase 5.

**Critical: Dual `sessionBuckets` Map consolidation.** Currently, `OAuthManager` (line 229) and `OAuthBucketManager` (line 25) each maintain independent `sessionBuckets: Map<string, string>` instances. `OAuthManager` does NOT use `OAuthBucketManager` — they are parallel, unconnected implementations. This phase must:
1. Replace `OAuthBucketManager`'s simple session methods (`setSessionBucket(provider, bucket)`) with the metadata-aware versions from `OAuthManager` (`setSessionBucket(provider, bucket, metadata?)`)
2. Update `OAuthBucketManager.resolveBucket()` to account for metadata-scoped keys (or deprecate it if the new metadata-scoped resolution in `TokenAccessCoordinator.getCurrentProfileSessionBucket` supersedes it)
3. Update existing `OAuthBucketManager.spec.ts` tests whose assertions expect the old simple-key signatures
4. Ensure the facade creates a SINGLE `OAuthBucketManager` instance that becomes the sole owner of session bucket state — no more duplicate Maps

**Test-first steps:**
1. Existing test file `__tests__/OAuthBucketManager.spec.ts` (747 lines) covers current functionality — must continue passing.
2. Add new test cases to same file (golden tests for scoping semantics):
   - `setSessionBucket` with metadata stores with scoped key `"provider::profileId"`
   - `setSessionBucket` without metadata stores with key `"provider"`
   - `getSessionBucket` with metadata retrieves scoped value
   - `getSessionBucket` without metadata does NOT return scoped value (isolation)
   - `clearSessionBucket` with metadata removes only the scoped entry
   - `clearAllSessionBuckets` removes all entries matching provider prefix (both scoped and unscoped)
   - `getSessionBucketScopeKey("anthropic", undefined)` returns `"anthropic"`
   - `getSessionBucketScopeKey("anthropic", { profileId: "prod" })` returns `"anthropic::prod"`
   - `getSessionBucketScopeKey` trims whitespace and ignores empty profileId
3. Run tests (RED)
4. Replace existing simple session methods with metadata-aware versions
5. Run tests (GREEN)

**What moves into OAuthBucketManager:**
- The metadata-overloaded versions of `setSessionBucket`, `getSessionBucket`, `clearSessionBucket`, `clearAllSessionBuckets` from oauth-manager.ts (lines 2007-2078)
- `getSessionBucketScopeKey` helper (lines 2362-2373)

**TypeScript-specific:** The metadata-aware methods use `OAuthTokenRequestMetadata` as an optional parameter type. After Phase 1 adds `OAuthTokenRequestMetadata` as a re-export from `types.ts`, `OAuthBucketManager` should import it from there (keeping the existing `import type { TokenStore } from './types.js'` pattern and adding `OAuthTokenRequestMetadata` to the same import):
```typescript
import type { TokenStore, OAuthTokenRequestMetadata } from './types.js';
```
This avoids `OAuthBucketManager` needing a direct `@vybestack/llxprt-code-core` dependency — it stays one hop away via `types.ts`, matching its current import pattern.

The existing simple `set/get/clearSessionBucket` methods (which take only `provider: string`) are replaced by the metadata-aware versions. The `metadata` parameter is optional (`metadata?: OAuthTokenRequestMetadata`), preserving the simple call pattern for callers that don't use scoping.

**`resolveBucket` fate:** `resolveBucket(provider, profileBuckets?)` has **zero production callers** (confirmed via grep — only used in `OAuthBucketManager.spec.ts` tests). It uses the simple unscoped `sessionBuckets.get(provider)` lookup which is now superseded by the metadata-aware `getSessionBucket(provider, metadata?)`. **Decision: Remove `resolveBucket` entirely.** Its resolution logic (session → profile → default) is superseded by the more complete resolution chain in `TokenAccessCoordinator.getCurrentProfileSessionBucket` (Phase 5), which handles scoped session → profile fallback → unscoped session. Update `OAuthBucketManager.spec.ts` to remove the `resolveBucket` test block and add metadata-aware session tests as described above.

**API parity checklist (manager ↔ bucket manager):** Phase 4 must preserve behavior parity for these methods moved from `OAuthManager` lines 2007-2078 and 2362-2373:
- `setSessionBucket(provider, bucket, metadata?)`
- `getSessionBucket(provider, metadata?)`
- `clearSessionBucket(provider, metadata?)`
- `clearAllSessionBuckets(provider)`
- `getSessionBucketScopeKey(provider, metadata?)`

All five methods must preserve key format (`provider::profileId` for scoped metadata), unscoped fallback behavior, and in-memory-only semantics.

**What does NOT move here:**
- `getCurrentProfileSessionBucket` — depends on `getProfileBuckets` → Phase 5
- `getCurrentProfileSessionMetadata` — depends on runtime settings → Phase 5
- `getProfileBuckets` — depends on runtime settings + ProfileManager → Phase 5

**Estimated size:** ~230 lines (up from ~151)

**Phase 4 exit criteria (MANDATORY — Phase 5 must not start until ALL pass):**
- `bucketManager.setSessionBucket(provider, bucket, metadata?)` works
- `bucketManager.getSessionBucket(provider, metadata?)` works
- `bucketManager.clearSessionBucket(provider, metadata?)` works
- `bucketManager.clearAllSessionBuckets(provider)` works
- `bucketManager.getSessionBucketScopeKey(provider, metadata?)` works
- facade delegates correctly to bucket manager for all session ops
- **Golden test: bucket fallback precedence chain** — Given: scoped session set for providerA/profileX, unscoped session set for providerA → `getSessionBucket('providerA', metadataForProfileX)` returns scoped value; `getSessionBucket('providerA')` returns unscoped value; `getSessionBucket('providerA', metadataForProfileY)` returns undefined. This exact precedence chain must be preserved when Phase 5's `getCurrentProfileSessionBucket` consumes these methods.
- **`resolveBucket` removal gate (hard):** Before deletion, prove zero production callsites:
  ```bash
  grep -rn "\.resolveBucket\b" --include='*.ts' packages/cli/src/ | grep -v node_modules | grep -v dist | grep -v spec | grep -v test
  ```
  Must return empty. Then remove `resolveBucket` from `OAuthBucketManager` and remove corresponding tests.
  After deletion, run a second grep without exclusions and verify remaining hits are zero:
  ```bash
  grep -rn "resolveBucket" --include='*.ts' packages/cli/src/
  ```
- **Single session-bucket Map invariant:** After Phase 4, exactly ONE `sessionBuckets` Map exists in the system — owned by `OAuthBucketManager`. Verify both:
  ```bash
  grep -rn "private sessionBuckets" packages/cli/src/auth/oauth-manager.ts
  grep -rn "sessionBuckets" --include='*.ts' packages/cli/src/auth/ | grep -v node_modules | grep -v dist
  ```
  First command must return empty; second must show only `OAuthBucketManager` ownership plus call-sites using that instance (no duplicated map fields elsewhere).
- Full verification suite passes: `npm run test && npm run lint && npm run typecheck && npm run format && npm run build`

**Subagent delegation:**
- `typescriptexpert`: Implement Phase 4 (add golden tests to existing spec, implement, wire facade delegation, verify exit criteria, run full verification suite)
- `deepthinker`: Review — verify OAuthBucketManager has no runtime/settings dependencies, scoping semantics preserved exactly, golden tests cover fallback precedence, all exit criteria met

---

### Phase 5: Extract Token Access Coordinator → `token-access-coordinator.ts`

**Goal:** Extract token retrieval with its complex locking, TOCTOU defense, refresh coordination, and profile-aware bucket resolution into a dedicated class. This is the most complex extraction. Uses `profile-utils.ts` for profile resolution.

**Test-first steps:**
1. Multiple existing test files test token access through OAuthManager — all must continue passing:
   - `oauth-manager.token-reuse.spec.ts` (511 lines)
   - `oauth-manager.concurrency.spec.ts` (448 lines)
   - `oauth-manager.issue1317.spec.ts` (396 lines)
   - `__tests__/oauth-manager.getToken-bucket-peek.spec.ts` (440 lines)
   - `__tests__/oauth-manager.issue913.spec.ts` (377 lines)
   - `oauth-manager.refresh-race.spec.ts` (343 lines)
2. Write unit tests for `TokenAccessCoordinator` in `packages/cli/src/auth/__tests__/token-access-coordinator.spec.ts`:
   - `getOAuthToken` returns cached valid token without refresh
   - `getOAuthToken` acquires refresh lock before refreshing expired tokens (waitMs: 10000, staleMs: 30000)
   - `getOAuthToken` performs TOCTOU double-check after lock acquisition
   - `getOAuthToken` triggers refresh when token is within 30s of expiry
   - `getOAuthToken` persists merged token after refresh
   - `getOAuthToken` releases refresh lock on refresh-path exceptions (finally semantics)
   - `getToken` disk-check path acquires refresh lock with shorter timeout (waitMs: 5000, staleMs: 30000)
   - `getToken` disk-check path releases refresh lock on all error paths
   - `peekStoredToken` reads from store without locking
   - `withBucketResolutionLock` serializes concurrent calls for same provider
   - `getToken` returns null when provider not registered
   - `getToken` returns null when OAuth disabled via settings
   - `getToken` tries peek-other-buckets before triggering auth (issue1616 path)
   - `getToken` handles non-interactive mode (returns null without prompting)
   - `getToken` throws clear error when authenticator not set AND auth-required branch is reached (force test into interactive auth path with no authenticator wired)
   - `getToken` for multi-bucket profiles returns null without auth (issue1616 pure-lookup behavior, line 1037-1041)
   - `getProfileBuckets` returns buckets from loaded profile
   - `getProfileBuckets` returns empty when profile provider doesn't match (issue1468)
   - `getCurrentProfileSessionBucket` chains: scoped session → profile fallback → unscoped session
3. Run tests (RED)
4. Implement `TokenAccessCoordinator` (importing from `./profile-utils.js`)
5. Run tests (GREEN)

**Authenticator wiring safety:** Before `setAuthenticator()` is called, any code path in `getToken()` that would trigger authentication throws an explicit error:
```typescript
// In types.ts (alongside BucketFailoverOAuthManagerLike):
export interface AuthenticatorInterface {
  authenticate(providerName: string, bucket?: string): Promise<void>;
  authenticateMultipleBuckets(
    providerName: string,
    buckets: string[],
    requestMetadata?: OAuthTokenRequestMetadata,
  ): Promise<void>;
}

// In TokenAccessCoordinator:
private authenticator?: AuthenticatorInterface;

setAuthenticator(auth: AuthenticatorInterface): void {
  this.authenticator = auth;
}

private requireAuthenticator(): AuthenticatorInterface {
  if (!this.authenticator) {
    throw new Error('TokenAccessCoordinator: authenticator not wired — call setAuthenticator() first');
  }
  return this.authenticator;
}
```

`getToken()` calls both `this.authenticate()` (line 1080) and `this.authenticateMultipleBuckets()` (line 1065) — after extraction these become `this.requireAuthenticator().authenticate(...)` and `this.requireAuthenticator().authenticateMultipleBuckets(...)`. The `AuthFlowOrchestrator` implements `AuthenticatorInterface`.

**What moves:**
- State: `bucketResolutionLocks` Map
- Methods: `getToken`, `getOAuthToken`, `peekStoredToken`, `withBucketResolutionLock`
- Profile resolution methods: `getProfileBuckets`, `getCurrentProfileSessionBucket`, `getCurrentProfileSessionMetadata`

Note: `normalizeBucket` goes to ProactiveRenewalManager (Phase 3) where all 5 call sites reside. `requireRuntimeMessageBus` goes to AuthFlowOrchestrator (Phase 6) — its only call site is in `authenticateMultipleBuckets`.

**Gemini regularization G4 — Remove dead code:** The `getToken` method's catch block (lines 1096-1103) catches `Error('USE_EXISTING_GEMINI_OAUTH')` and returns null. Grep of the entire codebase confirms **nothing throws this error** — it is vestigial code from a removed Gemini flow. This catch block is NOT migrated to `TokenAccessCoordinator` — it is deleted. Add a test that `getToken` propagates Gemini errors normally (no special-casing).

**Phase 5 exit gate for G4 dead code removal:**
```bash
# Must return ZERO results — proves nothing in the codebase references this string anymore
grep -rn "USE_EXISTING_GEMINI_OAUTH" --include='*.ts' packages/ | grep -v node_modules | grep -v dist
```
**G4 regression test:** Add a test that `getToken('gemini')` propagates normal auth errors (e.g., `Error('auth failed')`) to the caller — i.e., no special error swallowing for Gemini. This proves the dead catch block was actually dead and its removal doesn't change observable behavior.

**Constructor:**
```typescript
import type { BucketFailoverOAuthManagerLike, AuthenticatorInterface } from './types.js';
import type { OAuthTokenRequestMetadata, OAuthTokenWithExtras } from '@vybestack/llxprt-code-core';
import { DebugLogger, Config, mergeRefreshedToken, debugLogger } from '@vybestack/llxprt-code-core';
import { hasRequestMetadata } from './auth-utils.js';

constructor(
  private tokenStore: TokenStore,
  private providerRegistry: ProviderRegistry,
  private proactiveRenewalManager: ProactiveRenewalManager,
  private bucketManager: OAuthBucketManager,
  private facadeRef: BucketFailoverOAuthManagerLike, // for BucketFailoverHandlerImpl construction
  private settings?: LoadedSettings,
  private config?: Config,
)
```

**TypeScript-specific:** `getOAuthToken` creates `BucketFailoverHandlerImpl(profileBuckets, providerName, this, requestMetadata)` at line 1228. After extraction, `this` must be replaced with `this.facadeRef` to pass the OAuthManager facade. The facade sets this via `new TokenAccessCoordinator(..., this, ...)`.

**Import dependency note:** `TokenAccessCoordinator` imports `hasRequestMetadata` from `./auth-utils.js` (value import — it's a function called at runtime in `getOAuthToken` line 1210). It also imports `BucketFailoverHandlerImpl` from `./BucketFailoverHandlerImpl.js` (value import — instantiated in `getOAuthToken`). `BucketFailoverOAuthManagerLike` and `AuthenticatorInterface` are `import type` (used only as field type annotations).

**`this.setSessionBucket` routing in `getToken`:** The source calls `this.setSessionBucket(...)` at lines 1072 and 1082 inside `getToken()`. After extraction, these must route through `this.bucketManager.setSessionBucket(...)` (NOT `this.facadeRef`), since `TokenAccessCoordinator` has direct access to the `OAuthBucketManager`. Similarly, `getOAuthToken` calls `this.setSessionBucket(...)` at line 1259 and `this.getSessionBucket(...)` at line 1177 — both route to `this.bucketManager`. This is correct because the facade's session bucket methods also delegate to the same `OAuthBucketManager` instance, so state stays consistent.

**Dynamic import in `getToken`:** `getToken()` dynamically imports `../runtime/runtimeSettings.js` at line 1048 to read `getEphemeralSetting('auth-bucket-prompt')`. This is NOT a core package import — it's a CLI runtime import. `TokenAccessCoordinator` must preserve this dynamic import pattern (no static import to avoid circular dependencies).

**Method decomposition for 80-line limit:**
- `getToken` (329 lines) → `attemptTokenRetrieval`, `peekOtherProfileBuckets`, `checkAuthNeeded`, `handleInteractiveAuthPrompt`, `handleNonInteractiveMode`
- `getOAuthToken` (277 lines) → `acquireTokenLock`, `checkDiskToken`, `attemptTokenRefresh`, `handleRefreshResult`, `setupFailoverHandler`
- `getProfileBuckets` (97 lines) → `resolveProfileName`, `loadAndValidateProfile`, `extractProfileBuckets`

**TypeScript signature preservation:** Both `getToken` and `getOAuthToken` have the parameter `bucket?: string | unknown`. In TypeScript's type system, `string | unknown` simplifies to `unknown`, but this deliberate signature allows callers to pass either a bucket name string or an `OAuthTokenRequestMetadata` object. The runtime discriminates via `typeof bucket === 'string'`. This signature must be preserved exactly — do not "clean it up" to `unknown` as the `string |` prefix provides documentation value and matches the core interface.

**Estimated size:** ~550 lines

**Subagent delegation:**
- `typescriptexpert`: Implement Phase 5 (new tests first including authenticator guard test, extract, decompose all oversized methods, run full verification suite)
- `deepthinker`: Review — verify locking correctness, TOCTOU preservation, method sizes ≤80 lines, lock parameters match original, authenticator guard works, profile resolution correct, `bucket?: string | unknown` signature preserved
- **Phase-local cycle check:** After Phase 5 completes, run `npx madge --circular --extensions ts packages/cli/src/auth/` and verify zero cycles. Phase 5 introduces the highest coupling risk (TokenAccessCoordinator ↔ facade self-reference, BucketFailoverHandlerImpl construction).

---

### Phase 6: Extract Auth Flow Orchestrator → `auth-flow-orchestrator.ts`

**Goal:** Extract authentication flow orchestration — the `authenticate` and `authenticateMultipleBuckets` methods with their complex locking, UI interaction, and stdin lifecycle management. Wire the `setAuthenticator` callback on `TokenAccessCoordinator`.

**Test-first steps:**
1. Existing test files that test auth flows through OAuthManager — all must continue passing:
   - `oauth-manager.auth-lock.spec.ts` (804 lines)
   - `oauth-manager.issue1468.spec.ts` (992 lines)
   - `__tests__/multi-bucket-auth.spec.ts` (1047 lines)
   - `oauth-manager.runtime-messagebus.spec.ts` (147 lines)
   - `__tests__/oauth-manager.user-declined.spec.ts` (247 lines)
2. Write unit tests for `AuthFlowOrchestrator` in `packages/cli/src/auth/__tests__/auth-flow-orchestrator.spec.ts`:
   - `authenticate` acquires auth lock via `acquireAuthLock` (waitMs: 60000, staleMs: 360000)
   - `authenticate` checks disk token under lock and returns early if valid
   - `authenticate` attempts refresh before browser flow
   - `authenticate` delegates to provider.initiateAuth when refresh fails
   - `authenticate` persists token after successful auth (proactive renewal is scheduled later by `getOAuthToken` when the token is next read — `authenticate` itself does NOT call `scheduleProactiveRenewal`)
   - `authenticate` enables OAuth for the provider via `setOAuthEnabledState` after successful auth
   - `authenticate` handles lock acquisition timeout gracefully
   - `authenticate` releases auth lock on all exception paths
   - `authenticate` releases nested refresh lock on refresh-path exceptions
   - `authenticateMultipleBuckets` filters to only unauthenticated buckets
   - `authenticateMultipleBuckets` handles stdin lifecycle correctly
   - `authenticateMultipleBuckets` respects user-declined dialog
3. Run tests (RED)
4. Implement `AuthFlowOrchestrator`
5. Run tests (GREEN)
6. Wire `setAuthenticator` in OAuthManager constructor:
   ```typescript
   this.tokenAccessCoordinator.setAuthenticator(this.authFlowOrchestrator);
   ```

**What moves:**
- State: `userDismissedAuthPrompt` flag (used only in `authenticateMultipleBuckets` onPrompt callback)
- Methods: `authenticate`, `authenticateMultipleBuckets`, `requireRuntimeMessageBus` (only call site is `authenticateMultipleBuckets` line 2613)

**Constructor:**
```typescript
import type { BucketFailoverOAuthManagerLike } from './types.js';
import type { OAuthTokenRequestMetadata, OAuthTokenWithExtras } from '@vybestack/llxprt-code-core';
import { DebugLogger, mergeRefreshedToken, debugLogger, MessageBus, Config } from '@vybestack/llxprt-code-core';

constructor(
  private tokenStore: TokenStore,
  private providerRegistry: ProviderRegistry,
  private bucketManager: OAuthBucketManager,
  private facadeRef: BucketFailoverOAuthManagerLike, // for BucketFailoverHandlerImpl construction
  private settings?: LoadedSettings,
  private config?: Config,
  private runtimeMessageBus?: MessageBus,
)
```

Note: `proactiveRenewalManager` is NOT needed here — neither `authenticate` nor `authenticateMultipleBuckets` call `scheduleProactiveRenewal` (proactive scheduling happens in `getOAuthToken` when the token is next read). `bucketManager` is not currently needed either (no session bucket operations in auth flows), but is retained for potential future use by `authenticateMultipleBuckets` callback wiring.

**TypeScript-specific:** `AuthFlowOrchestrator` implements `AuthenticatorInterface` (from `types.ts`). Add `implements AuthenticatorInterface` to the class declaration. This provides compile-time verification that the orchestrator satisfies the contract expected by `TokenAccessCoordinator.setAuthenticator()`. Both `MessageBus` and `Config` are value imports (instances stored and methods called on them at runtime). `mergeRefreshedToken` is a value import (called in `authenticate`'s refresh path). `debugLogger` is a value import (the singleton, `.log()` called in `authenticateMultipleBuckets`).

**TypeScript-specific:** `authenticateMultipleBuckets` creates `BucketFailoverHandlerImpl(buckets, providerName, this, requestMetadata)` at line 2822. After extraction, `this` must be replaced with `this.facadeRef`. `authenticate` calls `this.isOAuthEnabled()` and `this.setOAuthEnabledState()` — these delegate to `this.providerRegistry`.

**Method decomposition for 80-line limit:**
- `authenticate` (197 lines) → `acquireAuthLock`, `checkDiskUnderLock`, `attemptRefreshBeforeBrowser`, `delegateToProvider`, `persistTokenAndEnableOAuth`
- `authenticateMultipleBuckets` (340 lines) → `filterUnauthenticatedBuckets`, `setupAuthCallbacks`, `runMultiBucketAuthLoop`, `handleStdinLifecycle`, `createMultiBucketAuthenticator`

**Lock preservation:** `authenticate` acquires auth-lock THEN refresh-lock (lines 374, 429). This acquisition order must be preserved exactly.

**Estimated size:** ~500 lines (raw method bodies total 537 lines before decomposition overhead)

**Phase 6 exit gate (mandatory before Phase 9 facade cutover):**
- Lock-order assertion test passes (`acquireAuthLock` before `acquireRefreshLock`)
- Lock-release-on-exception tests pass for auth-lock and nested refresh-lock paths
- Timeout parameter assertions pass (`acquireAuthLock` 60000/360000, nested refresh lock 10000/30000)
- All existing auth-flow test files listed above pass unchanged

**Subagent delegation:**
- `typescriptexpert`: Implement Phase 6 (new tests first, extract, decompose all oversized methods, wire setAuthenticator, run full verification suite)
- `deepthinker`: Review — verify lock ordering preserved (auth-lock before refresh-lock), stdin cleanup correct, method sizes ≤80, setAuthenticator wired in facade constructor

---

### Phase 7: Extract Auth Status Service → `auth-status-service.ts`

**Goal:** Extract auth status queries and logout operations into a dedicated service.

**Test-first steps:**
1. Existing test files — must continue passing:
   - `oauth-manager.logout.spec.ts` (360 lines)
   - `oauth-manager-initialization.spec.ts` (279 lines)
   - `__tests__/oauthManager.safety.test.ts` (69 lines)
2. Write unit tests for `AuthStatusService` in `packages/cli/src/auth/__tests__/auth-status-service.spec.ts`:
   - `getAuthStatus` returns status for all registered providers
    - `isAuthenticated` checks token store for valid non-expired token
    - **`isAuthenticated` provider override: ONLY when `isOAuthEnabled(providerName)` is true AND provider has `isAuthenticated()`, defers to provider** (regularized from Gemini hardcode — now generic). When OAuth is NOT enabled for the provider, the override is NOT consulted — falls straight to token store check.
    - `isAuthenticated` with provider override returning false falls through to token store check
    - `isAuthenticated` without provider override uses token store check (default path)
    - `isAuthenticated` when OAuth disabled for a provider that HAS the override — still does token store check (override not consulted)
    - `getAuthStatusWithBuckets` includes session bucket information
    - `listBuckets` returns all known buckets for provider
    - `logout` clears token, cancels proactive renewal, calls provider logout
    - `logout` does NOT perform provider-specific file cleanup (Gemini's `logout()` already handles its own cleanup via `clearLegacyTokens()` — no duplication needed)
    - `logoutAll` iterates all providers
   - `logoutAllBuckets` clears all buckets for a provider
    - `clearProviderAuthCaches` resolves runtime provider and clears state
    - `clearProviderAuthCaches` calls generic `clearAuth?.()` on ALL providers (regularized from Gemini-only — G3)
    - `clearProviderAuthCaches` flushes runtime auth scopes
    - `clearProviderAuthCaches` catches and logs errors without throwing
3. Run tests (RED)
4. Implement `AuthStatusService`
5. Run tests (GREEN)

**Gemini regularization checklist (all 5 items from Gemini Regularization Strategy):**
- [ ] G1: `isAuthenticated` — hardcoded `providerName === 'gemini'` replaced with generic `provider.isAuthenticated?.()` call when OAuth enabled. Tests:
  - (a) register mock provider with `isAuthenticated()` returning true + OAuth enabled → `AuthStatusService.isAuthenticated()` returns true without token store entry
  - (b) same provider but OAuth DISABLED → override NOT consulted, falls to token store check (returns false if no token)
  - (c) provider WITHOUT `isAuthenticated()` override + OAuth enabled → falls to token store check (default path)
  - (d) provider with `isAuthenticated()` that THROWS → error caught gracefully, falls to token store check (defensive — override failures should not break auth status queries)
- [ ] G2: `logout` — duplicate Gemini file cleanup block (lines 721-750) REMOVED from manager. Tests:
  - (a) `logout('gemini')` calls `provider.logout(token)` (mock assertion — provider does its own cleanup)
  - (b) `logout` still clears local token/session even if `provider.logout()` throws (non-regression — existing behavior preserved via try/catch around provider call)
  - (c) No filesystem operations (fs.unlink, etc.) in AuthStatusService logout — all file cleanup is provider-owned
- [ ] G3: `clearProviderAuthCaches` — Gemini-specific branch (lines 1941-1953) REMOVED. Generic `clearAuth?.()` call added for ALL runtime-resolved core providers (after existing `clearAuthCache()` call). Implementation MUST enforce:
  - Each cleanup call (`clearAuthCache`, `_cachedAuthKey` reset, `clearAuth`, `clearState`) wrapped in independent try/catch so one failure cannot skip the next
  - `flushRuntimeAuthScope()` loop executes from a `finally`-style path after cleanup attempts and is never skipped due to provider cleanup failures
  - Dynamic import/provider-resolution failures still keep method non-throwing (best-effort semantics preserved)
  Tests:
  - (a) mock core provider with `clearAuth()` → verify called for ANY provider name (not just Gemini)
  - (b) mock core provider WITHOUT `clearAuth()` → no error thrown (optional chaining handles it)
  - (c) `clearAuth()` throwing an error → caught and logged, does not prevent subsequent `clearState()` or `flushRuntimeAuthScope()` calls
  - (d) provider-resolution failure path still executes flushRuntimeAuthScope best-effort loop
  - (e) dynamic import failure path remains non-throwing and logs debug
- [ ] G4: `getToken` — dead `USE_EXISTING_GEMINI_OAUTH` catch block (lines 1096-1103) REMOVED in Phase 5. Test: `getToken('gemini')` propagates errors normally.
- [ ] G5: `getAllGeminiUsageInfo` — no change, moves to `provider-usage-info.ts` as planned (Phase 8).
- [ ] **No-provider-name-branching invariant:** After all phases complete, the following grep returns ZERO results (checks for Gemini-specific branching in all manager-layer files):
  ```bash
  grep -rEn "providerName\s*===\s*['\"]gemini['\"]|provider\.name\s*===\s*['\"]gemini['\"]" \
    packages/cli/src/auth/oauth-manager.ts \
    packages/cli/src/auth/auth-status-service.ts \
    packages/cli/src/auth/token-access-coordinator.ts \
    packages/cli/src/auth/auth-flow-orchestrator.ts \
    packages/cli/src/auth/provider-registry.ts \
    packages/cli/src/auth/proactive-renewal-manager.ts
  ```
- [ ] All paths verified via existing oauth-manager tests AND new unit tests

**Phase 7 exit gate (mandatory):** All G1-G5 checklist items above must be green before proceeding to Phase 8, including explicit proof that manager-layer Gemini branches were eliminated and replacement behavior is covered by tests.

**Constructor:**
```typescript
constructor(
  private tokenStore: TokenStore,
  private providerRegistry: ProviderRegistry,
  private proactiveRenewalManager: ProactiveRenewalManager,
  private bucketManager: OAuthBucketManager,
  private tokenAccessCoordinator: TokenAccessCoordinator,
)
```

**TypeScript-specific dependency:** `logout()` calls `getCurrentProfileSessionMetadata()` and `getCurrentProfileSessionBucket()` (lines 669-678), which live in `TokenAccessCoordinator` after Phase 5. `AuthStatusService` must have a reference to the coordinator. This is not a circular dependency because `TokenAccessCoordinator` does NOT reference `AuthStatusService`.

Similarly, `getAuthStatusWithBuckets()` (line 2099) calls `getCurrentProfileSessionMetadata()` and `getCurrentProfileSessionBucket()`.

Note: `clearProviderAuthCaches` uses dynamic imports (`../runtime/runtimeSettings.js`) internally — it does NOT need runtime deps on the constructor because it self-resolves via dynamic import (same pattern as current code at line 1909). It also uses `unwrapLoggingProvider` from `auth-utils.ts` (value import — called at runtime).

**TypeScript-specific imports for auth-status-service.ts:**
- `AuthStatus` from `./types.js` — `import type` (it's a Zod-inferred type alias `z.infer<typeof AuthStatusSchema>`, not a class; objects satisfying it are constructed as plain object literals, not via `new`)
- `OAuthToken` from `./types.js` — can be `import type` (used only in type positions for token parameters/variables)
- `flushRuntimeAuthScope` from core — value import (called at runtime in `clearProviderAuthCaches`)
- `unwrapLoggingProvider` from `./auth-utils.js` — value import (called at runtime)
- `OAuthTokenRequestMetadata` from core or `./types.js` — `import type` (used only in parameter types for methods delegating to `tokenAccessCoordinator.getCurrentProfileSessionMetadata`)

**Behavioral improvement — cancel renewal timers on logout:** Current `logout()` does NOT cancel proactive renewal timers for the logged-out provider/bucket. After extraction, `logout()` should call `this.proactiveRenewalManager.clearRenewalsForProvider(providerName, bucketToUse)` after removing the token. This prevents background renewal attempts for tokens that have been explicitly logged out. Add a test case: `logout cancels proactive renewal timer for the logged-out bucket`.

**Behavior-change register (explicitly scoped):** This refactor intentionally introduces only two behavior changes:
1) Logout cancels proactive renewal timers for the logged-out bucket (safety improvement)
2) `isAuthenticated` uses provider override only when OAuth is enabled (Gemini regularization generalized via optional provider hook)

Everything else must remain behaviorally equivalent. Add phase-end assertions that no additional behavior changes are introduced (existing tests unchanged + targeted new tests above). If an additional behavior change is discovered as required for correctness, it must be explicitly documented, test-covered, and approved before merge (do not silently expand behavior scope).

**Method decomposition for 80-line limit:**
- `logout` (103 lines → ~75 lines after removing G2 duplicate file cleanup) — may no longer need decomposition, but if it exceeds 80 lines: split into `resolveLogoutTarget` (bucket resolution) + `performLogout` (token removal + provider notification + renewal cleanup + session bucket clear + cache invalidation)
- `clearProviderAuthCaches` (~96 lines → ~80 lines after removing G3 Gemini branch and generalizing `clearAuth?.()`) — if still exceeds 80 lines: split into `resolveRuntimeProvider`, `clearProviderState` (clearAuthCache + clearAuth + clearState), `flushRuntimeScopes`

**Estimated size:** ~350 lines

**Subagent delegation:**
- `typescriptexpert`: Implement Phase 7 (new tests first including Gemini special cases and renewal cancellation, extract, decompose oversized methods, run full verification suite)
- `deepthinker`: Review — verify Gemini special cases preserved with tests, clearProviderAuthCaches runtime resolution preserved, renewal timers canceled on logout, no state leaks
- **Phase-local cycle check:** After Phase 7 completes, run `npx madge --circular --extensions ts packages/cli/src/auth/` and verify zero cycles. Phase 7 introduces `AuthStatusService` which depends on `ProviderRegistry`, `ProactiveRenewalManager`, `TokenAccessCoordinator`, and `OAuthBucketManager` — high fan-in risk.

---

### Phase 8: Extract Provider Usage Info → `provider-usage-info.ts`

**Goal:** Extract provider-specific usage info methods into standalone functions. These are stateless queries — a class would be over-engineering.

**Test-first steps:**
1. Write unit tests in `packages/cli/src/auth/__tests__/provider-usage-info.spec.ts`:
   - `getAnthropicUsageInfo` fetches usage for specific bucket
   - `getAllAnthropicUsageInfo` aggregates across all buckets
   - `getAllCodexUsageInfo` aggregates codex usage with account ID mapping
   - `getAllGeminiUsageInfo` aggregates gemini quota info
   - `getHigherPriorityAuth` returns API key env var name when present, null when OAuth-only
   - `isQwenCompatibleUrl` correctly identifies Qwen-compatible URLs
   - `isQwenCompatibleUrl` rejects non-Qwen URLs
   - All functions handle missing/expired tokens gracefully (return null/empty)
2. Run tests (RED)
3. Implement as module-level functions
4. Run tests (GREEN)
5. Update oauth-manager.ts to delegate

**Verification gate before removing any duplicate:**
```bash
grep -rn "getUsageInfo" packages/cli/src/ --include='*.ts' | grep -v node_modules | grep -v dist
```
**Known finding:** `AnthropicOAuthProvider.getUsageInfo()` has NO production callers but HAS test callers in `anthropic-oauth-provider.test.ts` (4 references across a describe block). This method is a provider-level duplicate of the manager-level `getAnthropicUsageInfo()` extracted in this phase. Decision: remove the provider-level method in Phase 10 and update `anthropic-oauth-provider.test.ts` to remove or redirect those tests to test the standalone function instead.

**What moves (become standalone functions):**
- `getAnthropicUsageInfo`, `getAllAnthropicUsageInfo`, `getAllCodexUsageInfo`, `getAllGeminiUsageInfo`
- `getHigherPriorityAuth`
- `isQwenCompatibleUrl`

**Function signatures take explicit dependencies:**

The usage info functions currently call `getCurrentProfileSessionMetadata()` and `getCurrentProfileSessionBucket()` (which live in `TokenAccessCoordinator` after Phase 5) to resolve the active session bucket. To avoid coupling `provider-usage-info.ts` to `TokenAccessCoordinator`, the facade pre-resolves the bucket and passes it as a parameter:

```typescript
export async function getAnthropicUsageInfo(
  tokenStore: TokenStore,
  bucket?: string, // pre-resolved by facade from TokenAccessCoordinator
): Promise<Record<string, unknown> | null>

export async function getAllAnthropicUsageInfo(
  tokenStore: TokenStore,
): Promise<Map<string, Record<string, unknown>>>

export async function getAllCodexUsageInfo(
  tokenStore: TokenStore,
  config?: Config, // needed for getEphemeralSetting('base-url') to resolve Codex API endpoint
): Promise<Map<string, Record<string, unknown>>>

export async function getAllGeminiUsageInfo(
  tokenStore: TokenStore,
): Promise<Map<string, Record<string, unknown>>>

export async function getHigherPriorityAuth(
  providerName: string,
  settings: LoadedSettings | undefined,
): Promise<string | null>
// Implementation note: internally calls `getSettingsService()` from core and
// `isAuthOnlyEnabled()` from `./auth-utils.js`. Also calls `isQwenCompatibleUrl()`
// from the same module for the Qwen base URL check.

export function isQwenCompatibleUrl(url: string): boolean
```

The facade's delegation pattern (examples — each usage method follows the same pattern):
```typescript
async getAnthropicUsageInfo(bucket?: string): Promise<Record<string, unknown> | null> {
  if (!this.providerRegistry.getProvider('anthropic')) return null;
  const sessionMetadata =
    await this.tokenAccessCoordinator.getCurrentProfileSessionMetadata('anthropic');
  const resolvedBucket = bucket ??
    await this.tokenAccessCoordinator.getCurrentProfileSessionBucket('anthropic', sessionMetadata) ??
    'default';
  return getAnthropicUsageInfo(this.tokenStore, resolvedBucket);
}

async getAllCodexUsageInfo(): Promise<Map<string, Record<string, unknown>>> {
  return getAllCodexUsageInfo(this.tokenStore, this.config);
}
```

Note: `getAnthropicUsageInfo` is the only one that needs bucket resolution via `TokenAccessCoordinator`. The `getAll*` variants iterate all buckets internally via `tokenStore.listBuckets()`.

**Estimated size:** ~250 lines (including all 6 function signatures + imports + jsdoc)

**Phase 8 exit gate (mandatory):**
- New `provider-usage-info.spec.ts` passes
- Existing stats/auth command tests that consume usage info pass unchanged
- `getUsageInfo` duplicate handling complete per Phase 8 decision (provider-level duplicate either removed in Phase 10 or test redirects prepared)
- `isQwenCompatibleUrl` behavior parity confirmed via tests

**Subagent delegation:**
- `typescriptexpert`: Implement Phase 8 (new tests first, extract as functions, run verification gate, run full verification suite)
- `deepthinker`: Review — verify correct parameter threading, no class over-engineering, duplicate handling safe

---

### Phase 9: Slim OAuthManager Facade

**Goal:** Transform oauth-manager.ts from 2,841 lines to ≤500 lines. It becomes a thin facade that wires all extracted modules and delegates every public method.

**Test-first steps:**
1. All existing 33 test files must pass — the public API surface is unchanged
2. Add **facade wiring tests** (`oauth-manager.wiring.spec.ts`) that verify:
   - (a) `OAuthManager` constructor instantiates all sub-modules and wires `setAuthenticator`
   - (b) The same `OAuthBucketManager` instance is passed to `TokenAccessCoordinator`, `AuthFlowOrchestrator`, and `AuthStatusService` (shared state)
   - (c) The `facadeRef` passed to `TokenAccessCoordinator` and `AuthFlowOrchestrator` responds to `getOAuthToken`/`authenticateMultipleBuckets` calls (verifies BucketFailoverHandlerImpl compatibility)
   - (d) Each public method on the facade delegates to the correct sub-module (call spy verification)
   - (e) **Constructor purity:** constructing `new OAuthManager(...)` does not invoke any `facadeRef` methods (`getOAuthToken`, `authenticateMultipleBuckets`) during construction; verify zero calls on spies immediately after constructor returns
   - (f) **Pre-cutover integration gate:** run a focused integration test suite exercising `getToken` + `authenticate` concurrency through the actual facade wiring (extracted modules + facade delegates), proving lock-order/timeout semantics are preserved after wiring
3. Run full test suite before and after to confirm zero regressions

**What remains in oauth-manager.ts:**
- `OAuthManager` class definition with constructor wiring
- Public method signatures — each is a one-line or few-line delegation
- `getTokenStore()` accessor
- Imports from all extracted modules

**What does NOT remain:**
- Interface/type definitions (moved to types.ts in Phase 1)
- Standalone utility functions (moved to auth-utils.ts/profile-utils.ts in Phase 1)
- Any method body beyond simple delegation
- Any private state (distributed to appropriate modules)

**Constructor wiring:**
```typescript
constructor(
  tokenStore: TokenStore,
  settings?: LoadedSettings,
  runtimeDeps?: OAuthManagerRuntimeMessageBusDeps,
) {
  this.tokenStore = tokenStore;
  this.settings = settings;
  this.config = runtimeDeps?.config;
  this.providerRegistry = new ProviderRegistry(settings);
  this.proactiveRenewalManager = new ProactiveRenewalManager(
    tokenStore,
    (name) => this.providerRegistry.getProvider(name),
    (name) => this.providerRegistry.isOAuthEnabled(name),
  );
  this.bucketManager = new OAuthBucketManager(tokenStore);
  // Pass `this` as facadeRef so sub-modules can construct BucketFailoverHandlerImpl
  this.tokenAccessCoordinator = new TokenAccessCoordinator(
    tokenStore, this.providerRegistry, this.proactiveRenewalManager,
    this.bucketManager, this, // <-- facade self-reference
    settings, runtimeDeps?.config,
  );
  this.authFlowOrchestrator = new AuthFlowOrchestrator(
    tokenStore, this.providerRegistry,
    this.bucketManager, this, // <-- facade self-reference
    settings, runtimeDeps?.config, runtimeDeps?.messageBus,
  );
  this.authStatusService = new AuthStatusService(
    tokenStore, this.providerRegistry, this.proactiveRenewalManager,
    this.bucketManager, this.tokenAccessCoordinator,
  );
  // Wire cross-dependency: token coordinator needs to trigger auth flows
  this.tokenAccessCoordinator.setAuthenticator(this.authFlowOrchestrator);
}
```

The facade stores `this.tokenStore`, `this.settings`, and `this.config` directly — these are needed for:
- `getTokenStore()` → returns `this.tokenStore`
- `getHigherPriorityAuth()` → passes `this.settings` to standalone function
- `getAllCodexUsageInfo()` → passes `this.config` to standalone function

**TypeScript note:** The `this` reference is safe here because sub-modules store it but don't call methods on it during construction — they only use `facadeRef` at runtime when `getOAuthToken`/`authenticateMultipleBuckets` execute. By that point, the facade is fully constructed. TypeScript won't flag this as an error because the constructor parameter type is `BucketFailoverOAuthManagerLike` (an interface), and `this` satisfies that interface. However, if strict `noImplicitThis` or linting rules flag the `this` usage before the constructor completes, the sub-modules can be constructed AFTER all field assignments, with `this` passed last. The current ordering already does this correctly — `setAuthenticator` is called after all modules are constructed.

**OAuthManager class declaration:** The facade should explicitly declare `implements BucketFailoverOAuthManagerLike` on the class. This provides compile-time verification that all 6 methods required by `BucketFailoverHandlerImpl` are present and correctly typed on the facade.

**Estimated size:** ~400-500 lines

**Subagent delegation:**
- `typescriptexpert`: Implement Phase 9 (slim the facade, run full verification suite: `npm run test && npm run lint && npm run typecheck && npm run format && npm run build && node scripts/start.js --profile-load synthetic "write me a haiku and nothing else"`)
- `deepthinker`: Review — verify facade is thin, no logic leakage, all 33 test files pass, no method bodies beyond delegation
- **Phase-local cycle check:** After Phase 9 completes, run `npx madge --circular --extensions ts packages/cli/src/auth/` and verify zero cycles. Phase 9 wires all modules together in the facade constructor — this is where import cycles are most likely to manifest.
- **Facade API parity check:** Verify every public method on the pre-refactor `OAuthManager` class exists on the post-refactor facade with the same signature. Use TypeScript compilation (`npm run typecheck`) as the primary gate, plus a grep-based spot check: count public method declarations before and after and confirm they match.
- **Cutover rollback plan (mandatory):** If any Phase 9 cutover gate fails (integration, parity, cycle, or full suite), revert to pre-cutover `oauth-manager.ts` from branch history (`git restore --source=HEAD~1 -- packages/cli/src/auth/oauth-manager.ts` or equivalent staged backup) and reapply module wiring in smaller slices. Do not proceed to Phase 10 until all cutover gates pass.
- **Rollback drill gate:** Execute the rollback procedure once on the feature branch (dry-run via temporary failing commit), confirm `npm run typecheck` + targeted auth tests pass after rollback, then re-apply cutover. This validates rollback instructions are executable, not theoretical.

---

### Phase 10: DRY Up CLI OAuth Providers

**Goal:** Extract shared infrastructure duplicated across all 4 CLI OAuth providers into shared utilities. Remove dead code.

**Test-first steps:**
1. All existing provider test files must continue passing (9 test files, see list in plan body)
2. Write tests for shared utilities in `packages/cli/src/auth/__tests__/oauth-provider-base.spec.ts`:
   - `InitializationGuard` (wrap mode) transitions: NotStarted → InProgress → Completed on success
   - `InitializationGuard` (wrap mode) transitions: NotStarted → InProgress → Failed on error, wraps in OAuthError
   - `InitializationGuard` (rethrow mode) transitions: Failed on error, rethrows directly without wrapping
   - `InitializationGuard` deduplicates concurrent calls (returns same promise while InProgress)
   - `InitializationGuard` in Failed state resets to NotStarted and retries on next call
   - `isTokenExpired` returns true when within 30-second buffer
   - `isTokenExpired` returns false for token with plenty of remaining time
   - `hasValidRefreshToken` returns false for empty/missing refresh tokens
   - `hasValidRefreshToken` returns true for valid refresh token string
   - `hasValidRefreshToken` acts as type predicate (narrows `token` to `OAuthToken & { refresh_token: string }`)
   - `AuthCodeDialog` wait/submit/cancel lifecycle works correctly (Anthropic + Gemini pattern only)
   - `AuthCodeDialog.cancelAuth` creates error via `OAuthErrorFactory.fromUnknown()` (matching existing behavior)
4. Run tests (RED)
5. Implement `oauth-provider-base.ts`
6. Run tests (GREEN)
7. Refactor each provider to use shared utilities
8. Remove dead `refreshIfNeeded()` stubs from all 4 providers
9. **Dead-method eradication gate (hard):**
   ```bash
   grep -rn "refreshIfNeeded" --include='*.ts' packages/cli/src/auth/ | grep -v node_modules | grep -v dist
   ```
   Must return zero results in production files (any remaining matches must be test fixture text only and explicitly justified).
10. All provider tests pass

**Design choice — utility classes and functions, not abstract base class:**

The 4 providers have different constructor signatures and divergent `initiateAuth()` flows. Classical inheritance would create a fragile base class. Instead:

```typescript
// oauth-provider-base.ts

export enum InitializationState {
  NotStarted = 'not-started',
  InProgress = 'in-progress',
  Completed = 'completed',
  Failed = 'failed',
}

/**
 * Encapsulates the shared ensureInitialized() state machine.
 * Supports two error handling modes:
 * - 'wrap': wraps errors via OAuthErrorFactory.fromUnknown() (Anthropic, Gemini, Qwen)
 * - 'rethrow': rethrows errors directly (Codex)
 */
export class InitializationGuard {
  private state = InitializationState.NotStarted;
  private promise: Promise<void> | undefined;
  private error?: Error;

  constructor(private errorMode: 'wrap' | 'rethrow' = 'wrap') {}

  /**
   * Mirrors the exact state machine in all 4 providers:
   * - NotStarted → start initFn, set InProgress
   * - InProgress → await existing promise (dedup)
   * - Completed → return immediately
   * - Failed → reset to NotStarted, retry
   *
   * In 'wrap' mode: stores error via OAuthErrorFactory.fromUnknown() (Anthropic/Gemini/Qwen)
   * In 'rethrow' mode: rethrows directly without wrapping (Codex)
   */
  async ensureInitialized(
    initFn: () => Promise<void>,
    providerName?: string,
  ): Promise<void> { ... }
  getState(): InitializationState { ... }
}

/**
 * Shared auth code dialog for providers that use browser-based flows with
 * code submission (Anthropic, Gemini). NOT used by Codex or Qwen.
 */
export class AuthCodeDialog {
  private resolveCode: ((code: string) => void) | null = null;
  private rejectCode: ((error: Error) => void) | null = null;
  private pendingPromise: Promise<string> | null = null;

  waitForAuthCode(): Promise<string> { ... }
  submitAuthCode(code: string): void { ... }
  cancelAuth(providerName: string): void { ... }
}

export function isTokenExpired(token: OAuthToken, bufferSeconds = 30): boolean { ... }
export function hasValidRefreshToken(
  token: OAuthToken,
): token is OAuthToken & { refresh_token: string } { ... }
```

**Pre-extraction parity analysis (completed):**
- `InitializationGuard`: All 4 providers use the pattern but Codex differs — it doesn't wrap errors in `OAuthError` or store `initializationError`. The `InitializationGuard` class handles this via the `errorMode` constructor parameter.
- `AuthCodeDialog`: Only Anthropic and Gemini have `waitForAuthCode/submitAuthCode/cancelAuth`. Codex uses a local callback server; Qwen uses device flow polling. The `AuthCodeDialog` class is used only by Anthropic and Gemini.
- `isTokenExpired`: Only Anthropic and Qwen have private `isTokenExpired()`. The shared function replaces both.
- `hasValidRefreshToken`: Only Anthropic has the full validation (type predicate with length check). Qwen does an inline `!currentToken.refresh_token` check. The shared function provides the strict version; Qwen's inline check is updated to use it.

**What gets added:**
- `GeminiOAuthProvider.isAuthenticated()` — implements the new optional `OAuthProvider.isAuthenticated?()` method. Returns `Promise<true>` because Gemini uses LOGIN_WITH_GOOGLE which handles auth transparently. The manager only calls this when OAuth is enabled for the provider (see Phase 7 AuthStatusService). This is the Gemini regularization G1 provider-side implementation.
- Test in `packages/cli/src/auth/__tests__/gemini-oauth-provider.spec.ts` (or extend existing test file): `GeminiOAuthProvider.isAuthenticated()` always returns true.

**What gets removed (dead code):**
- `refreshIfNeeded()` in all 4 providers — deprecated stubs that log a warning and return null (interface no longer includes it)
- `getUsageInfo()` on `AnthropicOAuthProvider` — has test callers in `anthropic-oauth-provider.test.ts` but no production callers; tests must be updated or redirected to the standalone function from Phase 8

**Estimated size of oauth-provider-base.ts:** ~150 lines
**Estimated savings across 4 providers:** ~100-150 lines (lower than originally estimated due to patterns not being universal across all 4)

**Subagent delegation:**
- `typescriptexpert`: Implement Phase 10 (new tests for shared utils including AuthCodeDialog, extract, refactor all 4 providers, remove dead code, run full verification suite)
- `deepthinker`: Review — verify DRY elimination complete, no behavior changes, all provider tests pass, dead code removal safe

---

### Phase 11: Final Import Audit and Validation

**Goal:** Final pass on all imports across the codebase + complete verification suite + line count validation.

**Steps:**
0. **Tooling prerequisites (deterministic hard gates):**
   ```bash
   # Ensure madge is available in the repo toolchain before cycle gates run
   # Preferred: add to devDependencies and a script once in this branch
   npm pkg get devDependencies.madge
   # If missing, add it explicitly in this branch before running phase gates:
   # npm install -D madge
   # and add script: "check:cycles:auth": "madge --circular --extensions ts packages/cli/src/auth/"
   ```
   The cycle gate must not depend on ad-hoc global installs.
   All phase-local cycle checks (Phases 1/5/7/9/11) should run the same command (`npm run check:cycles:auth` once script exists) for consistency.

0.1 **TypeScript config verification:**
   ```bash
   # Check for verbatimModuleSyntax or isolatedModules — if enabled, all type-only imports MUST use `import type`
   grep -E "verbatimModuleSyntax|isolatedModules" packages/cli/tsconfig*.json
   ```
1. **Repo-wide import search gates:**

   **Final import contract (hard):**
   - `oauth-manager.ts` exports/imports used by consumers: **`OAuthManager` class only** (plus internal facade dependencies)
   - Moved symbols MUST NOT be imported from `oauth-manager.ts`: `OAuthProvider`, `OAuthManagerRuntimeMessageBusDeps`, `unwrapLoggingProvider`, `isQwenCompatibleUrl`, `getHigherPriorityAuth`, usage-info methods
   - Importing `OAuthManager` from `oauth-manager.ts` remains valid and expected

   ```bash
   # Audit oauth-manager imports (informational baseline)
   grep -rn "from.*oauth-manager" --include='*.ts' packages/cli/src/ | grep -v node_modules | grep -v dist

   # HARD GATE: moved symbols must not come from oauth-manager
   grep -rn "OAuthProvider" --include='*.ts' packages/cli/src/ | grep -v node_modules | grep -v dist | grep "from.*oauth-manager"
   grep -rn "OAuthManagerRuntimeMessageBusDeps" --include='*.ts' packages/cli/src/ | grep -v node_modules | grep -v dist | grep "from.*oauth-manager"
   grep -rn "unwrapLoggingProvider" --include='*.ts' packages/cli/src/ | grep -v node_modules | grep -v dist | grep "from.*oauth-manager"
   grep -rn "isQwenCompatibleUrl\|getHigherPriorityAuth\|getAnthropicUsageInfo\|getAllAnthropicUsageInfo\|getAllCodexUsageInfo\|getAllGeminiUsageInfo" --include='*.ts' packages/cli/src/ | grep -v node_modules | grep -v dist | grep "from.*oauth-manager"

   # Verify no circular imports (types.ts must not import from any extracted module)
   grep -rn "from.*provider-registry\|from.*token-access\|from.*auth-flow\|from.*auth-status\|from.*proactive-renewal\|from.*provider-usage" packages/cli/src/auth/types.ts

   # Type-vs-value hygiene spot checks (must return empty)
   grep -rn "import \{[^}]*OAuthProvider[^}]*\} from './types\.js'" --include='*.ts' packages/cli/src/auth/ | grep -v "import type"
   grep -rn "import \{[^}]*OAuthManagerRuntimeMessageBusDeps[^}]*\} from './types\.js'" --include='*.ts' packages/cli/src/ | grep -v "import type"
   ```
2. **Migration completeness check** — verify no moved symbol is still imported from its old location:
   ```bash
   # Every symbol that moved out of oauth-manager.ts must not be imported from there
   # List of moved symbols: OAuthProvider, OAuthManagerRuntimeMessageBusDeps, unwrapLoggingProvider,
   # isQwenCompatibleUrl, getHigherPriorityAuth, getAnthropicUsageInfo, getAllAnthropicUsageInfo,
   # getAllCodexUsageInfo, getAllGeminiUsageInfo, isLoggingWrapperCandidate, hasRequestMetadata,
   # getProfileManagerCtor, createProfileManager, isLoadBalancerProfileLike, getOAuthBucketsFromProfile
   for sym in OAuthProvider OAuthManagerRuntimeMessageBusDeps unwrapLoggingProvider isQwenCompatibleUrl \
     getHigherPriorityAuth getAnthropicUsageInfo getAllAnthropicUsageInfo getAllCodexUsageInfo \
     getAllGeminiUsageInfo isLoggingWrapperCandidate hasRequestMetadata; do
     echo "=== $sym ==="
     grep -rn "$sym" --include='*.ts' packages/cli/src/ | grep -v node_modules | grep -v dist | grep "oauth-manager"
   done
   # All of the above must return empty
   ```
3. **Mandatory circular dependency check (HARD GATE — must pass before merge):**
   ```bash
   npx madge --circular --extensions ts packages/cli/src/auth/
   ```
   This must report zero circular dependencies. If `madge` is not available, install it as a devDependency or use `npx`. This is a mandatory gate, not advisory.
4. Check proxy directory files (`packages/cli/src/auth/proxy/`) for broken imports
5. Run full verification suite:
   ```bash
   npm run test
   npm run lint
   npm run typecheck
   npm run format
   npm run build
   node scripts/start.js --profile-load synthetic "write me a haiku and nothing else"
   ```
6. Validate line count constraints:
   ```bash
   wc -l packages/cli/src/auth/*.ts | sort -rn
   ```
   - No file exceeds 800 lines
7. Function size audit — no function exceeds 80 lines (deterministic gate):
   ```bash
   # Hard gate using eslint max-lines-per-function for auth directory
   npx eslint packages/cli/src/auth --ext .ts --rule 'max-lines-per-function:[2,{"max":80,"skipBlankLines":true,"skipComments":true}]'
   ```
   If this command flags legacy files outside current scope, run it against the extracted/newly modified auth files explicitly and include output in the PR notes.
8. Document final line counts in summary

**Subagent delegation:**
- `typescriptexpert`: Implement Phase 11 (import audit, full verification, line count validation, function size audit)
- `deepthinker`: Final review of the complete refactoring — all acceptance criteria met, architecture clean, no missed imports

---

## Risk Mitigation

### Test Strategy
- Every phase runs `npm run test` at completion
- Existing 33 test files (21,430 lines) serve as behavioral regression tests
- New unit tests for each extracted module verify isolated correctness
- Golden tests for session bucket scoping and lock parameters prevent semantic drift

### Locking Correctness
- Lock patterns move wholesale — no lock semantics change (see Lock Semantic Preservation Checklist above)
- Existing concurrency tests validate correctness at every phase
- Lock parameter values (waitMs, staleMs) are explicitly tested in new unit tests

### Circular Dependencies
- Dependency flow is acyclic (see Dependency Graph above)
- Cross-dependency #1: `TokenAccessCoordinator` → `AuthFlowOrchestrator` resolved via `setAuthenticator` callback with explicit guard (not a module import)
- Cross-dependency #2: `TokenAccessCoordinator` and `AuthFlowOrchestrator` both need the OAuthManager facade for `BucketFailoverHandlerImpl` construction. Resolved via `facadeRef: BucketFailoverOAuthManagerLike` parameter (narrow interface, not a module import cycle)
- `AuthStatusService` depends on `TokenAccessCoordinator` (not circular — TokenAccessCoordinator does NOT reference AuthStatusService)
- Profile helpers are in shared `profile-utils.ts`, not duplicated
- Phase ordering ensures each module's dependencies exist before extraction
- **Verification:** After Phase 9, run `npx madge --circular packages/cli/src/auth/` (or equivalent) to confirm no TypeScript import cycles

### Gemini Regularization
- Five Gemini special cases identified, tracked, and **fixed** — not merely relocated (see Gemini Regularization Strategy section)
- G1: `isAuthenticated` — hardcoded provider name replaced with generic optional provider method
- G2: `logout` file cleanup — duplicate code removed (provider already handles it)
- G3: `clearProviderAuthCaches` — Gemini branch replaced with generic `clearAuth?.()` for all providers
- G4: `getToken` — dead `USE_EXISTING_GEMINI_OAUTH` catch block removed
- G5: `getAllGeminiUsageInfo` — no change needed (already provider-specific by design)
- Each fix has dedicated test cases in the relevant phase
- Existing test suite provides additional regression coverage
- **Risk:** G1 changes the `isAuthenticated` contract slightly — previously only Gemini could override auth status, now any provider can. This is intentional (better extension point) but verify no other provider inadvertently gains an `isAuthenticated` method via prototype chain or interface confusion.

### Backward Compatibility
- OAuthManager's public method signatures do not change
- Core package's minimal `OAuthManager` interface (in `precedence.ts`) is unaffected
- CLI's OAuthManager class still satisfies the core interface
- Runtime wiring in `providerManagerInstance.ts` continues to work
- No re-exports — all consumers updated to import from correct source

## Expected Final File Sizes

| File | Lines | Status |
|------|-------|--------|
| `types.ts` | ~120 | Enhanced (existing re-exports + OAuthProvider + OAuthManagerRuntimeMessageBusDeps + BucketFailoverOAuthManagerLike + AuthenticatorInterface); must add `import type { OAuthTokenRequestMetadata } from '@vybestack/llxprt-code-core'` and re-export it for consumer convenience since the new interfaces reference it |
| `auth-utils.ts` | ~80 | New (unwrapLoggingProvider, isAuthOnlyEnabled, isLoggingWrapperCandidate, hasRequestMetadata) |
| `profile-utils.ts` | ~120 | New (profile manager/bucket extraction + module-level profileManagerCtorPromise cache) |
| `oauth-manager.ts` (facade) | ~450-550 | Reduced from 2,841 (thin delegation + constructor wiring + usage info facade methods) |
| `provider-registry.ts` | ~200 | New |
| `proactive-renewal-manager.ts` | ~350 | New |
| `token-access-coordinator.ts` | ~600 | New (largest extracted module: getToken + getOAuthToken + profile resolution) |
| `auth-flow-orchestrator.ts` | ~500 | New (authenticate + authenticateMultipleBuckets with stdin lifecycle) |
| `auth-status-service.ts` | ~400 | New (status queries + logout + clearProviderAuthCaches) |
| `provider-usage-info.ts` | ~250 | New (6 standalone functions + imports) |
| `OAuthBucketManager.ts` | ~230 | Enhanced from 151 (metadata-scoped session buckets + scope key) |
| `oauth-provider-base.ts` | ~150 | New (InitializationGuard + AuthCodeDialog + shared predicates) |
| `anthropic-oauth-provider.ts` | ~530 | Reduced from 605 |
| `codex-oauth-provider.ts` | ~490 | Reduced from 548 |
| `gemini-oauth-provider.ts` | ~510 | Reduced from 576 |
| `qwen-oauth-provider.ts` | ~380 | Reduced from 447 |

All files well under 800-line limit. All functions decomposed to ≤80 lines.

**Line count validation formula:** Total pre-refactoring lines ≈ 2,841 (oauth-manager) + 151 (OAuthBucketManager) + 15 (types.ts) = ~3,007 lines of production code. Total post-refactoring ≈ ~4,060 lines (growth from decomposition overhead: interface definitions, constructors, imports, delegation methods). Net growth ~35% is expected and acceptable for this type of structural refactoring.
