# Phase 01a: Preflight Verification Results

## Phase ID

`PLAN-20260213-KEYRINGTOKENSTORE.P01a`

## Purpose

Record actual verification results from Phase 01 preflight checks.

**Executed**: 2026-02-14 ~10:40 UTC

---

## Dependencies Verified

| Dependency | Command | Output | Status |
|---|---|---|---|
| SecureStore class | `grep -r "export class SecureStore" packages/core/src/storage/secure-store.ts` | `export class SecureStore {` | **OK** |
| SecureStoreError class | `grep -r "export class SecureStoreError" packages/core/src/storage/secure-store.ts` | `export class SecureStoreError extends Error {` | **OK** |
| OAuthTokenSchema | `grep -r "export const OAuthTokenSchema" packages/core/src/auth/types.ts` | `export const OAuthTokenSchema = z.object({` | **OK** |
| TokenStore interface | `grep -r "export interface TokenStore" packages/core/src/auth/token-store.ts` | `export interface TokenStore {` | **OK** |
| DebugLogger class | `grep -r "export class DebugLogger" packages/core/src/debug/DebugLogger.ts` | `export class DebugLogger {` | **OK** |
| fast-check | `npm ls fast-check` | `fast-check@4.5.3` (root + core) | **OK** |
| vitest | `npm ls vitest` | `vitest@3.2.4` (root + core + cli) | **OK** |
| zod | `npm ls zod` | `zod@3.25.76` (core + cli) | **OK** |
| @napi-rs/keyring | `npm ls @napi-rs/keyring` | `@napi-rs/keyring@1.2.0` (in core) | **OK** |

## Types Verified

| Type Name | Expected Definition | Actual Definition | Match? |
|---|---|---|---|
| TokenStore interface | 8 methods: saveToken, getToken, removeToken, listProviders, listBuckets, getBucketStats, acquireRefreshLock, releaseRefreshLock | All 8 methods confirmed with correct signatures | **YES** |
| OAuthTokenSchema fields | access_token, refresh_token?, expiry, scope?, token_type, resource_url? | `access_token: z.string()`, `refresh_token: z.string().optional()`, `expiry: z.number()`, `scope: z.string().nullable().optional()`, `token_type: z.enum(['Bearer', 'bearer'])`, `resource_url: z.string().optional()` | **YES** |
| BucketStats fields | bucket, requestCount, percentage, lastUsed? | `bucket: z.string()`, `requestCount: z.number()`, `percentage: z.number()`, `lastUsed: z.number().optional()` | **YES** |
| SecureStore methods | set, get, delete, list, has | `async set(key, value)`, `async get(key)`, `async delete(key)`, `async list()`, `async has(key)` | **YES** |
| SecureStoreErrorCode | UNAVAILABLE, LOCKED, DENIED, CORRUPT, TIMEOUT, NOT_FOUND | All 6 codes confirmed: `'UNAVAILABLE' \| 'LOCKED' \| 'DENIED' \| 'CORRUPT' \| 'TIMEOUT' \| 'NOT_FOUND'` | **YES** |
| ProviderKeyStorage constructor | Optional SecureStore injection | `constructor(options?: { secureStore?: SecureStore })` — creates default `new SecureStore(SERVICE_NAME, { fallbackDir, fallbackPolicy: 'allow' })` when not injected | **YES** |
| SecureStoreOptions | fallbackDir, fallbackPolicy, keyringLoader | `fallbackDir?: string`, `fallbackPolicy?: 'allow' \| 'deny'`, `keyringLoader?: () => Promise<KeyringAdapter \| null>` | **YES** |
| KeyringAdapter interface | Exported from secure-store.ts | `export interface KeyringAdapter` at line 51 | **YES** |

### OAuthTokenSchema Passthrough — Important Detail

The plan references "OAuthTokenSchema passthrough capability." Investigation reveals:

- The schema itself is a plain `z.object({...})` — **NO `.passthrough()` chained on the schema definition**.
- However, `MultiProviderTokenStore` already uses `OAuthTokenSchema.passthrough().parse(token)` at lines 127 and 178 — calling `.passthrough()` inline at parse time.
- Zod default is `.strip()` (removes unknown keys). The existing code works around this by calling `.passthrough()` at each parse site.
- **KeyringTokenStore should follow the same pattern**: call `OAuthTokenSchema.passthrough().parse(...)` at parse time, not assume the schema definition includes passthrough.

**Status**: **OK** — the pattern is usable, just need to follow the inline `.passthrough()` convention.

## Call Paths Verified

| Function/Class | Expected Location | Actual Location | Evidence |
|---|---|---|---|
| `new MultiProviderTokenStore()` in runtimeContextFactory | `packages/cli/src/runtime/runtimeContextFactory.ts` ~L58,263 | L263 (instantiation), L58 (variable declaration only) | `263: sharedTokenStore ?? (sharedTokenStore = new MultiProviderTokenStore());` |
| `new MultiProviderTokenStore()` in authCommand | `packages/cli/src/ui/commands/authCommand.ts` ~L40,662 | L40, L662 | Both confirmed: `const tokenStore = new MultiProviderTokenStore();` |
| `new MultiProviderTokenStore()` in profileCommand | `packages/cli/src/ui/commands/profileCommand.ts` ~L100,347 | L100, L347 | Both confirmed: `const tokenStore = new MultiProviderTokenStore();` |
| `new MultiProviderTokenStore()` in providerManagerInstance | `packages/cli/src/providers/providerManagerInstance.ts` ~L242 | L242 | `const tokenStore = new MultiProviderTokenStore();` |
| Re-export in core/index.ts | `packages/core/index.ts` | L16: `export { MultiProviderTokenStore } from './src/auth/token-store.js';` | **OK** |
| Re-export in cli/auth/types.ts | `packages/cli/src/auth/types.ts` | L14: `export { MultiProviderTokenStore } from '@vybestack/llxprt-code-core';` | **OK** |

### Additional Instantiation Sites (Not in Plan)

The following instantiation sites were found in **test files** within `packages/cli/src/`:

| File | Line | Context |
|---|---|---|
| `packages/cli/src/auth/oauth-manager-initialization.spec.ts` | 36 | `tokenStore = new MultiProviderTokenStore();` |
| `packages/cli/src/auth/__tests__/codex-oauth-provider.test.ts` | 39 | `tokenStore = new MultiProviderTokenStore();` |
| `packages/cli/src/auth/oauth-manager.refresh-race.spec.ts` | 38 | `tokenStore = new MultiProviderTokenStore(tempDir);` |
| `packages/cli/src/integration-tests/oauth-timing.integration.test.ts` | 72 | `tokenStore = new MultiProviderTokenStore();` |
| `packages/cli/src/integration-tests/__tests__/oauth-buckets.integration.spec.ts` | 98 | `tokenStore = new MultiProviderTokenStore(oauthDir);` |

**NOTE**: These test files also need to be updated when wiring KeyringTokenStore as default. They may need constructor changes since `MultiProviderTokenStore(basePath)` takes a string path, while `KeyringTokenStore` will take `{ secureStore?: SecureStore }`.

### Constructor Signatures

| Class | Existing Constructor | Notes |
|---|---|---|
| `MultiProviderTokenStore` | `constructor(basePath?: string)` | Takes optional filesystem path |
| `SecureStore` | `constructor(serviceName: string, options?: SecureStoreOptions)` | Service name required, options optional |
| `ProviderKeyStorage` | `constructor(options?: { secureStore?: SecureStore })` | Optional DI, creates default internally |
| `DebugLogger` | `constructor(namespace: string)` | Simple namespace string |

### Re-export Chain Issues

| Item | Status | Detail |
|---|---|---|
| `TokenStore` interface re-exported from `core/index.ts` | **NOT EXPORTED** | Only `MultiProviderTokenStore` class is exported, not the `TokenStore` interface |
| `SecureStore` re-exported from `core/index.ts` | **NOT EXPORTED** | SecureStore is only available within core package via relative imports |
| `KeyringAdapter` re-exported from `core/index.ts` | **NOT EXPORTED** | Only available within core via `./secure-store.js` |

**Impact**: Since `KeyringTokenStore` will live in `packages/core/src/auth/`, it can import `SecureStore` via relative path (`../storage/secure-store.js`). This is the same pattern used by `ProviderKeyStorage`. No re-export needed for the implementation. However, when wiring in CLI (Phase 07), CLI code will need `KeyringTokenStore` exported from `core/index.ts`. The `TokenStore` interface export from `core/index.ts` should also be added for type consumers.

**Status**: **OK (non-blocking)** — plan needs to include adding exports to `core/index.ts` in Phase 07.

## Test Infrastructure Verified

| Component | Test File Exists? | Test Count | Test Patterns Work? |
|---|---|---|---|
| token-store.spec.ts | **YES** | 206 grep hits for describe/it/test (37 actual tests) | **YES** — all 37 tests pass (1.14s) |
| token-store.refresh-race.spec.ts | **YES** | 81 grep hits for describe/it/test | **YES** (exists) |
| Core package test runner | N/A | N/A | **YES** — `npx vitest run` works, 37/37 pass |
| fast-check available in tests | N/A | N/A | **YES** — installed, used in 5+ test files in core (e.g., `EmojiFilter.property.test.ts`, `geminiChat-density.test.ts`). Not used in existing token-store tests. |
| `__tests__` directory in core/auth | **YES** | Contains `authRuntimeScope.test.ts`, `codex-device-flow.test.ts` | Available for new test files |

### Test Pattern Observations

The existing `ProviderKeyStorage` tests use a clean DI pattern for SecureStore testing:

```typescript
// From provider-key-storage.test.ts
import { SecureStore, type KeyringAdapter } from './secure-store.js';

// Creates in-memory mock keyring adapter (no vi.mock theater)
function createMockKeyring(): KeyringAdapter & { store: Map<string, string> } { ... }

// Creates test storage with real SecureStore but mock keyring
const secureStore = new SecureStore('llxprt-code-provider-keys', {
  keyringLoader: async () => mockKeyring,
  fallbackDir: tempDir,
  fallbackPolicy: 'allow',
});
const storage = new ProviderKeyStorage({ secureStore });
```

**This is the exact pattern KeyringTokenStore tests should follow** — real SecureStore with injected mock keyring, no `vi.mock()` theater.

## Blocking Issues Found

**None.** All dependencies, types, call paths, and test infrastructure match plan expectations.

### Non-Blocking Notes for Future Phases

1. **Re-exports needed in Phase 07**: `KeyringTokenStore` must be added to `packages/core/index.ts` exports and `packages/cli/src/auth/types.ts` re-exports when wiring as default.

2. **Constructor signature difference**: `MultiProviderTokenStore(basePath?: string)` vs planned `KeyringTokenStore({ secureStore?: SecureStore })`. The wiring phase (P07) will need to handle this — all 11 instantiation sites (6 production + 5 test) need updating.

3. **OAuthTokenSchema passthrough**: Use `OAuthTokenSchema.passthrough().parse(...)` inline (matching existing pattern), not `.passthrough()` on schema definition.

4. **Test file count**: Plan mentions test updates for runtimeContextFactory (~L58). The actual instantiation is at L263; L58 is just the variable declaration. Minor line number discrepancy, non-blocking.

## Verification Gate

- [x] All dependencies verified
- [x] All types match expectations
- [x] All call paths are possible
- [x] Test infrastructure ready
- [x] No unresolved blocking issues

## Holistic Functionality Assessment

### What was verified?

Every dependency, type, interface, constructor signature, call path, re-export chain, and test infrastructure item referenced by the plan was verified against the actual codebase using shell commands. Results are based on actual command outputs, not assumptions.

### Does the codebase match plan assumptions?

**Yes, with minor clarifications:**

1. **SecureStore/ProviderKeyStorage pattern** — Confirmed. The DI pattern (`{ secureStore?: SecureStore }`) used by ProviderKeyStorage is the exact model for KeyringTokenStore.
2. **TokenStore interface** — All 8 methods confirmed with expected signatures including optional bucket parameters.
3. **OAuthTokenSchema** — Fields match. Passthrough is called inline at parse time, not on schema definition.
4. **Call sites** — All 6 production instantiation sites confirmed at expected locations. 5 additional test sites found.
5. **Test infrastructure** — vitest works, fast-check available, existing tests pass, `__tests__` directory exists, clean DI test pattern established.

### What could go wrong?

1. **11 instantiation sites** (not 6) need updating — test files also instantiate `MultiProviderTokenStore` directly. Missing these would break tests.
2. **Constructor mismatch** — New `KeyringTokenStore` will have different constructor than `MultiProviderTokenStore`. Need careful migration.
3. **Zod passthrough** — If forgotten, token fields could be silently stripped during round-trip serialization.

### Verdict

**PASS** — All plan assumptions verified. No blocking issues. Minor clarifications documented for downstream phases.
