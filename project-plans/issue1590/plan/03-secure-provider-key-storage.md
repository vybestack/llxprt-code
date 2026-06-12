# Phase 03: Move Secure Store and Provider Key Storage Behavior/Tests

## Phase ID

`PLAN-20260609-ISSUE1590.P03`

**Phase Structure**: This phase is split into three sequential subphases with per-subphase verifier gates:
- **P03a**: Create stubs for secure store and provider key storage implementations
- **P03b**: Create/modify tests, capture RED output
- **P03c**: Copy implementations and make tests pass (GREEN)

Each subphase must complete and pass its per-subphase verifier before the next begins. Per `dev-docs/COORDINATING.md`: worker → verifier → next worker.

## Prerequisites

- Required: Phase P02 completed and P02c-V PASS.
- Verification: `test -f project-plans/issue1590/.completed/P02c-V.md`.
- Expected files from previous phase: storage package with logger, path storage, and file services.

## Requirements Implemented (Expanded)

### REQ-SECURE-001: Move Secure Store

**Full Text**: Move `SecureStore`, `SecureStoreError`, `KeyringAdapter`, `createDefaultKeyringAdapter`, and related secure storage types into `packages/storage` while preserving keyring/fallback behavior and removing core debug dependencies.
**Behavior**:

- GIVEN: secure storage has keyring and encrypted fallback behavior
- WHEN: callers import `SecureStore` from storage
- THEN: key validation, keyring operations, encrypted fallback read/write/list/delete/has, and error classification match existing behavior

**Why This Matters**: API keys and OAuth tokens must remain secure and readable after extraction.

### REQ-PROVIDERKEY-001: Move Provider Key Storage

**Full Text**: Move `ProviderKeyStorage`, `validateKeyName`, `getProviderKeyStorage`, and `resetProviderKeyStorage` into `packages/storage` while preserving singleton and CRUD behavior.
**Behavior**:

- GIVEN: a caller saves a named provider API key
- WHEN: it uses `ProviderKeyStorage` from storage
- THEN: names are validated, values are trimmed, and CRUD delegates to the moved secure store

**Why This Matters**: Runtime auth-key-name resolution and credential proxy flows rely on this behavior.

---

## Subphase P03a: Create Implementation Stubs

### Purpose

Create minimal stub files so tests can import modules without resolution errors.

### Files to Create

- `packages/storage/src/secure-store/secure-store.ts`
  - Stub: export all public symbols with correct signatures. Runtime methods throw "not implemented" but the module's public API surface is complete:
    - `export class SecureStore { constructor() { throw new Error('not implemented'); } }` — class exists with constructor signature.
    - `export class SecureStoreError extends Error { constructor() { throw new Error('not implemented'); } }` — error subclass exists.
    - `export type SecureStoreErrorCode = ...` — type alias exported (copy the actual type from core).
    - `export interface KeyringAdapter { ... }` — interface exported (copy the actual interface from core).
    - `export interface SecureStoreOptions { ... }` — interface exported (copy the actual interface from core).
    - `export function createDefaultKeyringAdapter(): ... { throw new Error('not implemented'); }` — function exists with correct return type.
  - **Why export types in stubs**: Tests that import `SecureStoreErrorCode`, `KeyringAdapter`, or `SecureStoreOptions` for type annotations must not fail at import time. Stubs must typecheck with the full public API surface so RED failures are behavioral (assertion failures, "not implemented" throws) not structural (missing exports, type errors).
- `packages/storage/src/secure-store/provider-key-storage.ts`
  - Stub: export `ProviderKeyStorage` (class throwing "not implemented"), `getProviderKeyStorage` (function throwing "not implemented"), `resetProviderKeyStorage` (empty function), `KEY_NAME_REGEX` (set to `/^$/` — valid regex but wrong value), `validateKeyName` (function throwing "not implemented").

### Verification (P03a)

```bash
test -f packages/storage/src/secure-store/secure-store.ts
test -f packages/storage/src/secure-store/provider-key-storage.ts
npm run typecheck --workspace @vybestack/llxprt-code-storage
# Verify complete public API surface
grep -q 'export.*SecureStoreErrorCode\|export type.*SecureStoreErrorCode' packages/storage/src/secure-store/secure-store.ts || { echo "STUB INCOMPLETE: missing SecureStoreErrorCode"; exit 1; }
grep -q 'export.*KeyringAdapter\|export interface.*KeyringAdapter' packages/storage/src/secure-store/secure-store.ts || { echo "STUB INCOMPLETE: missing KeyringAdapter"; exit 1; }
grep -q 'export.*SecureStoreOptions\|export interface.*SecureStoreOptions' packages/storage/src/secure-store/secure-store.ts || { echo "STUB INCOMPLETE: missing SecureStoreOptions"; exit 1; }
```

### P03a Completion Marker

Create `project-plans/issue1590/.completed/P03a.md` listing stub files created.

### P03a-V Verifier

The verifier MUST confirm:
1. All stub files exist.
2. Stubs typecheck.
3. Stubs export the complete public API surface: `SecureStore`, `SecureStoreError`, `SecureStoreErrorCode` (type), `KeyringAdapter` (type), `SecureStoreOptions` (type), `createDefaultKeyringAdapter`, `ProviderKeyStorage`, `KEY_NAME_REGEX`, `validateKeyName`, `getProviderKeyStorage`, `resetProviderKeyStorage`.
4. Runtime methods throw or return wrong-but-typed values (not missing exports).

Write result to `.completed/P03a-V.md`.

---

## Subphase P03b: Create/Modify Tests and Capture RED

### Purpose

Copy behavioral tests from core into storage with import rewrites, then run against stubs to capture RED output.

### Import Rewrite Rules for Moved Tests

- `packages/core/src/storage/secure-store.test.ts` → `packages/storage/src/secure-store/secure-store.test.ts`:
  - `from '../storage/secure-store.js'` or `from './secure-store.js'` → `from './secure-store.js'`.
  - `from '../../utils/debugLogger.js'` or `from '../utils/debugLogger.js'` → remove; use `NullStorageLogger` or `ConsoleStorageLogger` from `'../types/logger.js'` if a logger is needed.
  - Any import from `'@vybestack/llxprt-code-core'` → `from '@vybestack/llxprt-code-storage'` if it references moved symbols.

- `packages/core/src/storage/secure-store.spec.ts` → `packages/storage/src/secure-store/secure-store.spec.ts`:
  - Same rewrites as `secure-store.test.ts` above.

- `packages/core/src/storage/provider-key-storage.test.ts` → `packages/storage/src/secure-store/provider-key-storage.test.ts`:
  - `from '../storage/provider-key-storage.js'` or `from './provider-key-storage.js'` → `from './provider-key-storage.js'`.
  - `from '../storage/secure-store.js'` or `from './secure-store.js'` → `from './secure-store.js'`.
  - Any import from `'@vybestack/llxprt-code-core'` → `from '@vybestack/llxprt-code-storage'` if it references moved symbols.

### `secure-store-integration.test.ts` Split Instructions

**DO NOT move `secure-store-integration.test.ts` wholesale into storage.** The file imports core-owned `../tools/tool-key-storage.js` (`maskKeyForDisplay`), which must not move to storage.

**Exact action — split and edit:**

1. Copy `packages/core/src/storage/secure-store-integration.test.ts` → `packages/storage/src/secure-store/secure-store-integration.test.ts`.
2. Apply the following edits to the storage copy:
   - Replace `import { maskKeyForDisplay } from '../tools/tool-key-storage.js';` with an inline helper function:
     ```typescript
     function maskKeyForDisplay(key: string): string {
       if (key.length <= 8) return '***';
       return key.slice(0, 4) + '***' + key.slice(-4);
     }
     ```
   - Replace any other imports from core paths with storage-local equivalents or remove them.
   - Replace `from '../storage/secure-store.js'` or `from './secure-store.js'` → `from './secure-store.js'`.
3. Verify the storage copy has zero imports from `@vybestack/llxprt-code-core` or any `packages/core` relative path.

### Files to Create

- `packages/storage/src/secure-store/secure-store.test.ts` (copied from core with rewrites)
- `packages/storage/src/secure-store/secure-store.spec.ts` (copied from core with rewrites)
- `packages/storage/src/secure-store/secure-store-integration.test.ts` (SPLIT from core — see above)
- `packages/storage/src/secure-store/provider-key-storage.test.ts` (copied from core with rewrites)

### RED Gate

```bash
npm run test --workspace @vybestack/llxprt-code-storage -- src/secure-store/secure-store.test.ts src/secure-store/secure-store.spec.ts src/secure-store/secure-store-integration.test.ts src/secure-store/provider-key-storage.test.ts
```

**Expected**: Tests fail because stub implementations throw "not implemented" or export wrong-but-typed values. Capture output in `.completed/P03b.md` under `## RED Output` heading. The output must show:
1. Tests ran (not just import/module resolution errors).
2. Multiple specific test scenarios failed with behavioral assertion failures — e.g., `KEY_NAME_REGEX` stub returns `/^$/` so valid key names fail validation; `new SecureStore()` throws "not implemented"; `new ProviderKeyStorage()` throws "not implemented".
3. **Unrelated tests passing is acceptable** — tests that exercise only features not in P03 scope (e.g., path/file service tests from P02c, logger tests from P01) may pass. The gate requires that every targeted behavioral test against P03a stubs fails. Specifically: every test that asserts against `SecureStore`, `SecureStoreError`, `createDefaultKeyringAdapter`, `ProviderKeyStorage`, `KEY_NAME_REGEX`, `validateKeyName`, `getProviderKeyStorage`, or `resetProviderKeyStorage` must fail with a behavioral assertion mismatch or "not implemented" throw.
4. The failure set must include at least: secure store construction tests ("not implemented" throws), provider key storage tests ("not implemented" throws), and key validation tests (wrong regex). Each test file that tests P03a-stubbed behavior must have at least one targeted behavioral failure.

**Verifier gate**: The verifier MUST explicitly inspect the captured RED output and confirm (a), (b), (c), and (d) above. If RED output is missing, shows no failures, or shows only import errors (not behavioral failures), the verifier MUST return FAIL. If RED output shows missing-export or type errors (because stubs were incomplete), the verifier MUST return FAIL and request stub fix.

### P03b Completion Marker

Create `project-plans/issue1590/.completed/P03b.md` with RED output captured.

### P03b-V Verifier

The verifier MUST confirm:
1. RED output exists in `.completed/P03b.md`.
2. RED output shows tests that **ran** (not import/module resolution errors). If output shows `Cannot find module` or `has no exported member`, the stub was incomplete — return FAIL and request stub fix.
3. Multiple specific test scenarios failed with behavioral assertions (wrong values, "not implemented" throws), not structural errors.
4. Every test that asserts against P03a-stubbed symbols (`SecureStore`, `ProviderKeyStorage`, `KEY_NAME_REGEX`, etc.) shows a behavioral failure. Unrelated tests (e.g., path/file service tests from P02c, logger tests from P01) may pass.
5. Each test file targeting P03a-stubbed behavior shows at least one targeted behavioral failure.

Write result to `.completed/P03b-V.md`.

---

## Subphase P03c: Copy Implementations and Make Tests Pass (GREEN)

### Purpose

Replace stubs with real implementations copied from core, applying import rewrites. Update barrel exports. Make all P03b tests pass.

### Implementation Import Rewrites

- `packages/core/src/storage/secure-store.ts` → `packages/storage/src/secure-store/secure-store.ts`:
  - Remove `import { debugLogger } from '../utils/debugLogger.js'` (or similar debug import path).
  - Add `import type { StorageLogger } from '../types/logger.js';` and `import { NullStorageLogger } from '../types/logger.js';`.
  - **Instance logger**: `this.logger` is `options.logger ?? new NullStorageLogger()`. All existing instance `this.logger.debug(...)` calls remain unchanged.
  - **Module-level `createDefaultKeyringAdapter` function**: Replace module-level debug logging with storage-local logger pattern. Exact algorithm:
    1. Define module-level: `let _moduleLogger: StorageLogger = new NullStorageLogger();`
    2. Define private helper (not exported): `function setSecureStoreModuleLogger(logger: StorageLogger): void { _moduleLogger = logger; }`
    3. In `SecureStore` constructor, after setting `this.logger`, call `setSecureStoreModuleLogger(this.logger)`.
    4. In `createDefaultKeyringAdapter`, replace `debugLogger.warn(...)` with `_moduleLogger.warn(...)`. The `process.env.DEBUG` guard remains identical.
    5. If `createDefaultKeyringAdapter` is called before any `SecureStore` is constructed, `_moduleLogger` will be `NullStorageLogger` and the warning is silently suppressed. This is acceptable because the warning is purely diagnostic and the null return already indicates the failure.

- `packages/core/src/storage/provider-key-storage.ts` → `packages/storage/src/secure-store/provider-key-storage.ts`:
  - `from '../storage/secure-store.js'` or `from './secure-store.js'` → `from './secure-store.js'` (same directory in storage).

### Expanded Pseudocode Algorithms

#### SecureStore Logger/Keyring Fallback (pseudocode lines 12-16)

```
Algorithm: SecureStore constructor logger initialization
1. Accept options: SecureStoreOptions
2. IF options.logger is provided THEN
3.   SET this.logger = options.logger
4. ELSE
5.   SET this.logger = new NullStorageLogger()
6. END IF
7. CALL setSecureStoreModuleLogger(this.logger)  // propagate to module level
8. CONTINUE with existing constructor logic (keyring adapter init, fallback dir setup)
```

```
Algorithm: createDefaultKeyringAdapter module-level logging
1. TRY dynamic import of @napi-rs/keyring
2. IF module not available THEN
3.   IF process.env.DEBUG is set THEN
4.     CALL _moduleLogger.warn("Keyring module not available...")
5.   END IF
6.   RETURN null
7. END IF
8. RETURN keyring adapter (existing logic)
```

### Files to Modify

- Replace stub files from P03a with real implementations:
  - `packages/storage/src/secure-store/secure-store.ts` — full implementation with logger injection. Implements pseudocode lines 12-16.
  - `packages/storage/src/secure-store/provider-key-storage.ts` — full implementation. Implements pseudocode lines 17-18.
- `packages/storage/src/index.ts`
  - Export secure store and provider key APIs.

### GREEN Verification

```bash
npm run test --workspace @vybestack/llxprt-code-storage -- packages/storage/src/secure-store/secure-store.test.ts packages/storage/src/secure-store/secure-store.spec.ts packages/storage/src/secure-store/secure-store-integration.test.ts packages/storage/src/secure-store/provider-key-storage.test.ts
npm run typecheck --workspace @vybestack/llxprt-code-storage
rg "DebugLogger|debugLogger|@vybestack/llxprt-code-core|\.\./debug|\.\./utils/debugLogger" packages/storage/src/secure-store -g '*.ts' && exit 1 || true
# Verify module-level logger pattern
grep -n '_moduleLogger\|setSecureStoreModuleLogger' packages/storage/src/secure-store/secure-store.ts
rg "@napi-rs/keyring" packages/storage/package.json packages/storage/src/secure-store/secure-store.ts
```

### P03c Completion Marker

Create `project-plans/issue1590/.completed/P03c.md` with GREEN output and files changed.

### P03c-V Verifier

The verifier MUST confirm:
1. GREEN output exists in `.completed/P03c.md`.
2. All P03b tests now pass.
3. `npm run typecheck --workspace @vybestack/llxprt-code-storage` passes.
4. No core debug dependency in storage secure store source.
5. Module-level logger pattern is implemented (`_moduleLogger`, `setSecureStoreModuleLogger`).
6. `secure-store-integration.test.ts` split correctly: storage copy has inline `maskKeyForDisplay` and zero core imports.
7. Implementation matches pseudocode lines 12-18.

Write result to `.completed/P03c-V.md`.

---

## Overall Phase Verification Commands (P03 Verifier Sequence)

The P03 subphase verifiers (P03a-V, P03b-V, P03c-V) replace the previous single P03-V verifier. Each subphase verifier checks its own completion marker and runs its own verification commands. The overall phase is complete when all three subphase verifier markers exist:

```bash
# Verify all subphase and verifier markers exist
test -f project-plans/issue1590/.completed/P03a.md
test -f project-plans/issue1590/.completed/P03a-V.md
test -f project-plans/issue1590/.completed/P03b.md
test -f project-plans/issue1590/.completed/P03b-V.md
test -f project-plans/issue1590/.completed/P03c.md
test -f project-plans/issue1590/.completed/P03c-V.md
```

## Semantic Verification Checklist

- [ ] P03a stubs exist and typecheck with complete public API surface. P03a-V confirmed.
- [ ] P03b RED output shows behavioral test failures against stubs (not import/type errors). P03b-V explicitly inspected and confirmed.
- [ ] P03c GREEN output shows all tests passing against real implementations. P03c-V confirmed.
- [ ] SecureStore tests use the real moved SecureStore with infrastructure keyring adapters/fallback dirs.
- [ ] ProviderKeyStorage tests use the real moved ProviderKeyStorage/SecureStore behavior.
- [ ] No test expects NotYetImplemented or placeholder behavior.
- [ ] Logger abstraction does not expose secrets and does not import core.
- [ ] Default keyring loader warning behavior is preserved through module-local `_moduleLogger` without core dependency.
- [ ] Existing constructor call sites remain type-compatible.
- [ ] `secure-store-integration.test.ts` split correctly: storage copy has inline `maskKeyForDisplay` helper and zero core imports.
- [ ] Verifiers compared implementation to pseudocode lines 12-18 and 23.

## Success Criteria

- All subphase completion markers exist.
- RED output captured and verified.
- Secure/provider key storage tests pass in storage package.
- Storage secure store source has no core debug dependency.
- Public API exports are complete.
- P03c-V verifier returns PASS before P04.

## Failure Recovery

Fix moved code/tests before continuing to session/conversation extraction.

## Phase Completion Marker

The phase is complete when all three subphase markers and all three subphase verifier markers exist (P03a.md, P03a-V.md, P03b.md, P03b-V.md, P03c.md, P03c-V.md).
