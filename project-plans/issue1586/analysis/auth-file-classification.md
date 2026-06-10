# Auth File Classification

Plan ID: PLAN-20260608-ISSUE1586
Updated: Phase P01 (evidence-refreshed from actual code)

## Classification Rules

### Rule 1: Auth Domain — Moves to packages/auth
Files under `packages/core/src/auth/` that define auth domain concepts: token types, token store interface, precedence logic, OAuth errors, token utilities, device flows, proxy infrastructure.

Classification: `auth domain — moves to packages/auth`

### Rule 2: Auth Domain Tests — Moves with code
Test/spec files under `packages/core/src/auth/` that test auth domain concepts.

Classification: `auth test — moves to packages/auth`

### Rule 3: CLI Auth Composition — Stays in CLI
Files under `packages/cli/src/auth/` that implement CLI-specific auth UI, orchestration, provider adapters, and composition. These USE auth domain types but are not part of the auth package.

Classification: `CLI auth composition — stays in packages/cli`

### Rule 4: CLI Auth Proxy Orchestration — Stays in CLI
Files under `packages/cli/src/auth/proxy/` that orchestrate proxy servers, credential stores, and sandbox lifecycles. These compose auth domain types with CLI-specific runtime.

Classification: `CLI proxy orchestration — stays in packages/cli`

### Rule 5: CLI Test Helpers — Stays in CLI (not production)
Files under `packages/cli/src/auth/` named `*.test-helpers.ts` or `test-utils.ts` that support test infrastructure but are not spec/test files themselves.

Classification: `CLI test helper — stays in packages/cli (not counted as production)`

### Rule 6: Providers Auth Import — Migrate imports only
Files under `packages/providers/src/` that import auth types from `@vybestack/llxprt-code-core/auth/`. These do NOT move; only their import paths change.

Classification: `providers auth import — stays in packages/providers (migrate imports)`

## Core Auth File Classification Table

### Moves to packages/auth (15 production + 20 test files = 35 total)

| Current Path | Classification | New Path | DI Refactor? |
|-------------|----------------|----------|-------------|
| `core/src/auth/types.ts` | auth domain | `packages/auth/src/types.ts` | No |
| `core/src/auth/token-store.ts` | auth domain | `packages/auth/src/token-store.ts` | No |
| `core/src/auth/keyring-token-store.ts` | auth domain | `packages/auth/src/keyring-token-store.ts` | Yes (ISecureStore) |
| `core/src/auth/oauth-errors.ts` | auth domain | `packages/auth/src/oauth-errors.ts` | No |
| `core/src/auth/token-merge.ts` | auth domain | `packages/auth/src/token-merge.ts` | No |
| `core/src/auth/token-sanitization.ts` | auth domain | `packages/auth/src/token-sanitization.ts` | No |
| `core/src/auth/precedence.ts` | auth domain | `packages/auth/src/precedence.ts` | Yes (ISettingsService, IProviderRuntimeContext, IDebugLogger) |
| `core/src/auth/auth-precedence-resolver.ts` | auth domain | `packages/auth/src/auth-precedence-resolver.ts` | Yes (ISettingsService, IProviderRuntimeContext, IProviderKeyStorage, IDebugLogger) |
| `core/src/auth/anthropic-device-flow.ts` | auth domain | `packages/auth/src/flows/anthropic-device-flow.ts` | No |
| `core/src/auth/codex-device-flow.ts` | auth domain | `packages/auth/src/flows/codex-device-flow.ts` | Yes (IDebugLogger) |
| `core/src/auth/qwen-device-flow.ts` | auth domain | `packages/auth/src/flows/qwen-device-flow.ts` | No |
| `core/src/auth/proxy/framing.ts` | auth domain | `packages/auth/src/proxy/framing.ts` | No |
| `core/src/auth/proxy/proxy-socket-client.ts` | auth domain | `packages/auth/src/proxy/proxy-socket-client.ts` | No |
| `core/src/auth/proxy/proxy-token-store.ts` | auth domain | `packages/auth/src/proxy/proxy-token-store.ts` | No |
| `core/src/auth/proxy/proxy-provider-key-storage.ts` | auth domain | `packages/auth/src/proxy/proxy-provider-key-storage.ts` | No |

#### Core Auth Test Files Moving to packages/auth (20 files)

| Current Path | Classification | New Path | Cross-Package Deps? |
|-------------|----------------|----------|---------------------|
| `core/src/auth/__tests__/authRuntimeScope.test.ts` | auth test | `packages/auth/src/__tests__/authRuntimeScope.test.ts` | Yes (SettingsService, runtimeContext) |
| `core/src/auth/__tests__/codex-device-flow.test.ts` | auth test | `packages/auth/src/__tests__/codex-device-flow.test.ts` | No |
| `core/src/auth/__tests__/keyring-token-store.integration.test.ts` | auth test | `packages/auth/src/__tests__/keyring-token-store.integration.test.ts` | Yes (SecureStore, DebugLogger) |
| `core/src/auth/__tests__/keyring-token-store.test.ts` | auth test | `packages/auth/src/__tests__/keyring-token-store.test.ts` | Yes (SecureStore) |
| `core/src/auth/__tests__/token-merge.test.ts` | auth test | `packages/auth/src/__tests__/token-merge.test.ts` | No |
| `core/src/auth/__tests__/token-sanitization.test.ts` | auth test | `packages/auth/src/__tests__/token-sanitization.test.ts` | No |
| `core/src/auth/precedence.test.ts` | auth test | `packages/auth/src/__tests__/precedence.test.ts` | Yes (SettingsService) |
| `core/src/auth/precedence.adapter.test.ts` | auth test | `packages/auth/src/__tests__/precedence.adapter.test.ts` | Yes (@vybestack/llxprt-code-providers) |
| `core/src/auth/auth-integration.spec.ts` | auth test | `packages/auth/src/__tests__/auth-integration.spec.ts` | Yes (core symbols) |
| `core/src/auth/codex-device-flow.spec.ts` | auth test | `packages/auth/src/__tests__/codex-device-flow.spec.ts` | No |
| `core/src/auth/oauth-errors.spec.ts` | auth test | `packages/auth/src/__tests__/oauth-errors.spec.ts` | No |
| `core/src/auth/oauth-logout-cache-invalidation.spec.ts` | auth test | `packages/auth/src/__tests__/oauth-logout-cache-invalidation.spec.ts` | Yes (SettingsService) |
| `core/src/auth/token-store.spec.ts` | auth test | `packages/auth/src/__tests__/token-store.spec.ts` | No |
| `core/src/auth/token-store.refresh-race.spec.ts` | auth test | `packages/auth/src/__tests__/token-store.refresh-race.spec.ts` | No |
| `core/src/auth/invalidateProviderCache.test.ts` | auth test | `packages/auth/src/__tests__/invalidateProviderCache.test.ts` | Yes (SettingsService) |
| `core/src/auth/qwen-device-flow.spec.ts` | auth test | `packages/auth/src/__tests__/qwen-device-flow.spec.ts` | No |
| `core/src/auth/proxy/__tests__/framing.test.ts` | auth test (proxy) | `packages/auth/src/proxy/__tests__/framing.test.ts` | No |
| `core/src/auth/proxy/__tests__/proxy-provider-key-storage.test.ts` | auth test (proxy) | `packages/auth/src/proxy/__tests__/proxy-provider-key-storage.test.ts` | No |
| `core/src/auth/proxy/__tests__/proxy-socket-client.test.ts` | auth test (proxy) | `packages/auth/src/proxy/__tests__/proxy-socket-client.test.ts` | No |
| `core/src/auth/proxy/__tests__/proxy-token-store.test.ts` | auth test (proxy) | `packages/auth/src/proxy/__tests__/proxy-token-store.test.ts` | No |

#### Test Migration Policy

Core auth tests that import from outside `packages/auth` MUST be refactored to use local DI test doubles before moving to `packages/auth`. All 20 test files have `packages/auth` as their final destination — none are relocated to owning packages.

1. **Auth-package-local tests** (13 tests) — tests with no cross-package deps, move as-is.
2. **Cross-package-dependent tests** (7 tests) — must be refactored with local DI test doubles before move:
   - `precedence.adapter.test.ts` — imports `@vybestack/llxprt-code-providers` → local DI test double
   - `invalidateProviderCache.test.ts` — imports core `SettingsService` → `ISettingsService` test double
   - `precedence.test.ts` — imports core `SettingsService` → `ISettingsService` test double
   - `keyring-token-store.test.ts` — imports core `SecureStore` → `ISecureStore` test double
   - `keyring-token-store.integration.test.ts` — imports core `SecureStore`/`DebugLogger` → DI test doubles
   - `auth-integration.spec.ts` — imports core symbols → DI test doubles
   - `oauth-logout-cache-invalidation.spec.ts` — imports core `SettingsService` → `ISettingsService` test double

3. **Enforcement** — a scan MUST fail if `packages/auth` tests import `@vybestack/llxprt-code-core`, `@vybestack/llxprt-code-providers`, or any sibling package.

Total in auth: 20. Relocated to owning packages: 0.

### Stays in packages/cli — Pure Production (34 files)

All files under `packages/cli/src/auth/` remain in CLI. They will have their `@vybestack/llxprt-code-core` imports for auth types migrated to `@vybestack/llxprt-code-auth`.

Key import migration targets (30 CLI production files import from `@vybestack/llxprt-code-core`):
- Auth type imports (`OAuthToken`, `TokenStore`, `OAuthError`, `OAuthErrorFactory`, `OAuthTokenRequestMetadata`, `CodexDeviceFlow`) → `@vybestack/llxprt-code-auth`
- Non-auth core imports (`DebugLogger`, `debugLogger`, `MessageBus`, `PolicyEngine`, `Config`, `ProfileManager`) → remain `@vybestack/llxprt-code-core`
- Re-export `KeyringTokenStore` in `types.ts` → `@vybestack/llxprt-code-auth`

### Stays in packages/cli — Test Helpers (2 files + 1 utility)

```text
packages/cli/src/auth/BucketFailoverHandlerImpl.test-helpers.ts     (99 lines)
packages/cli/src/auth/oauth-manager.issue1468.test-helpers.ts       (175 lines)
packages/cli/src/auth/__tests__/behavioral/test-utils.ts             (test utility)
```

### Stays in packages/providers — Import Migration Only (6 production + 3 test = 9 files)

These files import auth types from `@vybestack/llxprt-code-core/auth/` via deep-path imports and must update to `@vybestack/llxprt-code-auth`. They do NOT move packages.

**Production:**
- `packages/providers/src/BaseProvider.ts` — `AuthPrecedenceResolver`, `AuthPrecedenceConfig`, `OAuthManager` from `core/auth/precedence.js`
- `packages/providers/src/gemini/GeminiProvider.ts` — `OAuthManager` from `core/auth/precedence.js`
- `packages/providers/src/anthropic/AnthropicProvider.ts` — `OAuthManager` from `core/auth/precedence.js`
- `packages/providers/src/openai/OpenAIProvider.ts` — `OAuthManager` from `core/auth/precedence.js`
- `packages/providers/src/openai-vercel/OpenAIVercelProvider.ts` — `OAuthManager` from `core/auth/precedence.js`
- `packages/providers/src/openai-responses/OpenAIResponsesProviderBase.ts` — `CodexOAuthTokenSchema` from `core/auth/types.js`, `OAuthManager` from `core/auth/precedence.js`

**Test:**
- `packages/providers/src/BaseProvider.test.ts` — `OAuthManager`, `OAuthTokenRequestMetadata` from `core/auth/precedence.js`
- `packages/providers/src/openai/openai-oauth.spec.ts` — `flushRuntimeAuthScope` from `core/auth/precedence.js`
- `packages/providers/src/openai-responses/__tests__/OpenAIResponsesProvider.promptCacheKey.test.ts` — `type CodexOAuthToken` from `core/auth/types.js`

**Count confirmed:** P01 `rg` scan confirms exactly 9 files (6 prod + 3 test). Matches P00a preflight and plan-time expected count.

## New Files in packages/auth

| New Path | Purpose |
|----------|---------|
| `packages/auth/src/interfaces/secure-store.ts` | ISecureStore (get, set, delete, list, has + ISecureStoreError/SecureStoreErrorCode) |
| `packages/auth/src/interfaces/settings-service.ts` | ISettingsService (get, getProviderSettings, on, off) |
| `packages/auth/src/interfaces/provider-key-storage.ts` | IProviderKeyStorage (getKey, listKeys, hasKey — instance methods only) |
| `packages/auth/src/interfaces/debug-logger.ts` | IDebugLogger (debug, error, warn, log — all 4 confirmed by P00a usage evidence) |
| `packages/auth/src/interfaces/runtime-context.ts` | IProviderRuntimeContext (settingsService, config?, runtimeId?, metadata?) |
| `packages/auth/src/interfaces/index.ts` | Re-exports |
| `packages/auth/src/index.ts` | Public API |

## Files NOT Moving to packages/auth

### BaseTokenStore (MCP subsystem — not auth domain)

`BaseTokenStore` at `packages/core/src/mcp/token-store.ts` is an abstract class in the MCP subsystem. Its consumers are `FileTokenStore` and MCP tests. Unrelated to auth `TokenStore` hierarchy. **No move required.** Confirmed by P00a preflight.

### code_assist/oauth2.ts (separate module — not auth domain)

Exported from `core/src/index.ts` at line 92. Separate from the auth module extraction.

### StreamProcessor.ts (core consumer — import migration only)

`packages/core/src/core/StreamProcessor.ts` imports `flushRuntimeAuthScope` from `../auth/precedence.js`. This will change to `@vybestack/llxprt-code-auth` or core re-export after migration. **No move.**

## Coverage

- Core auth: 15 production + 20 test = 35 TS files classified, **100% coverage**.
- CLI auth: 34 pure production + 2 test-helpers + 1 test-utils classified; all stay in CLI.
- CLI auth tests: 129 test/spec files; all stay in CLI.
- New auth package: 7 interface files + 1 index = 8 new files.
- Providers auth imports: 6 production + 3 test = 9 files confirmed by P01 `rg`. All stay in providers with import migration.
- Core non-auth consumers: 1 production file (`StreamProcessor.ts`) + 1 test + `index.ts`.
