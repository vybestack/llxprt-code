# Phase 05: Core Compatibility Shims and Public API

## Phase ID

`PLAN-20260609-ISSUE1590.P05`

## Prerequisites

- Required: Phase P04 completed and P04d-V PASS.
- Verification: `test -f project-plans/issue1590/.completed/P04d-V.md`.
- Expected files from previous phase: all moved storage APIs in `packages/storage`.

## Requirements Implemented (Expanded)

### REQ-COMPAT-001: Preserve Core Imports

**Full Text**: Preserve existing core root exports and core deep exports for moved APIs through shim files and core package export-map entries.
**Behavior**:

- GIVEN: existing code imports storage APIs from `@vybestack/llxprt-code-core` or core deep export paths
- WHEN: the extraction is complete
- THEN: those imports continue to resolve and refer to the moved storage implementations

**Why This Matters**: Package extraction should not break downstream consumers while migration proceeds.

### REQ-TEST-001: Compatibility Test Coverage

**Full Text**: Moved storage tests pass in `packages/storage`; compatibility and consuming package tests pass.
**Behavior**:

- GIVEN: core compatibility shims exist
- WHEN: core tests import moved APIs through old paths
- THEN: behavior remains available and tests pass

**Why This Matters**: This proves extraction is integrated rather than isolated.

## Implementation Tasks

### Files to Modify

**CRITICAL: `gitIgnoreParser.ts` and `gitUtils.ts` are COPIED into storage in P02c, NOT MOVED. The core originals at `packages/core/src/utils/gitIgnoreParser.ts` and `packages/core/src/utils/gitUtils.ts` MUST remain in core unchanged.** P05 must NOT shim, delete, or modify these two files. They remain full implementations because non-storage core code (git service, prompts, grep, `gitLineChanges`) still uses them directly. Only the storage package gets its own internal copies.

Exact verification that core originals still exist and are NOT shims (run during P05 verification):
```bash
# Core originals must still exist as full implementations, NOT shims
test -f packages/core/src/utils/gitIgnoreParser.ts || { echo "FAIL: core gitIgnoreParser.ts deleted"; exit 1; }
test -f packages/core/src/utils/gitUtils.ts || { echo "FAIL: core gitUtils.ts deleted"; exit 1; }
# They must NOT be shim files (no re-export from storage)
rg "@vybestack/llxprt-code-storage" packages/core/src/utils/gitIgnoreParser.ts packages/core/src/utils/gitUtils.ts && { echo "FAIL: core git utils shimmed"; exit 1; } || echo "OK: core git utils remain full implementations"
```

- `packages/core/package.json`
  - **Add dependency** `@vybestack/llxprt-code-storage: file:../storage`. Line ~92 is `"dependencies": {`, with the first key being `"@vybestack/llxprt-code-mcp"`. Insert after the opening brace (before `"@vybestack/llxprt-code-mcp"`):
    ```json
    "@vybestack/llxprt-code-storage": "file:../storage",
    ```
    This makes core depend on storage — direction is core→storage (correct, no cycle). Verification: `node -e "const p=require('./packages/core/package.json'); console.assert(p.dependencies['@vybestack/llxprt-code-storage'] === 'file:../storage', 'missing storage dep'); console.log('OK: core has storage dep');"`
  - Remove `env-paths`, `ignore`, and optional `@napi-rs/keyring` **only if rg evidence confirms no remaining core source needs them**. Before removing each dependency, run:
    ```bash
    rg "from 'env-paths'|require\('env-paths'\)" packages/core/src -g '*.ts' -g '!**/dist/**'
    rg "from 'ignore'|require\('ignore'\)" packages/core/src -g '*.ts' -g '!**/dist/**'
    rg "@napi-rs/keyring" packages/core/src -g '*.ts' -g '!**/dist/**'
    ```
    Record output in `.completed/P05.md`. Only remove a dependency if the rg output is empty (no hits in core source, excluding dist). If any core-owned file still imports the package, keep the dependency and note it.
  - **Export map: existing deep exports** (already present — do NOT remove or modify):
    - `./config/storage.js` → `./dist/src/config/storage.js`
    - `./storage/secure-store.js` → `./dist/src/storage/secure-store.js`
    - `./storage/ConversationFileWriter.js` → `./dist/src/storage/ConversationFileWriter.js`
  - **Export map: newly-added compatibility exports** (must be ADDED in P05):
    - `./services/fileSystemService.js` → `./dist/src/services/fileSystemService.js`
    - `./services/fileDiscoveryService.js` → `./dist/src/services/fileDiscoveryService.js`
    - `./storage/provider-key-storage.js` → `./dist/src/storage/provider-key-storage.js`
    - `./storage/sessionTypes.js` → `./dist/src/storage/sessionTypes.js`

### Literal Exact Shim Contents

Each core file below must be replaced entirely with the specified content. No implementation code may remain.

#### `packages/core/src/config/storage.ts`

```typescript
export * from '@vybestack/llxprt-code-storage/config/storage.js';
```

#### `packages/core/src/services/fileSystemService.ts`

```typescript
export * from '@vybestack/llxprt-code-storage/services/fileSystemService.js';
```

#### `packages/core/src/services/fileDiscoveryService.ts`

```typescript
export * from '@vybestack/llxprt-code-storage/services/fileDiscoveryService.js';
```

#### `packages/core/src/storage/secure-store.ts`

```typescript
export { SecureStore, SecureStoreError, createDefaultKeyringAdapter } from '@vybestack/llxprt-code-storage/storage/secure-store.js';
export type { KeyringAdapter, SecureStoreOptions, SecureStoreErrorCode } from '@vybestack/llxprt-code-storage/storage/secure-store.js';
```

**Why `export type` for some symbols**: `SecureStoreErrorCode` is a type-only export. `KeyringAdapter` and `SecureStoreOptions` are interfaces (type-only). Using `export type` for these prevents runtime import of unused code and matches the existing core convention. `SecureStore`, `SecureStoreError`, and `createDefaultKeyringAdapter` are runtime values and must use `export` (not `export type`).

#### `packages/core/src/storage/provider-key-storage.ts`

```typescript
export { KEY_NAME_REGEX, ProviderKeyStorage, validateKeyName, getProviderKeyStorage, resetProviderKeyStorage } from '@vybestack/llxprt-code-storage/storage/provider-key-storage.js';
```

#### `packages/core/src/storage/sessionTypes.ts`

```typescript
export * from '@vybestack/llxprt-code-storage/storage/sessionTypes.js';
```

#### `packages/core/src/storage/ConversationFileWriter.ts`

```typescript
export { ConversationFileWriter, getConversationFileWriter } from '@vybestack/llxprt-code-storage/storage/ConversationFileWriter.js';
```

**Note**: `resetConversationFileWriterForTesting` is intentionally NOT re-exported. It is a Tier 3 test-only helper exported from `@vybestack/llxprt-code-storage/testing`. Core and downstream consumers must not access it through core shims.

### Root Index Export Changes

**CRITICAL: Run `npm install` immediately after editing `packages/core/package.json`** (adding the storage dependency, potentially removing env-paths/ignore/@napi-rs/keyring). Workspace links and `package-lock.json` must be updated before any build/typecheck/test command. Do NOT defer `npm install` to the verification section.

#### `packages/core/src/index.ts`

Add `SecureStoreErrorCode` to the existing `export type` block at line ~197:

**Before**:
```typescript
export type {
  KeyringAdapter,
  SecureStoreOptions,
} from './storage/secure-store.js';
```

**After**:
```typescript
export type {
  KeyringAdapter,
  SecureStoreOptions,
  SecureStoreErrorCode,
} from './storage/secure-store.js';
```

This is an additive type-only export. No existing consumer breaks because type exports are erased at runtime.

No other changes to `packages/core/src/index.ts` are needed — the existing `export * from './config/storage.js'`, `export * from './services/fileSystemService.js'`, etc. continue to work because the shim files at those paths re-export from storage.

### Core Root Export Identity Verification

After P05 installs shims, run this verification command to confirm every moved symbol is importable from both `@vybestack/llxprt-code-core` root and `@vybestack/llxprt-code-storage` root, and that they are strictly identical:

```bash
node --input-type=module -e "
import * as core from '@vybestack/llxprt-code-core';
import * as storage from '@vybestack/llxprt-code-storage';

// Every moved symbol must be importable from core root (backward compat)
const movedSymbols = [
  'LLXPRT_DIR', 'PROVIDER_ACCOUNTS_FILENAME', 'OAUTH_FILE',
  'Storage', 'SecureStore', 'SecureStoreError',
  'FileSystemService', 'StandardFileSystemService',
  'FileDiscoveryService',
  'ProviderKeyStorage', 'getProviderKeyStorage', 'resetProviderKeyStorage',
  'ConversationFileWriter', 'getConversationFileWriter',
  'SESSION_FILE_PREFIX',
];
for (const sym of movedSymbols) {
  if (core[sym] === undefined) { console.error('CORE ROOT MISSING:', sym); process.exit(1); }
  if (storage[sym] === undefined) { console.error('STORAGE ROOT MISSING:', sym); process.exit(1); }
  // Strict identity: core shim must re-export exact same reference
  if (core[sym] !== storage[sym]) { console.error('IDENTITY MISMATCH:', sym, 'core:', typeof core[sym], 'storage:', typeof storage[sym]); process.exit(1); }
}
// Type-only symbols: must be importable but cannot be identity-checked at runtime
// These are verified by typecheck passing
console.log('All', movedSymbols.length, 'moved symbols verified: core root === storage root (strict identity)');
"
```

This command must run after `npm run build` for both storage and core packages. It proves core shims are transparent re-exports, not wrappers.

### Exact Expected `packages/core/src/index.ts` Export Statements for Moved Symbols

After P05, these lines in `packages/core/src/index.ts` reference moved symbols through shim files. Each line resolves through the compatibility shims defined above:

| Line (approx) | Statement | Resolves through shim to |
|---|---|---|
| ~193-195 | `export { SecureStore, SecureStoreError, createDefaultKeyringAdapter } from './storage/secure-store.js';` | `@vybestack/llxprt-code-storage/storage/secure-store.js` |
| ~197-199 | `export type { KeyringAdapter, SecureStoreOptions, SecureStoreErrorCode } from './storage/secure-store.js';` | `@vybestack/llxprt-code-storage/storage/secure-store.js` |
| ~201-204 | `export { ProviderKeyStorage, getProviderKeyStorage, resetProviderKeyStorage } from './storage/provider-key-storage.js';` | `@vybestack/llxprt-code-storage/storage/provider-key-storage.js` |
| ~219 | `export * from './services/fileDiscoveryService.js';` | `@vybestack/llxprt-code-storage/services/fileDiscoveryService.js` |
| ~223 | `export * from './services/fileSystemService.js';` | `@vybestack/llxprt-code-storage/services/fileSystemService.js` |
| ~443 | `export { Storage } from './config/storage.js';` | `@vybestack/llxprt-code-storage/config/storage.js` |
| ~473-475 | `export { SESSION_FILE_PREFIX, type ConversationRecord, type BaseMessageRecord, type ToolCallRecord } from './storage/sessionTypes.js';` | `@vybestack/llxprt-code-storage/storage/sessionTypes.js` |

Note: `ConversationFileWriter` and `getConversationFileWriter` are NOT in the core root barrel (`packages/core/src/index.ts`) — neither before nor after extraction. They are only available via the deep export `@vybestack/llxprt-code-core/storage/ConversationFileWriter.js`. The core root export identity verification command below deliberately excludes them from the `movedSymbols` array. Non-core consumers must use `@vybestack/llxprt-code-storage/storage/ConversationFileWriter.js` (deep export) or `@vybestack/llxprt-code-storage` (root barrel) directly. P06 specifies the exact deep-import path for `LoggingProviderWrapper.ts`.

### `packages/core/src/storage/SessionPersistenceService.ts`

- **No import change needed**. Line 11 reads `import type { Storage } from '../config/storage.js';`. After P05, `../config/storage.js` is a shim that re-exports from storage. The relative path resolves through the shim. Verify it compiles and the type resolves correctly.

### Expanded Pseudocode Algorithms

#### Core Shim Export Identity

```
Algorithm: Core shim export identity verification
1. FOR each shim file in core:
2.   IMPORT symbol from core shim path
3.   IMPORT same symbol from storage package path
4.   ASSERT: core shim symbol === storage package symbol (strict identity)
5. END FOR
```

#### Parser-Boundary Checks

```
Algorithm: Shim boundary check
1. FOR each file in packages/core/src/ that is a known shim:
2.   PARSE the file with TypeScript compiler
3.   VERIFY: no class/function/const declarations (only re-exports)
4.   VERIFY: every export has '@vybestack/llxprt-code-storage' as module specifier
5. END FOR
6. FOR each file in packages/storage/src/:
7.   VERIFY: no import has '@vybestack/llxprt-code-core' or 'packages/core' as specifier
8. END FOR
```

### Representative Core Consumers That Must Compile After Shims

After P05 installs shims, these core files continue using relative imports that resolve through shims to the moved storage implementations:

- `packages/core/src/auth/keyring-token-store.ts` — imports `SecureStore`, `SecureStoreError`, `createDefaultKeyringAdapter` from `'../storage/secure-store.js'`.
  - Tests: `packages/core/src/auth/__tests__/keyring-token-store.test.ts`, `keyring-token-store.integration.test.ts`
- `packages/core/src/config/configConstructor.ts` — imports `Storage`, `FileSystemService`, `FileDiscoveryService` via relative path.
- `packages/core/src/config/configBaseCore.ts` — imports `Storage` via relative path.
- `packages/core/src/tools/tool-key-storage.ts` — imports `SecureStore` via relative path.
- `packages/core/src/hooks/trustedHooks.ts` — imports `Storage` via relative path.
- `packages/core/src/skills/skillManager.ts` — imports `FileDiscoveryService` via relative path.

Verify after shim installation:
```bash
npm run typecheck --workspace @vybestack/llxprt-code-core
npm run test --workspace @vybestack/llxprt-code-core -- packages/core/src/auth/__tests__/keyring-token-store.test.ts
npm run test --workspace @vybestack/llxprt-code-core -- token-store
npm run test --workspace @vybestack/llxprt-code-core -- tool-key-storage
npm run test --workspace @vybestack/llxprt-code-core
```

### Files to Create

- `packages/core/src/storage/storage-compat.test.ts`
  - Test root core import exposes `Storage`, `SecureStore`, `ProviderKeyStorage`, `FileDiscoveryService`, `StandardFileSystemService`, session constants.
  - Test deep shim imports resolve for all seven deep paths.
  - Test singleton identity: `getProviderKeyStorage` and `resetProviderKeyStorage` imported from core shim affect the same singleton as storage import.
  - Test conversation writer deep-path shim identity: `getConversationFileWriter` imported from core deep path `@vybestack/llxprt-code-core/storage/ConversationFileWriter.js` and from `@vybestack/llxprt-code-storage/storage/ConversationFileWriter.js` returns the same singleton (strict equality). Do NOT test `getConversationFileWriter` from core root — it is NOT exported from the core root barrel.
  - **DO NOT import `resetConversationFileWriterForTesting` from core** — it is not re-exported from core. If needed for test cleanup, import directly from `@vybestack/llxprt-code-storage/testing`.

### Core Test File Disposition

Exact move/delete/keep actions for every core test file related to moved storage behavior:

| Core Test File | Action | Rationale |
|---|---|---|
| `packages/core/src/config/storage.test.ts` | **DELETE** | Behavior now tested in `packages/storage/src/config/storage.test.ts` (moved in P02b). Coverage preserved in storage package. |
| `packages/core/src/services/fileSystemService.test.ts` | **DELETE** | Behavior now tested in `packages/storage/src/services/fileSystemService.test.ts` (moved in P02b). Coverage preserved in storage package. |
| `packages/core/src/services/fileDiscoveryService.test.ts` | **DELETE** | Behavior now tested in `packages/storage/src/services/fileDiscoveryService.test.ts` (moved in P02b). Coverage preserved in storage package. |
| `packages/core/src/utils/gitIgnoreParser.test.ts` | **KEEP** | Tests core-owned `gitIgnoreParser.ts` utility which remains in core for non-storage users (git service, prompts). Not a moved-behavior test. |
| `packages/core/src/storage/secure-store.test.ts` | **DELETE** | Behavior now tested in `packages/storage/src/secure-store/secure-store.test.ts` (moved in P03b). |
| `packages/core/src/storage/secure-store.spec.ts` | **DELETE** | Behavior now tested in `packages/storage/src/secure-store/secure-store.spec.ts` (moved in P03b). |
| `packages/core/src/storage/secure-store-integration.test.ts` | **DELETE** | Behavior now tested in `packages/storage/src/secure-store/secure-store-integration.test.ts` (split in P03b with inline `maskKeyForDisplay`). |
| `packages/core/src/storage/provider-key-storage.test.ts` | **DELETE** | Behavior now tested in `packages/storage/src/secure-store/provider-key-storage.test.ts` (moved in P03b). |
| `packages/core/src/storage/SessionPersistenceService.test.ts` | **KEEP** — must continue to pass | Tests `SessionPersistenceService` which remains in core. The test imports `Storage` from `'../config/storage.js'` — after P05, this resolves through the compatibility shim. Verify this test passes after shim installation. |
| New: `packages/core/src/storage/storage-compat.test.ts` | **CREATE** | New compatibility test proving root/deep/singleton shim identity. |

**Coverage verification**: After deletions and additions, run `npm run test --workspace @vybestack/llxprt-code-core` and confirm no test failures. The core test suite must still pass — deleted tests have replacements in the storage package, and kept tests cover core-owned behavior.

## Verification Commands

```bash
# CRITICAL: npm install MUST run immediately after package dependency edits (core package.json)
# to update workspace links and package-lock.json before any build/test/typecheck commands.
npm install
npm run test --workspace @vybestack/llxprt-code-core -- packages/core/src/storage/storage-compat.test.ts packages/core/src/storage/SessionPersistenceService.test.ts packages/core/src/auth/__tests__/keyring-token-store.test.ts packages/core/src/auth/__tests__/keyring-token-store.integration.test.ts
npm run typecheck --workspace @vybestack/llxprt-code-core
npm run build --workspace @vybestack/llxprt-code-storage
npm run build --workspace @vybestack/llxprt-code-core
rg "class SecureStore|class ProviderKeyStorage|class FileDiscoveryService|class Storage|class ConversationFileWriter" packages/core/src/storage packages/core/src/config/storage.ts packages/core/src/services/fileSystemService.ts packages/core/src/services/fileDiscoveryService.ts && exit 1 || true
node -e "const p=require('./packages/core/package.json'); const e=p.exports||{}; for (const k of ['./config/storage.js','./services/fileSystemService.js','./services/fileDiscoveryService.js','./storage/secure-store.js','./storage/provider-key-storage.js','./storage/sessionTypes.js','./storage/ConversationFileWriter.js']) if(!e[k]) { console.error('missing core export', k); process.exit(1); }"
# Verify core git utils still exist as full implementations (NOT shims)
test -f packages/core/src/utils/gitIgnoreParser.ts || { echo "FAIL: core gitIgnoreParser.ts deleted"; exit 1; }
test -f packages/core/src/utils/gitUtils.ts || { echo "FAIL: core gitUtils.ts deleted"; exit 1; }
rg "@vybestack/llxprt-code-storage" packages/core/src/utils/gitIgnoreParser.ts packages/core/src/utils/gitUtils.ts && { echo "FAIL: core git utils incorrectly shimmed to storage"; exit 1; } || echo "OK: core git utils remain full implementations"
# Verify core root export identity
node --input-type=module -e "
import * as core from '@vybestack/llxprt-code-core';
import * as storage from '@vybestack/llxprt-code-storage';
const movedSymbols = ['LLXPRT_DIR','PROVIDER_ACCOUNTS_FILENAME','OAUTH_FILE','Storage','SecureStore','SecureStoreError','FileSystemService','StandardFileSystemService','FileDiscoveryService','ProviderKeyStorage','getProviderKeyStorage','resetProviderKeyStorage','SESSION_FILE_PREFIX'];
for (const sym of movedSymbols) {
  if (core[sym] === undefined) { console.error('CORE ROOT MISSING:', sym); process.exit(1); }
  if (storage[sym] === undefined) { console.error('STORAGE ROOT MISSING:', sym); process.exit(1); }
  if (core[sym] !== storage[sym]) { console.error('IDENTITY MISMATCH:', sym); process.exit(1); }
}
console.log('All', movedSymbols.length, 'moved symbols verified: core root === storage root');
"
```

## Semantic Verification Checklist

- [ ] Core shim imports resolve to storage package implementations (strict identity).
- [ ] Core root exports still expose moved APIs — verified by root export identity command.
- [ ] Core deep export files still compile and are listed in export map.
- [ ] **Existing core deep exports** preserved unchanged in export map.
- [ ] **Newly-added core deep exports** added with correct dist paths.
- [ ] **`SecureStoreErrorCode`** included as `export type` in secure-store shim.
- [ ] **Literal shim contents match exactly** the contents specified in this phase file.
- [ ] No duplicate implementation remains in core moved files.
- [ ] `resetConversationFileWriterForTesting` is NOT re-exported from any core shim.
- [ ] SessionPersistenceService still compiles with relative `Storage` import through shim.
- [ ] Representative core consumers compile and their tests pass.
- [ ] Core behavioral tests for moved implementations are deleted from core.
- [ ] **Core git utility originals (`gitIgnoreParser.ts`, `gitUtils.ts`) still exist as full implementations — NOT shimmed, NOT deleted.** Verified by `test -f` and absence of `@vybestack/llxprt-code-storage` in those files.
- [ ] `storage-compat.test.ts` proves root/deep/singleton compatibility.
- [ ] **Dependency removal evidence**: rg output recorded in `.completed/P05.md`.
- [ ] **Core root export identity**: every moved symbol importable from both `@vybestack/llxprt-code-core` root and `@vybestack/llxprt-code-storage` root with strict equality.
- [ ] P05-V verifier compares implementation to pseudocode lines 24-26.

## Success Criteria

- Core tests/typecheck/build pass for compatibility slice.
- Core moved files are shims only (literal contents match this phase file).
- Storage implementation remains the source of truth.
- P05-V verifier returns PASS before P06.

## Failure Recovery

Fix compatibility shims and core package metadata before direct consumer integration.

## Phase Completion Marker

Create `project-plans/issue1590/.completed/P05.md` with files changed and verification output.
