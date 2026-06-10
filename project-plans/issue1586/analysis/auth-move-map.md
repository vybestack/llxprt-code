# Auth Move Map

Plan ID: PLAN-20260608-ISSUE1586

## Move Map: Core → Auth Package

### Production Files (15 files)

| # | Current Path | New Path in packages/auth | DI Changes Required |
|---|-------------|--------------------------|---------------------|
| 1 | `core/src/auth/types.ts` | `packages/auth/src/types.ts` | Update internal imports to relative. No DI changes (depends on `zod` only). |
| 2 | `core/src/auth/token-store.ts` | `packages/auth/src/token-store.ts` | Import `./types.js`. No DI changes. |
| 3 | `core/src/auth/keyring-token-store.ts` | `packages/auth/src/keyring-token-store.ts` | Replace `../storage/secure-store.js` → `ISecureStore` injection. Replace `../debug/index.js` → `IDebugLogger` injection. Constructor accepts options bag with `secureStore`, `logger`. |
| 4 | `core/src/auth/oauth-errors.ts` | `packages/auth/src/oauth-errors.ts` | No external deps. Move as-is. |
| 5 | `core/src/auth/token-merge.ts` | `packages/auth/src/token-merge.ts` | Import `./types.js`. No DI changes. |
| 6 | `core/src/auth/token-sanitization.ts` | `packages/auth/src/token-sanitization.ts` | Import `./types.js`. No DI changes. |
| 7 | `core/src/auth/precedence.ts` | `packages/auth/src/precedence.ts` | **Requires refactoring.** Currently imports `SettingsService` (type-only) from `../settings/SettingsService.js`, `ProviderRuntimeContext` (type-only) from `../runtime/providerRuntimeContext.js`, and `debugLogger` (value import) from `../utils/debugLogger.js`. When moving to auth: (1) replace type-only imports of `SettingsService`/`ProviderRuntimeContext` with auth-owned `ISettingsService`/`IProviderRuntimeContext` interfaces from `./interfaces/`; (2) replace `debugLogger` value import with injected `IDebugLogger` boundary (passed via function parameter, module-level setter, or similar). After refactoring, precedence.ts has zero core dependencies — self-contained types, cache logic, and `OAuthManager` interface only. Exports `flushRuntimeAuthScope`, `RuntimeAuthScopeFlushResult`, `RuntimeAuthScopeCacheEntrySummary`, `OAuthManager`, `AuthPrecedenceConfig`, `OAuthTokenRequestMetadata`, `RuntimeScopedState`. |
| 8 | `core/src/auth/auth-precedence-resolver.ts` | `packages/auth/src/auth-precedence-resolver.ts` | Replace `../settings/SettingsService.js` → `ISettingsService`. Replace `../runtime/providerRuntimeContext.js` → `IProviderRuntimeContext`. Replace `../debug/index.js` → `IDebugLogger`. Replace `../storage/provider-key-storage.js` → `IProviderKeyStorage`. Replace `../utils/debugLogger.js` → `IDebugLogger`. `node:fs/promises`, `node:path`, `node:os` for file-based keyfile reads move to `IProviderKeyStorage` or `ISettingsService` implementations in P11, eliminating these built-in deps from auth-precedence-resolver. **Responsibility:** High-level `AuthPrecedenceResolver` class that composes cache primitives from `precedence.ts` with injected DI interfaces (`ISettingsService`, `IProviderKeyStorage`, `IDebugLogger`, `IProviderRuntimeContext`). **Depends on `precedence.ts`** (not vice versa). |
| 9 | `core/src/auth/anthropic-device-flow.ts` | `packages/auth/src/flows/anthropic-device-flow.ts` | Imports `./types.js`, `crypto`, `node:url`. No DI changes. |
| 10 | `core/src/auth/codex-device-flow.ts` | `packages/auth/src/flows/codex-device-flow.ts` | Replace `../debug/index.js` → `IDebugLogger` injection. |
| 11 | `core/src/auth/qwen-device-flow.ts` | `packages/auth/src/flows/qwen-device-flow.ts` | Imports `./types.js`, `crypto`. No DI changes. |
| 12 | `core/src/auth/proxy/framing.ts` | `packages/auth/src/proxy/framing.ts` | No external deps. Move as-is. |
| 13 | `core/src/auth/proxy/proxy-socket-client.ts` | `packages/auth/src/proxy/proxy-socket-client.ts` | Imports `./framing.js`, `node:net`, `node:crypto`. No DI changes. |
| 14 | `core/src/auth/proxy/proxy-token-store.ts` | `packages/auth/src/proxy/proxy-token-store.ts` | Imports `../types.js`, `../token-store.js`, `./proxy-socket-client.js`. Update paths to relative within auth package. |
| 15 | `core/src/auth/proxy/proxy-provider-key-storage.ts` | `packages/auth/src/proxy/proxy-provider-key-storage.ts` | Imports `./proxy-socket-client.js`. No DI changes. |

## Test Move Map (20 files)

### Root-level test/spec files (10 files)

| # | Current Path | New Path in packages/auth |
|---|-------------|--------------------------|
| 1 | `core/src/auth/precedence.test.ts` | `packages/auth/src/__tests__/precedence.test.ts` |
| 2 | `core/src/auth/precedence.adapter.test.ts` | `packages/auth/src/__tests__/precedence.adapter.test.ts` |
| 3 | `core/src/auth/auth-integration.spec.ts` | `packages/auth/src/__tests__/auth-integration.spec.ts` |
| 4 | `core/src/auth/codex-device-flow.spec.ts` | `packages/auth/src/__tests__/codex-device-flow.spec.ts` |
| 5 | `core/src/auth/oauth-errors.spec.ts` | `packages/auth/src/__tests__/oauth-errors.spec.ts` |
| 6 | `core/src/auth/oauth-logout-cache-invalidation.spec.ts` | `packages/auth/src/__tests__/oauth-logout-cache-invalidation.spec.ts` |
| 7 | `core/src/auth/token-store.spec.ts` | `packages/auth/src/__tests__/token-store.spec.ts` |
| 8 | `core/src/auth/token-store.refresh-race.spec.ts` | `packages/auth/src/__tests__/token-store.refresh-race.spec.ts` |
| 9 | `core/src/auth/invalidateProviderCache.test.ts` | `packages/auth/src/__tests__/invalidateProviderCache.test.ts` |
| 10 | `core/src/auth/qwen-device-flow.spec.ts` | `packages/auth/src/__tests__/qwen-device-flow.spec.ts` |

### __tests__ directory test files (6 files)

| # | Current Path | New Path in packages/auth |
|---|-------------|--------------------------|
| 11 | `core/src/auth/__tests__/authRuntimeScope.test.ts` | `packages/auth/src/__tests__/authRuntimeScope.test.ts` |
| 12 | `core/src/auth/__tests__/codex-device-flow.test.ts` | `packages/auth/src/__tests__/codex-device-flow.test.ts` |
| 13 | `core/src/auth/__tests__/keyring-token-store.integration.test.ts` | `packages/auth/src/__tests__/keyring-token-store.integration.test.ts` |
| 14 | `core/src/auth/__tests__/keyring-token-store.test.ts` | `packages/auth/src/__tests__/keyring-token-store.test.ts` |
| 15 | `core/src/auth/__tests__/token-merge.test.ts` | `packages/auth/src/__tests__/token-merge.test.ts` |
| 16 | `core/src/auth/__tests__/token-sanitization.test.ts` | `packages/auth/src/__tests__/token-sanitization.test.ts` |

### proxy/__tests__ directory test files (4 files)

| # | Current Path | New Path in packages/auth |
|---|-------------|--------------------------|
| 17 | `core/src/auth/proxy/__tests__/framing.test.ts` | `packages/auth/src/proxy/__tests__/framing.test.ts` |
| 18 | `core/src/auth/proxy/__tests__/proxy-provider-key-storage.test.ts` | `packages/auth/src/proxy/__tests__/proxy-provider-key-storage.test.ts` |
| 19 | `core/src/auth/proxy/__tests__/proxy-socket-client.test.ts` | `packages/auth/src/proxy/__tests__/proxy-socket-client.test.ts` |
| 20 | `core/src/auth/proxy/__tests__/proxy-token-store.test.ts` | `packages/auth/src/proxy/__tests__/proxy-token-store.test.ts` |

### Test Migration Constraints

All 20 core auth test files move to `packages/auth`. Tests that import core/providers symbols must be refactored to use local DI test doubles before moving. No tests are relocated to owning packages — all are refactorable within scope.

| Test File | Cross-Package Import | Migration Action | Final Destination |
|-----------|---------------------|------------------|-------------------|
| `precedence.adapter.test.ts` | `@vybestack/llxprt-code-providers` | Refactor with local DI test double | `packages/auth/src/__tests__/precedence.adapter.test.ts` |
| `invalidateProviderCache.test.ts` | core `SettingsService`/`settingsServiceInstance` | Refactor with `ISettingsService` test double | `packages/auth/src/__tests__/invalidateProviderCache.test.ts` |
| `precedence.test.ts` | core `SettingsService` | Refactor with `ISettingsService` test double | `packages/auth/src/__tests__/precedence.test.ts` |
| `keyring-token-store.test.ts` | core `SecureStore`/`KeyringAdapter` | Refactor with `ISecureStore` test double | `packages/auth/src/__tests__/keyring-token-store.test.ts` |
| `keyring-token-store.integration.test.ts` | core `SecureStore`/`KeyringAdapter` | Refactor with `ISecureStore` test double | `packages/auth/src/__tests__/keyring-token-store.integration.test.ts` |
| `auth-integration.spec.ts` | core symbols | Refactor with DI test doubles | `packages/auth/src/__tests__/auth-integration.spec.ts` |
| `oauth-logout-cache-invalidation.spec.ts` | core `SettingsService` | Refactor with `ISettingsService` test double | `packages/auth/src/__tests__/oauth-logout-cache-invalidation.spec.ts` |
| All other tests (13 remaining) | None (no cross-package deps) | Move as-is | `packages/auth/src/__tests__/` or `packages/auth/src/proxy/__tests__/` |

**Total test files moving to packages/auth: 20. Tests relocated to owning packages: 0.**

### Enforcement Scan

```bash
if rg -n "@vybestack/llxprt-code-core|@vybestack/llxprt-code-providers" packages/auth/src --glob '*.test.ts' --glob '*.spec.ts' 2>/dev/null; then
  echo "FAIL: auth tests must not import core/providers"; exit 1
fi
```

## CLI Import Migration Map

### CLI Auth Files (import from core → import from auth)

| CLI File | Current Core Import | New Auth Package Import |
|----------|---------------------|------------------------|
| `cli/src/auth/types.ts` | `OAuthToken`, `TokenStore`, `OAuthTokenRequestMetadata`, `AuthStatus` from core | Same from `@vybestack/llxprt-code-auth` |
| `cli/src/auth/types.ts` | `KeyringTokenStore` from core | Same from `@vybestack/llxprt-code-auth` |
| `cli/src/auth/oauth-manager.ts` | `OAuthToken`, `TokenStore`, `OAuthError` from core | Same from `@vybestack/llxprt-code-auth` |
| `cli/src/auth/oauth-provider-base.ts` | `OAuthError`, `OAuthErrorFactory`, `OAuthToken` from core | Same from `@vybestack/llxprt-code-auth` |
| `cli/src/auth/auth-flow-orchestrator.ts` | `OAuthError`, `OAuthErrorFactory`, token types from core | Same from `@vybestack/llxprt-code-auth` |
| `cli/src/auth/codex-oauth-provider.ts` | `OAuthError`, `CodexDeviceFlow` from core | Same from `@vybestack/llxprt-code-auth` |
| `cli/src/auth/provider-registry.ts` | `DebugLogger` from core | Keep from core (not auth concern) |
| `cli/src/auth/proxy/credential-store-factory.ts` | `SecureStore`, `KeyringTokenStore`, `ProxyTokenStore` from core | `KeyringTokenStore`, `ProxyTokenStore` from auth; `SecureStore` from core |
| `cli/src/auth/proxy/credential-proxy-oauth-handler.ts` | `OAuthToken`, `TokenStore` from core | Same from `@vybestack/llxprt-code-auth` |
| `cli/src/auth/proxy/refresh-coordinator.ts` | `TokenStore`, `OAuthToken`, `OAuthError` from core | Same from `@vybestack/llxprt-code-auth` |

## Providers Import Migration Map

### Providers Files (import from core/auth → import from auth)

| Providers File | Current Core Import | New Auth Package Import |
|---------------|---------------------|------------------------|
| `providers/src/BaseProvider.ts` | `AuthPrecedenceResolver`, `AuthPrecedenceConfig`, `OAuthManager` from `@vybestack/llxprt-code-core/auth/precedence.js` | Same from `@vybestack/llxprt-code-auth` |
| `providers/src/gemini/GeminiProvider.ts` | `OAuthManager` from `@vybestack/llxprt-code-core/auth/precedence.js` | Same from `@vybestack/llxprt-code-auth` |
| `providers/src/anthropic/AnthropicProvider.ts` | `OAuthManager` from `@vybestack/llxprt-code-core/auth/precedence.js` | Same from `@vybestack/llxprt-code-auth` |
| `providers/src/openai/OpenAIProvider.ts` | `OAuthManager` from `@vybestack/llxprt-code-core/auth/precedence.js` | Same from `@vybestack/llxprt-code-auth` |
| `providers/src/openai-vercel/OpenAIVercelProvider.ts` | `OAuthManager` from `@vybestack/llxprt-code-core/auth/precedence.js` | Same from `@vybestack/llxprt-code-auth` |
| `providers/src/openai-responses/OpenAIResponsesProviderBase.ts` | `CodexOAuthTokenSchema` from `@vybestack/llxprt-code-core/auth/types.js`; `OAuthManager` from `@vybestack/llxprt-code-core/auth/precedence.js` | Same from `@vybestack/llxprt-code-auth` |
| `providers/src/BaseProvider.test.ts` | `OAuthManager`, `OAuthTokenRequestMetadata` from `@vybestack/llxprt-code-core/auth/precedence.js` | Same from `@vybestack/llxprt-code-auth` |
| `providers/src/openai/openai-oauth.spec.ts` | `flushRuntimeAuthScope` from `@vybestack/llxprt-code-core/auth/precedence.js` | Same from `@vybestack/llxprt-code-auth` |
| `providers/src/openai-responses/__tests__/OpenAIResponsesProvider.promptCacheKey.test.ts` | `type CodexOAuthToken` from `@vybestack/llxprt-code-core/auth/types.js` | Same from `@vybestack/llxprt-code-auth` |