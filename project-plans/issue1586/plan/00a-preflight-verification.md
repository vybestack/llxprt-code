# Phase P00a: Preflight Verification

Plan ID: PLAN-20260608-ISSUE1586.P00a

## Purpose
Verify ALL assumptions before writing any code.

## Dependency Verification
| Dependency | npm ls Output | Status |
|------------|---------------|--------|
| `zod` | [paste after preflight] | OK/MISSING |
| `vitest` | [paste after preflight] | OK/MISSING |
| `@napi-rs/keyring` | [paste after preflight] | OK/MISSING |

## Type/Interface Verification
| Type Name | Expected Definition | Actual Definition | Match? |
|-----------|---------------------|-------------------|--------|
| `SettingsService` | get, getProviderSettings, on, off | [paste] | YES/NO |
| `SecureStore` | get, set, delete, list, has | [paste] | YES/NO |
| `ProviderRuntimeContext` | settingsService, config, runtimeId | [paste] | YES/NO |
| `DebugLogger` | `debug`, `error`, `warn` (instance contract); `debugLogger` singleton and constructor are core factory concerns | [paste] | YES/NO |
| `OAuthManager` | getToken, isAuthenticated, getOAuthToken | [paste] | YES/NO |
| `getProviderKeyStorage` | returns object with getKey, listKeys, hasKey (factory; IProviderKeyStorage instance contract is what auth defines) | [paste] | YES/NO |

## Call Path Verification
| Function | Expected Caller | Actual Caller | Evidence |
|----------|-----------------|---------------|----------|
| `AuthPrecedenceResolver` | Core runtime, CLI auth | [grep] | [file:line] |
| `KeyringTokenStore` | CLI oauth-manager, core factories | [grep] | [file:line] |
| `ProxyTokenStore` | CLI credential-store-factory | [grep] | [file:line] |
| `CodexDeviceFlow` | CLI codex-oauth-provider | [grep] | [file:line] |

## Test Infrastructure Verification
| Component | Test File Exists? | Test Patterns Work? |
|-----------|-------------------|---------------------|
| AuthPrecedenceResolver | YES | [paste] |
| KeyringTokenStore | YES | [paste] |
| ProxyTokenStore | YES | [paste] |
| OAuth errors | YES | [paste] |

## Package Verification
| Item | Expected | Actual |
|------|----------|--------|
| `packages/storage` exists? | NO | [verify] |
| `packages/auth` exists? | NO (pre-scaffold) | [verify] |
| Providers imports from core/auth? | YES (plan-time expected count: 6 production + 3 test = 9; preflight must confirm actual count) | [verify by running `rg -l "from ['"]@vybestack/llxprt-code-core/auth" packages/providers/src --glob '*.ts'` and recording exact file list below] |
| Provider auth import preflight exact file list: | | [paste regenerated output here — this is the authoritative file list for the plan] |

## Package Manager Verification
- [ ] Run the mandatory executable gate script from P03 Step 0 (or equivalent): `node -e "..."` (see P03 Step 0 for the full gate script). The gate MUST inspect three signals: (1) the `packageManager` field in root `package.json`, (2) which lockfiles are present (`package-lock.json`, `pnpm-lock.yaml`, or both), and (3) what package manager commands CI workflow files actually use. If these signals conflict, the gate MUST exit non-zero and STOP the phase — do not allow both npm and pnpm paths to execute. Do NOT proceed with any install/lockfile commands until the gate passes.
- [ ] If CI uses npm: `npm install`/`package-lock.json` is authoritative. If the root `packageManager` field declares pnpm while CI uses npm, this is a **blocking conflict** — STOP and require a package-manager strategy decision before proceeding. Do not merely document the discrepancy.
- [ ] If CI uses pnpm: all plan npm commands MUST be replaced with pnpm equivalents. **Do NOT remove `package-lock.json`** — stop and require a package-manager strategy decision instead. Lockfile removal is out of scope and potentially destructive.

## IProviderKeyStorage Contract Preflight Check
- [ ] Confirm `getProviderKeyStorage()` returns an object with `getKey`, `listKeys`, `hasKey` methods. Note: `IProviderKeyStorage` is an **instance contract** (the shape of the returned object with getKey, listKeys, hasKey); `getProviderKeyStorage()` itself is a **core factory function** that returns such an object — the factory stays in core, the interface lives in auth. Auth's `AuthPrecedenceResolver` accepts an `IProviderKeyStorage` instance; core's DI factory calls `getProviderKeyStorage()` and injects the result.

## IDebugLogger Contract Preflight Check
- [ ] Grep all DebugLogger/debugLogger usages in auth-relevant files to verify the IDebugLogger instance contract covers all actual call patterns:
  ```bash
  rg -n "debugLogger|DebugLogger" packages/core/src/auth/ --glob '*.ts' --glob '!**/*.test.ts' --glob '!**/*.spec.ts'
  rg -n "debugLogger|DebugLogger" packages/cli/src/auth/ --glob '*.ts' --glob '!**/*.test.ts' --glob '!**/*.spec.ts'
  ```
- [ ] Verify that `IDebugLogger` instance interface (`debug`, `error`, `warn`) covers all actual method calls found in the grep.
- [ ] Verify that the `debugLogger` module-level singleton (`../utils/debugLogger.js`) and `DebugLogger` class constructor (`../debug/index.js`) are separate concerns: `IDebugLogger` defines the instance contract; core's factory constructs the instance and injects it. Neither the singleton nor the class constructor should move to auth.
- [ ] Define IDebugLogger from actual usage: confirm method signatures match all auth-relevant call sites. If auth uses `debugLogger.debug(namespace, message)` with a namespace prefix, the IDebugLogger interface must accept that pattern. If auth uses `logger.error(message)` without namespace, the IDebugLogger interface must accept that pattern. The IDebugLogger interface method shape is derived from this preflight evidence, not from assumptions.

## KeyringTokenStore Node Builtins Preflight Check
- [ ] Confirm `KeyringTokenStore` in `packages/core/src/auth/keyring-token-store.ts` uses `node:fs/promises`, `node:path`, and `node:os` for file-lock/fallback coordination logic (homedir resolution, concurrent keyring access).
- [ ] Confirm `@napi-rs/keyring` and core's `SecureStore`/`KeyringAdapter` are NOT imported by `KeyringTokenStore` — they stay in core and are injected via `ISecureStore`. This is accepted as interim design: Node builtins for file-lock coordination remain in auth; native keyring and SecureStore/KeyringAdapter do not move into auth.

## Blocking Issues Found
[List any issues that MUST be resolved before proceeding]

## Preflight Convention Checks
- [ ] Confirm package-local format script convention: existing packages use `prettier --write .` (root uses `prettier --experimental-cli --write .`). Verify at preflight by checking `packages/core/package.json` format script. Auth package follows package convention.
- [ ] Confirm providers depends on core: `node -e "const p=require('./packages/providers/package.json'); console.log(!!p.dependencies['@vybestack/llxprt-code-core'])"` must print `true`.
- [ ] Confirm AuthPrecedenceResolver constructor signature matches plan: `(config: AuthPrecedenceConfig, oauthManager?: OAuthManager, settingsService?: SettingsService)`. Note: after DI refactoring, `SettingsService` becomes `ISettingsService`; the contract is that this is a direct construction call at the providers layer (BaseProvider), not a factory call. Also confirm that `AuthPrecedenceResolver` is defined in `auth-precedence-resolver.ts` (canonical source file), NOT in `precedence.ts`.
- [ ] Confirm BaseProvider constructs AuthPrecedenceResolver directly (not via factory). After DI refactoring, BaseProvider passes SettingsService directly — structural typing satisfies ISettingsService without an adapter or factory. This direct-construction flow (not a factory call) is the design intent for the providers layer.
- [ ] Confirm SettingsService public API includes: `get`, `getProviderSettings`, `on`, `off` (structural subset for ISettingsInterface).

## BaseTokenStore Preflight Check
- [ ] Confirm `BaseTokenStore` is NOT in `packages/core/src/auth/` (it is in `packages/core/src/mcp/token-store.ts` — MCP subsystem, not auth).
- [ ] Confirm `BaseTokenStore` consumers are all MCP files (`file-token-store.ts`, MCP tests), not auth files.
- [ ] Document finding: "BaseTokenStore is MCP subsystem, not auth domain. No move required."
- [ ] Confirm `TokenStore` interface (auth domain) and `KeyringTokenStore`/`ProxyTokenStore` (auth implementations) are the auth token store hierarchy that moves to `packages/auth`.

## ISecureStore Contract Preflight Check
- [ ] Confirm core's `SecureStore` exposes: `get`, `set`, `delete`, `list`, `has` (5 methods).
- [ ] Confirm `keyring-token-store.ts` uses `secureStore.list()` (L414, L437 for listProviders/listBuckets).
- [ ] Confirm `SecureStoreError` has `code: SecureStoreErrorCode`, `message: string`, `remediation: string`.
- [ ] Confirm `SecureStoreErrorCode` is a union of `'UNAVAILABLE' | 'LOCKED' | 'DENIED' | 'CORRUPT' | 'TIMEOUT' | 'NOT_FOUND'`.
- [ ] Confirm `keyring-token-store.ts` catches `SecureStoreError` by instanceof and checks `error.code` (L349).

## Provider Preflight File List
- [ ] Run `rg -l "from ['\"]@vybestack/llxprt-code-core/auth" packages/providers/src --glob '*.ts'` and paste the exact regenerated file list below. Verify the count matches the plan-time expected count (6 production + 3 test = 9 files). If the count differs, update all plan artifacts that reference the provider auth import count.
- [ ] Provider auth import file list (paste regenerated output below — this is the authoritative file list for the plan):
- [ ] Paste the exact output of `rg -l "from ['"]@vybestack/llxprt-code-core/auth" packages/providers/src --glob '*.ts'` here: ______
- [ ] Confirm `OAuthProvider` interface stays in CLI (`packages/cli/src/auth/types.ts`). `OAuthProvider` is used only by CLI adapter classes; `AuthPrecedenceResolver` uses `OAuthManager` interface instead. Confirm consistent ownership decision across all artifacts.

## Verification Gate
- [ ] All dependencies verified
- [ ] All types match expectations
- [ ] All call paths are possible
- [ ] Test infrastructure ready
- [ ] packages/storage confirmed absent (DI interfaces are interim)
- [ ] Providers auth imports audited
- [ ] BaseTokenStore confirmed as MCP subsystem (no move required)
- [ ] ISecureStore full contract verified (5 methods + error types)

IF ANY CHECKBOX IS UNCHECKED: STOP and update plan before proceeding.