# Dependency Audit: Auth Package Extraction

Plan ID: PLAN-20260608-ISSUE1586
Updated: Phase P01 (evidence-refreshed from actual code)

## Evidence Collected

### Core Auth Production Files (15 files) — External Imports Audit

| File | Lines | External Dependencies (outside auth/) |
|------|-------|--------------------------------------|
| `types.ts` | 106 | `zod` (npm) |
| `token-store.ts` | 107 | `./types.js` (internal) — zero external |
| `keyring-token-store.ts` | 534 | `node:fs`, `node:path`, `node:os` (builtins); `../storage/secure-store.js` → **SecureStore, SecureStoreError** (DI → ISecureStore); `../debug/index.js` → **DebugLogger** (DI → IDebugLogger) |
| `oauth-errors.ts` | 647 | Zero external imports |
| `token-merge.ts` | 29 | `./types.js` (internal) — zero external |
| `token-sanitization.ts` | 24 | `./types.js` (internal) — zero external |
| `precedence.ts` | 514 | `../settings/SettingsService.js` → **SettingsService** (type-only, DI → ISettingsService); `../runtime/providerRuntimeContext.js` → **ProviderRuntimeContext** (type-only, DI → IProviderRuntimeContext); `../utils/debugLogger.js` → **debugLogger** (value import, DI → IDebugLogger) |
| `auth-precedence-resolver.ts` | 688 | `node:fs/promises`, `node:path`, `node:os` (builtins, keyfile reads); `../settings/SettingsService.js` → **SettingsService** (type, DI → ISettingsService); `../runtime/providerRuntimeContext.js` → **getActiveProviderRuntimeContext, ProviderRuntimeContext** (value + type, DI → injected fn + IProviderRuntimeContext); `../debug/index.js` → **DebugLogger** (DI → IDebugLogger); `../storage/provider-key-storage.js` → **getProviderKeyStorage** (DI → IProviderKeyStorage); `../utils/debugLogger.js` → **debugLogger** (DI → IDebugLogger) |
| `anthropic-device-flow.ts` | 284 | `crypto` (builtin), `node:url` (builtin) |
| `codex-device-flow.ts` | 644 | `crypto` (builtin), `../debug/index.js` → **DebugLogger** (DI → IDebugLogger), `zod` (npm) |
| `qwen-device-flow.ts` | 227 | `crypto` (builtin) |
| `proxy/framing.ts` | 111 | Zero external imports |
| `proxy/proxy-socket-client.ts` | 278 | `node:net`, `node:crypto` (builtins) |
| `proxy/proxy-token-store.ts` | 119 | `../types.js` (internal); `../token-store.js` (internal); `./proxy-socket-client.js` (internal) — zero external |
| `proxy/proxy-provider-key-storage.ts` | 57 | `./proxy-socket-client.js` (internal) — zero external |

**DI refactoring needed in 4 files:**
1. `keyring-token-store.ts` — SecureStore → ISecureStore, DebugLogger → IDebugLogger
2. `precedence.ts` — SettingsService → ISettingsService, ProviderRuntimeContext → IProviderRuntimeContext, debugLogger → IDebugLogger
3. `auth-precedence-resolver.ts` — SettingsService → ISettingsService, ProviderRuntimeContext → IProviderRuntimeContext, getProviderKeyStorage → IProviderKeyStorage, DebugLogger → IDebugLogger, debugLogger → IDebugLogger
4. `codex-device-flow.ts` — DebugLogger → IDebugLogger

**Note on auth-precedence-resolver.ts builtins:** `node:fs/promises`, `node:path`, `node:os` are used for file-based keyfile reads (lines 595-600). After DI refactoring, if keyfile reads are pushed to injected `IProviderKeyStorage` implementations, these imports may become unnecessary. Verify at P11 implementation whether they can be removed.

### Core Auth Test Files (20 files) — Cross-Package Dependencies

| Test File | Lines | Cross-Package Dependencies |
|----------|-------|---------------------------|
| `__tests__/authRuntimeScope.test.ts` | 143 | `SettingsService` (core), `createProviderRuntimeContext` (core) |
| `__tests__/codex-device-flow.test.ts` | 440 | `zod` (npm), `http`/`net` (builtins) — no core deps |
| `__tests__/keyring-token-store.integration.test.ts` | 751 | `fast-check` (npm), `SecureStore` (core), `DebugLogger` (core) |
| `__tests__/keyring-token-store.test.ts` | 1685 | `fast-check` (npm), `SecureStore` (core) |
| `__tests__/token-merge.test.ts` | 215 | None external |
| `__tests__/token-sanitization.test.ts` | 166 | None external |
| `auth-integration.spec.ts` | 561 | Core symbols |
| `codex-device-flow.spec.ts` | 259 | `crypto` (builtin) — no core deps |
| `invalidateProviderCache.test.ts` | 293 | `SettingsService` (core) |
| `oauth-errors.spec.ts` | 697 | None external |
| `oauth-logout-cache-invalidation.spec.ts` | 137 | `SettingsService` (core) |
| `precedence.adapter.test.ts` | 98 | `@vybestack/llxprt-code-providers`, `SettingsService` (core), `providerRuntimeContext` (core) |
| `precedence.test.ts` | 747 | `SettingsService` (core) |
| `proxy/__tests__/framing.test.ts` | 342 | None external |
| `proxy/__tests__/proxy-provider-key-storage.test.ts` | 356 | None external |
| `proxy/__tests__/proxy-socket-client.test.ts` | 443 | None external |
| `proxy/__tests__/proxy-token-store.test.ts` | 497 | None external |
| `qwen-device-flow.spec.ts` | 975 | `http`/`net`/`crypto` (builtins) — no core deps |
| `token-store.refresh-race.spec.ts` | 283 | `fs`/`path`/`os` (builtins) — no core deps |
| `token-store.spec.ts` | 454 | `fs`/`path`/`os` (builtins), `SecureStore` (core) |

**7 tests with cross-package deps requiring DI refactoring:**
1. `precedence.adapter.test.ts` → `@vybestack/llxprt-code-providers` + core `SettingsService`/`providerRuntimeContext`
2. `invalidateProviderCache.test.ts` → core `SettingsService`
3. `precedence.test.ts` → core `SettingsService`
4. `keyring-token-store.test.ts` → core `SecureStore`
5. `keyring-token-store.integration.test.ts` → core `SecureStore`/`DebugLogger`
6. `auth-integration.spec.ts` → core symbols
7. `oauth-logout-cache-invalidation.spec.ts` → core `SettingsService`

**13 tests with no cross-package deps — move as-is.**

### CLI Auth Production Files — Core Import Audit

30 of 34 pure production files import from `@vybestack/llxprt-code-core`. Key import categories:

| Import Category | Symbols | Files Affected | Migration Target |
|----------------|---------|---------------|-----------------|
| Auth types | `OAuthToken`, `TokenStore`, `OAuthError`, `OAuthErrorFactory`, `OAuthTokenRequestMetadata`, `CodexDeviceFlow`, `flushRuntimeAuthScope`, `ProxySocketClient`, `encodeFrame`, `FrameDecoder`, `sanitizeTokenForProxy`, `mergeRefreshedToken`, `KeyringTokenStore`, `ProxyTokenStore`, `ProxyProviderKeyStorage`, `AuthPrecedenceConfig`, `RuntimeAuthScopeFlushResult`, `BucketStats` | 30 files | `@vybestack/llxprt-code-auth` |
| Core debug | `DebugLogger`, `debugLogger` | 8 files | Remain `@vybestack/llxprt-code-core` |
| Core runtime | `MessageBus`, `PolicyEngine`, `Config` | 4 files | Remain `@vybestack/llxprt-code-core` |
| Core profile | `ProfileManager` | 1 file | Remain `@vybestack/llxprt-code-core` |

**Note:** Some files import BOTH auth and non-auth symbols from core. These will need split imports:
- `types.ts` re-exports `KeyringTokenStore` from core → `@vybestack/llxprt-code-auth`
- `oauth-manager.ts` imports both auth types and `MessageBus`/`PolicyEngine` → split import

### Providers Auth Import Files (6 production + 3 test = 9 files)

All confirmed by P01 `rg -l "from ['\"]@vybestack/llxprt-code-core/auth" packages/providers/src --glob '*.ts'`:

| Providers File | Core Auth Symbols Imported | Deep-Path |
|---------------|---------------------------|-----------|
| `BaseProvider.ts` | `AuthPrecedenceResolver`, `AuthPrecedenceConfig`, `OAuthManager` | `core/auth/precedence.js` |
| `GeminiProvider.ts` | `type OAuthManager` | `core/auth/precedence.js` |
| `AnthropicProvider.ts` | `type OAuthManager` | `core/auth/precedence.js` |
| `OpenAIProvider.ts` | `type OAuthManager` | `core/auth/precedence.js` |
| `OpenAIVercelProvider.ts` | `type OAuthManager` | `core/auth/precedence.js` |
| `OpenAIResponsesProviderBase.ts` | `CodexOAuthTokenSchema`, `type OAuthManager` | `core/auth/types.js`, `core/auth/precedence.js` |
| `BaseProvider.test.ts` | `type OAuthManager`, `type OAuthTokenRequestMetadata` | `core/auth/precedence.js` |
| `openai/openai-oauth.spec.ts` | `flushRuntimeAuthScope` | `core/auth/precedence.js` |
| `openai-responses/__tests__/OpenAIResponsesProvider.promptCacheKey.test.ts` | `type CodexOAuthToken` | `core/auth/types.js` |

**All use deep-path imports** (`@vybestack/llxprt-code-core/auth/precedence.js` or `core/auth/types.js`). None import from `@vybestack/llxprt-code-core` main index. Migration: deep-path → `@vybestack/llxprt-code-auth`.

### Core Non-Auth Files Using Auth Imports

| File | Auth Symbol | Import Path | Migration |
|------|-----------|-------------|-----------|
| `core/src/core/StreamProcessor.ts` | `flushRuntimeAuthScope` | `../auth/precedence.js` (relative) | Import from `@vybestack/llxprt-code-auth` or core re-export |
| `core/src/core/StreamProcessor.unbucketed-auth-failover.test.ts` | `flushRuntimeAuthScope` | `../auth/precedence.js` (relative) | Same as above |
| `core/src/index.ts` | All auth re-exports | Various `./auth/*` paths | Remove auth directory exports, re-export from `@vybestack/llxprt-code-auth` |

## DI Interface Surface Audit

### ISettingsService

Used by (production): `precedence.ts` (type-only), `auth-precedence-resolver.ts` (constructor param)
Used by (test): `precedence.test.ts`, `precedence.adapter.test.ts`, `invalidateProviderCache.test.ts`, `oauth-logout-cache-invalidation.spec.ts`, `authRuntimeScope.test.ts`

Methods consumed (from P00a + P01 evidence):
- `get(key: string): unknown`
- `getProviderSettings(providerName: string): Record<string, unknown>`
- `on(event: string, handler: Function): void`
- `off(event: string, handler: Function): void`

### ISecureStore

Used by (production): `keyring-token-store.ts` (constructor injection)
Used by (test): `keyring-token-store.test.ts`, `keyring-token-store.integration.test.ts`, `token-store.spec.ts`

Methods consumed (from P01 `rg` evidence of `this.secureStore.*`):
- `get(key: string): Promise<string | null>`
- `set(key: string, value: string): Promise<void>`
- `delete(key: string): Promise<boolean>`
- `list(): Promise<string[]>`

Error types consumed:
- `SecureStoreError` (with `code: SecureStoreErrorCode`, `message: string`, `remediation: string`)
- `SecureStoreErrorCode` = `'UNAVAILABLE' | 'LOCKED' | 'DENIED' | 'CORRUPT' | 'TIMEOUT' | 'NOT_FOUND'`

### IProviderKeyStorage

Used by (production): `auth-precedence-resolver.ts` (via `getProviderKeyStorage()` factory → injected instance)
Used by (test): `precedence.test.ts` (mocked)

Methods consumed (instance contract):
- `getKey(provider: string): Promise<string | null>`
- `listKeys(): Promise<string[]>`
- `hasKey(provider: string): Promise<boolean>`

Factory `getProviderKeyStorage()` stays in core. Auth receives the instance via DI.

### IDebugLogger

Used by (production): `auth-precedence-resolver.ts`, `precedence.ts`, `keyring-token-store.ts`, `codex-device-flow.ts`
Used by (test): `keyring-token-store.test.ts`, `keyring-token-store.integration.test.ts`

Methods consumed (from P00a preflight grep — all 4 confirmed):
- `debug(...args): void`
- `error(...args): void`
- `warn(...args): void`
- `log(...args): void`

**P00a evidence:** Core auth files use `debug`, `warn` (precedence.ts, auth-precedence-resolver.ts), `debug`, `error`, `warn` (keyring-token-store.ts instance). CLI auth files additionally use `log`. All four methods must be in the interface.

Note: `debugLogger` module-level singleton and `new DebugLogger(namespace)` constructor are core factory concerns — they do NOT move to auth.

### IProviderRuntimeContext

Used by (production): `precedence.ts` (type-only), `auth-precedence-resolver.ts` (type + `getActiveProviderRuntimeContext()` function call)
Used by (test): `precedence.adapter.test.ts`, `authRuntimeScope.test.ts`

Properties consumed:
- `settingsService: ISettingsService`
- `config?: unknown`
- `runtimeId?: string`
- `metadata?: Record<string, unknown>`

Injected function:
- `getActiveRuntimeContext?: () => IProviderRuntimeContext | null` — replaces static `getActiveProviderRuntimeContext()` call

## External Dependency Summary

Core auth submodule imports by category:

| Subsystem | Core Imports | Production Files | DI Interface |
|-----------|-------------|-----------------|-------------|
| storage | `SecureStore`, `SecureStoreError`, `getProviderKeyStorage` | keyring-token-store, auth-precedence-resolver | ISecureStore, IProviderKeyStorage |
| debug | `DebugLogger`, `debugLogger` | keyring-token-store, precedence, auth-precedence-resolver, codex-device-flow | IDebugLogger |
| settings | `SettingsService` (type) | precedence, auth-precedence-resolver | ISettingsService |
| runtime | `ProviderRuntimeContext`, `getActiveProviderRuntimeContext` | precedence (type), auth-precedence-resolver | IProviderRuntimeContext + injected fn |

**All core auth external imports resolve to 4 subsystems requiring DI interfaces.** After DI refactoring, auth package has zero imports from `@vybestack/*` packages.

## Packages/storage Status

`packages/storage` does **not** exist in the current repository (confirmed: `ls packages/storage` → "No such file or directory"). Issue #1586 references `packages/storage` as a dependency, but since that package has not been extracted, auth defines `ISecureStore` and `IProviderKeyStorage` DI interfaces locally. This is an **intentional interim design** (see external-dependencies.md).

## Resolution Decisions

1. Define 5 DI interfaces in `packages/auth/src/interfaces/` (ISecureStore, ISettingsService, IProviderKeyStorage, IDebugLogger, IProviderRuntimeContext).
2. Core provides factory functions (`createKeyringTokenStore`, `createAuthPrecedenceResolver`) that inject core implementations.
3. CLI OAuth composition stays in CLI; adapters register against auth package interfaces.
4. `OAuthProvider` interface stays in `packages/cli/src/auth/types.ts` — only used by CLI adapters.
5. `OAuthManager` interface moves to auth (defined in `precedence.ts`); `OAuthManager` class stays in CLI.
6. `packages/storage` absent → DI interfaces as interim storage boundary.
7. `auth-precedence-resolver.ts` may lose `node:fs/promises`/`node:path`/`node:os` after DI (verify at P11).
8. `flushRuntimeAuthScope` exported from auth; core re-exports for consumer convenience (direct main-index, no deep-path shim).
9. `precedence.ts` refactored to eliminate all core imports (→ ISettingsService, IProviderRuntimeContext, IDebugLogger).
