# Phase P00a: Preflight Verification Results

Plan ID: PLAN-20260608-ISSUE1586.P00a
Date: 2026-06-08

## PACKAGE MANAGER GATE: PASS

**Status: RESOLVED — npm declared authoritative, gate passes.**

### Original Evidence (pre-resolution)

| Signal | Value | Notes |
|--------|-------|-------|
| `packageManager` field in root `package.json` | `pnpm@10.17.0+sha512.fce8a3dd...` | Declared pnpm (stale/incorrect) |
| `pnpm-lock.yaml` exists? | **NO** | Not present in repo |
| `package-lock.json` exists? | **YES** | 788KB, present and in git |
| CI workflow npm commands | **16** (ci.yml), **11** (release.yml), **10** (e2e.yml), etc. | Zero pnpm commands in any CI workflow |
| CI workflow pnpm commands | **0** | No CI workflow uses pnpm |
| `npm run check:lockfile` | **PASSES** | Validates package-lock.json integrity |
| `pnpm-lock.yaml` ever in git history? | **NO** | `git log --all -- pnpm-lock.yaml` returns empty |
| `.npmrc` | Present, contains `@vybestack:registry=https://registry.npmjs.org/` | npm-compatible |

### Resolution Decision

**Strategy: Make npm authoritative.** Update `packageManager` field to match the installed npm version.

Rationale: Every converging signal (lockfile, CI workflows, git history, `.npmrc`) confirms npm is the actual package manager in use. The `pnpm` declaration was a stale inconsistency — no pnpm infrastructure exists anywhere in the repo.

**Action taken:** Updated `package.json` `packageManager` from `pnpm@10.17.0+sha512.fce8a3dd...` to `npm@11.6.2` (installed npm version).

### Post-Resolution Evidence

| Check | Result |
|-------|--------|
| `packageManager` field | `npm@11.6.2` |
| `npm --version` | `11.6.2` |
| `node -e "JSON.parse(require('fs').readFileSync('package.json')).packageManager.startsWith('npm@')"` | `true` |
| `npm run check:lockfile` | PASSES |
| `package-lock.json` present | YES |
| `pnpm-lock.yaml` present | NO (correct — npm is authoritative) |

---

## Dependency Verification

| Dependency | npm ls Output | Status |
|------------|---------------|--------|
| `zod` | zod@3.25.76 (deduped in root, core, providers, cli, lsp) | [OK] OK |
| `vitest` | vitest@3.2.4 (present in root devDependencies, all workspaces) | [OK] OK |
| `@napi-rs/keyring` | @napi-rs/keyring@1.2.0 (only in core package) | [OK] OK |

## Type/Interface Verification

| Type Name | Expected Definition | Actual Definition | Match? |
|-----------|---------------------|-------------------|--------|
| `SettingsService` | get, getProviderSettings, on, off | `class SettingsService extends EventEmitter implements ISettingsService` — has `get(key)`, `getProviderSettings(provider)`, `on(event, listener)`, `off(event, listener)` | [OK] YES (concrete class; ISettingsService interface also exists in `settings/types.ts` with broader API — structural typing subset for `ISettingsService` matches) |
| `SecureStore` | get, set, delete, list, has | `class SecureStore` with `async get(key)`, `async set(key, value)`, `async delete(key)`, `async list()`, `async has(key)` — 5 methods confirmed at lines 514, 437, 573, 611, 657 of `storage/secure-store.ts` | [OK] YES |
| `ProviderRuntimeContext` | settingsService, config, runtimeId | `interface ProviderRuntimeContext { settingsService: SettingsService; config?: Config; runtimeId?: string; metadata?: Record<string, unknown> }` | [OK] YES |
| `DebugLogger` | `debug`, `error`, `warn` (instance contract); `debugLogger` singleton and constructor are core factory concerns | `class DebugLogger` with methods: `debug`, `error`, `warn`, `log`, `getLogger` (factory). Module-level singleton: `debugLogger` from `utils/debugLogger.js`. Constructor: `new DebugLogger(namespace)`. Auth files use both: (1) `new DebugLogger('llxprt:auth:...')` for instance loggers, (2) `debugLogger.warn/debug/error` for module-level calls. | [OK] YES — instance contract covers `debug`, `error`, `warn`; `log` used in auth-relevant files too. IDebugLogger should include `log` method based on actual usage evidence below. |
| `OAuthManager` | getToken, isAuthenticated, getOAuthToken | Core: `interface OAuthManager { getToken, isAuthenticated, getOAuthToken? }` in `precedence.ts`. CLI: `class OAuthManager implements BucketFailoverOAuthManagerLike` with `getToken`, `isAuthenticated`, `getOAuthToken`. | [OK] YES (core interface is narrower — only getToken, isAuthenticated, getOAuthToken optional; CLI class is broader) |
| `getProviderKeyStorage` | returns object with getKey, listKeys, hasKey | `export class ProviderKeyStorage` with `getKey`, `listKeys`, `hasKey`, `saveKey`, `deleteKey`. Singleton `getProviderKeyStorage()` returns `ProviderKeyStorage` instance. | [OK] YES (has getKey, listKeys, hasKey plus saveKey/deleteKey) |

## DebugLogger Auth-Relevant Usage Preflight

### Core auth files (`packages/core/src/auth/`)
| File | Usage Pattern | Methods Called |
|------|---------------|----------------|
| `auth-precedence-resolver.ts` | `new DebugLogger('llxprt:auth:precedence')` (instance), `debugLogger.debug/warn` (module-level singleton) | `debug`, `warn` (both patterns) |
| `precedence.ts` | `debugLogger.debug/warn` (module-level singleton) | `debug`, `warn` |
| `keyring-token-store.ts` | `new DebugLogger('llxprt:keyring-token-store')` (instance) | `debug`, `error`, `warn` (instance) |
| `codex-device-flow.ts` | `new DebugLogger('llxprt:auth:codex-device-flow')` (instance) | instance methods |

### CLI auth files (`packages/cli/src/auth/`)
| File | Usage Pattern | Methods Called |
|------|---------------|----------------|
| `codex-oauth-provider.ts` | `new DebugLogger('llxprt:auth:codex')`, `debugLogger.log/warn` | `debug`, `error`, `warn`, `log` |
| `gemini-oauth-provider.ts` | `new DebugLogger('llxprt:auth:gemini')`, `debugLogger.log/warn` | `debug`, `error`, `warn`, `log` |
| `qwen-oauth-provider.ts` | `new DebugLogger('llxprt:auth:qwen')`, `debugLogger.log/warn` | `debug`, `error`, `warn`, `log` |
| `anthropic-oauth-provider.ts` | `new DebugLogger('llxprt:auth:anthropic')`, `debugLogger.warn/log` | `debug`, `error`, `warn`, `log` |
| `auth-flow-orchestrator.ts` | `new DebugLogger(...)`, `debugLogger.log` | `debug`, `error`, `warn`, `log` |
| `BucketFailoverHandlerImpl.ts` | `new DebugLogger('llxprt:bucket:failover:handler')` | instance methods |
| `token-access-coordinator.ts` | `new DebugLogger(...)` | instance methods |
| `token-refresh-helper.ts` | `new DebugLogger(...)` | instance methods |

### IDebugLogger Interface Derived from Actual Usage

Based on the grep evidence, `IDebugLogger` must include: **`debug`, `error`, `warn`, `log`** — all four are used in auth-relevant files. The `debugLogger` module-level singleton and `DebugLogger` class constructor are core factory concerns and should NOT move to auth.

## Call Path Verification

| Function | Expected Caller | Actual Caller | Evidence |
|----------|-----------------|---------------|----------|
| `AuthPrecedenceResolver` | Core runtime, CLI auth | `packages/providers/src/BaseProvider.ts:L151` (constructs directly), `packages/cli/src/integration-tests/oauth-timing.integration.test.ts` | [OK] Confirmed — BaseProvider constructs AuthPrecedenceResolver directly, not via factory |
| `KeyringTokenStore` | CLI oauth-manager, core factories | `packages/cli/src/auth/codex-oauth-provider.ts`, `packages/cli/src/auth/proxy/credential-store-factory.ts`, `packages/cli/src/runtime/runtimeContextFactory.ts`, `packages/cli/src/auth/proxy/sandbox-proxy-lifecycle.ts`, `packages/cli/src/auth/types.ts`, plus test files | [OK] Confirmed |
| `ProxyTokenStore` | CLI credential-store-factory | `packages/cli/src/auth/proxy/credential-store-factory.ts`, test files | [OK] Confirmed |
| `CodexDeviceFlow` | CLI codex-oauth-provider | `packages/cli/src/auth/codex-oauth-provider.ts`, `packages/cli/src/auth/proxy/sandbox-proxy-lifecycle.ts` | [OK] Confirmed |

## Test Infrastructure Verification

| Component | Test File Exists? | Notes |
|-----------|-------------------|-------|
| AuthPrecedenceResolver | [OK] YES | `packages/core/src/auth/precedence.test.ts`, `packages/core/src/auth/precedence.adapter.test.ts`, `packages/providers/src/BaseProvider.test.ts` |
| KeyringTokenStore | [OK] YES | `packages/core/src/auth/__tests__/keyring-token-store.test.ts`, `packages/core/src/auth/__tests__/keyring-token-store.integration.test.ts` |
| ProxyTokenStore | [OK] YES | `packages/core/src/auth/proxy/__tests__/` directory exists with integration and e2e test files |
| OAuth errors | [OK] YES | `packages/core/src/auth/oauth-errors.spec.ts`, `packages/core/src/auth/oauth-logout-cache-invalidation.spec.ts` |

## Package Verification

| Item | Expected | Actual | Status |
|------|----------|--------|--------|
| `packages/storage` exists? | NO | NO | [OK] Confirmed absent |
| `packages/auth` exists? | NO (pre-scaffold) | NO | [OK] Confirmed absent |
| Providers imports from core/auth? | YES (expected: 6 prod + 3 test = 9) | 9 files found (see list below) | [OK] Count matches |
| Provider auth import preflight exact file list | | See below | [OK] Authoritative |

### Provider Auth Import File List

```
packages/providers/src/openai-responses/OpenAIResponsesProviderBase.ts        (2 imports: CodexOAuthTokenSchema, OAuthManager)
packages/providers/src/openai-responses/__tests__/OpenAIResponsesProvider.promptCacheKey.test.ts  (1 import)
packages/providers/src/openai/openai-oauth.spec.ts                           (1 import)
packages/providers/src/openai/OpenAIProvider.ts                                (1 import: OAuthManager)
packages/providers/src/BaseProvider.test.ts                                    (2 imports: OAuthManager, OAuthTokenRequestMetadata)
packages/providers/src/BaseProvider.ts                                         (1 import: AuthPrecedenceResolver, OAuthManager, AuthPrecedenceConfig)
packages/providers/src/gemini/GeminiProvider.ts                                (1 import: OAuthManager)
packages/providers/src/openai-vercel/OpenAIVercelProvider.ts                   (1 import: OAuthManager)
packages/providers/src/anthropic/AnthropicProvider.ts                          (1 import: OAuthManager)
```

Total: 9 files (6 production + 3 test/spec). [OK] Matches plan-time expected count.

## Preflight Convention Checks

| Check | Result | Evidence |
|-------|--------|----------|
| Package-local format script | [OK] `prettier --write .` | `packages/core/package.json` line 72: `"format": "prettier --write ."` — matches package convention, NOT root convention (`prettier --experimental-cli --write .`) |
| providers depends on core | [OK] `true` | `node -e "const p=require('./packages/providers/package.json'); console.log(!!p.dependencies['@vybestack/llxprt-code-core'])"` → `true` |
| AuthPrecedenceResolver constructor signature | [OK] Matches plan | `constructor(config: AuthPrecedenceConfig, oauthManager?: OAuthManager, settingsService?: SettingsService)` — confirmed at `auth-precedence-resolver.ts:L71` |
| AuthPrecedenceResolver defined in `auth-precedence-resolver.ts` | [OK] YES | Class defined at `auth-precedence-resolver.ts:L71`. `precedence.ts` only re-exports: `export { AuthPrecedenceResolver } from './auth-precedence-resolver.js'` at line 515. |
| BaseProvider constructs AuthPrecedenceResolver directly | [OK] YES | `BaseProvider.ts:L151`: `this.authResolver = new AuthPrecedenceResolver(precedenceConfig, config.oauthManager, fallbackSettingsService)` — direct construction, not factory |
| SettingsService public API includes get, getProviderSettings, on, off | [OK] YES | `SettingsService.get(key)` at line 57, `getProviderSettings(provider)` at line 99, `on/off` via EventEmitter + manual impl at lines 246-251 |

## BaseTokenStore Preflight Check

| Check | Result | Evidence |
|-------|--------|----------|
| `BaseTokenStore` is in `packages/core/src/mcp/token-store.ts` (not `auth/`) | [OK] YES | `packages/core/src/mcp/token-store.ts:L57`: `export abstract class BaseTokenStore` |
| `BaseTokenStore` consumers are all MCP files | [OK] YES | `mcp/file-token-store.ts`, `mcp/token-store.test.ts` — all MCP subsystem |
| No move required | [OK] Confirmed | "BaseTokenStore is MCP subsystem, not auth domain. No move required." |
| `TokenStore` interface (auth) + `KeyringTokenStore`/`ProxyTokenStore` are auth domain | [OK] Confirmed | `packages/core/src/auth/token-store.ts:L17`: `export interface TokenStore`, `keyring-token-store.ts:L73`: `export class KeyringTokenStore implements TokenStore`, `proxy/proxy-token-store.ts:L20`: `export class ProxyTokenStore implements TokenStore` |

## ISecureStore Contract Preflight Check

| Check | Result | Evidence |
|-------|--------|----------|
| `SecureStore` exposes get, set, delete, list, has (5 methods) | [OK] YES | Line 514: `async get(key)`, Line 437: `async set(key, value)`, Line 573: `async delete(key)`, Line 611: `async list()`, Line 657: `async has(key)` |
| `KeyringTokenStore` uses `secureStore.list()` | [OK] YES | Line 414: `const allKeys = await this.secureStore.list()`, Line 437: `const allKeys = await this.secureStore.list()` |
| `SecureStoreError` has `code: SecureStoreErrorCode`, `message: string`, `remediation: string` | [OK] YES | `SecureStoreError extends Error { code: SecureStoreErrorCode; remediation: string }` (message inherited from Error) |
| `SecureStoreErrorCode` is union of specific codes | [OK] YES | `type SecureStoreErrorCode = 'UNAVAILABLE' \| 'LOCKED' \| 'DENIED' \| 'CORRUPT' \| 'TIMEOUT' \| 'NOT_FOUND'` |
| `KeyringTokenStore` catches `SecureStoreError` by instanceof and checks `error.code` | [OK] YES | Line 349: `if (error instanceof SecureStoreError && error.code === 'CORRUPT')` |

## KeyringTokenStore Node Builtins Preflight Check

| Check | Result | Evidence |
|-------|--------|----------|
| Uses `node:fs/promises` | [OK] YES | Line 20: `import { promises as fs } from 'node:fs'` |
| Uses `node:path` | [OK] YES | Line 21: `import { join } from 'node:path'` |
| Uses `node:os` | [OK] YES | Line 22: `import { homedir } from 'node:os'` |
| Does NOT import `@napi-rs/keyring` | [OK] YES | No direct import of `@napi-rs/keyring` — only uses `SecureStore` which wraps it |
| Does NOT import `SecureStore`/`KeyringAdapter` directly for keyring ops | [OK] YES | Imports `SecureStore` and `SecureStoreError` from `../storage/secure-store.js` for delegation, not direct keyring access |

**Accepted interim design**: Node builtins for file-lock coordination remain in auth; native keyring and SecureStore/KeyringAdapter do not move into auth.

## IProviderKeyStorage Contract Preflight Check

| Check | Result | Evidence |
|-------|--------|----------|
| `getProviderKeyStorage()` returns `ProviderKeyStorage` instance | [OK] YES | Singleton factory at `storage/provider-key-storage.ts:L133` |
| `ProviderKeyStorage` has `getKey` method | [OK] YES | Line: `async getKey(name: string): Promise<string \| null>` |
| `ProviderKeyStorage` has `listKeys` method | [OK] YES | Line: `async listKeys(): Promise<string[]>` |
| `ProviderKeyStorage` has `hasKey` method | [OK] YES | Line: `async hasKey(name: string): Promise<boolean>` |
| `IProviderKeyStorage` would be instance contract (getKey, listKeys, hasKey) | [OK] YES — factory `getProviderKeyStorage()` stays in core; interface defines instance shape |

## OAuthProvider Ownership Verification

| Check | Result | Evidence |
|-------|--------|----------|
| `OAuthProvider` interface stays in CLI | [OK] YES | `packages/cli/src/auth/types.ts:L37`: `export interface OAuthProvider` — only used by CLI adapter classes |
| `OAuthManager` interface used by `AuthPrecedenceResolver` is in core | [OK] YES | `packages/core/src/auth/precedence.ts:L46`: `export interface OAuthManager` |
| `OAuthManager` class (CLI implementation) stays in CLI | [OK] YES | `packages/cli/src/auth/oauth-manager.ts:L39`: `export class OAuthManager` |

## Blocking Issues Found

### RESOLVED: Package Manager Conflict (was BLOCKING)

**Issue**: `packageManager` field in root `package.json` declares `pnpm@10.17.0`, but:
- Only `package-lock.json` exists (no `pnpm-lock.yaml`)
- ALL CI workflows use `npm` commands exclusively (0 pnpm commands found)
- `npm run check:lockfile` validates `package-lock.json` integrity
- `pnpm-lock.yaml` has never existed in git history

**Resolution applied**: Updated `packageManager` field in root `package.json` from `pnpm@10.17.0+sha512.fce8a3dd...` to `npm@11.6.2`. npm is authoritative: it is the sole lockfile, the sole CI workflow tool, and the sole package manager with any git history in this repo.

**All other P00a checks pass.** The package-manager gate is the sole blocker.

---

## Summary

| Gate | Status |
|------|--------|
| Dependencies (zod, vitest, @napi-rs/keyring) | [OK] PASS |
| Type/Interface verification | [OK] PASS |
| Call path verification | [OK] PASS |
| Test infrastructure verification | [OK] PASS |
| Package verification (no storage/auth packages, provider imports) | [OK] PASS |
| Package manager gate | PASS — resolved: `packageManager` updated to `npm@11.6.2` |
| Preflight convention checks | [OK] PASS |
| BaseTokenStore = MCP domain (no move) | [OK] PASS |
| ISecureStore full contract (5 methods + error types) | [OK] PASS |
| IProviderKeyStorage instance contract | [OK] PASS |
| IDebugLogger contract from actual usage | [OK] PASS |
| KeyringTokenStore Node builtins | [OK] PASS |
| OAuthProvider stays in CLI | [OK] PASS |
| AuthPrecedenceResolver defined in auth-precedence-resolver.ts only | [OK] PASS |

**OVERALL P00a STATUS: PASS** — All gates pass. Package manager conflict resolved: `packageManager` updated from `pnpm@10.17.0` to `npm@11.6.2`.