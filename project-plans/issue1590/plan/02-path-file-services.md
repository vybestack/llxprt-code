# Phase 02: Move Path and File Service Behavior/Tests

## Phase ID

`PLAN-20260609-ISSUE1590.P02`

**Phase Structure**: This phase is split into three sequential subphases with verifier gates between each:
- **P02a**: Create stubs for path/file service implementations (exporting complete public API surface with correct types, throwing "not implemented" at runtime)
- **P02b**: Create/modify tests, capture RED output (tests fail against stubs)
- **P02c**: Copy implementations, make tests pass (GREEN)

Each subphase must complete before the next begins. The verifier must explicitly inspect RED output before P02c starts.

## Prerequisites

- Required: Phase P01 completed and P01-V PASS.
- Verification: `test -f project-plans/issue1590/.completed/P01.md`.
- Expected files from previous phase: storage package scaffold.

## Requirements Implemented (Expanded)

### REQ-STORAGE-001: Move Storage Paths

**Full Text**: Move the `Storage` class and constants from `packages/core/src/config/storage.ts` into `packages/storage/src/config/storage.ts` while preserving path behavior.
**Behavior**:

- GIVEN: existing code computes global and project `.llxprt` paths
- WHEN: code imports `Storage` from the storage package
- THEN: it returns the same paths as before for the same environment and project root

**Why This Matters**: Path changes could break user settings, OAuth files, history, commands, skills, and temp data.

### REQ-FILES-001: Move File Services

**Full Text**: Move `FileSystemService`, `StandardFileSystemService`, `FileDiscoveryService`, and related types into `packages/storage`, with internal git ignore utilities copied locally so file discovery remains functional.
**Behavior**:

- GIVEN: file service and discovery behavior currently lives in core
- WHEN: it is imported from storage
- THEN: reads/writes and ignore filtering behave identically to the existing implementation

**Why This Matters**: File tools, search, and discovery rely on these abstractions for correct filtering and filesystem access.

---

## Subphase P02a: Create Implementation Stubs

### Purpose

Create stub files that export the complete public API surface with correct types. Runtime methods throw "not implemented" or return wrong-but-typed values, so tests can import them without module resolution errors and fail at the assertion level.

### Files to Create

- `packages/storage/src/config/storage.ts`
  - Stub: export all public symbols with correct signatures. Runtime methods throw "not implemented" but the module's public API surface is complete:
    - `export const LLXPRT_DIR = '';` — wrong value but typed correctly as `string`.
    - `export const PROVIDER_ACCOUNTS_FILENAME = '';` — wrong value but typed correctly.
    - `export const OAUTH_FILE = '';` — wrong value but typed correctly.
    - `export class Storage { constructor() { throw new Error('not implemented'); } }` — class with constructor.
  - **Why export constants in stubs**: Tests that import `LLXPRT_DIR`, `PROVIDER_ACCOUNTS_FILENAME`, or `OAUTH_FILE` must not fail at import time. Stubs must typecheck so RED failures are behavioral (e.g., `expect(LLXPRT_DIR).toBe('.llxprt')` fails because the stub returns `''`).
- `packages/storage/src/services/fileSystemService.ts`
  - Stub: export `FileSystemService` (abstract class with methods throwing "not implemented"), `StandardFileSystemService` (class extending FileSystemService with methods throwing "not implemented"). Methods have correct signatures.
- `packages/storage/src/services/fileDiscoveryService.ts`
  - Stub: export `FileDiscoveryService` (class with constructor throwing "not implemented"), `FilterFilesOptions` (interface — copy actual shape from core), `FilterReport` (interface — copy actual shape from core).
- `packages/storage/src/utils/gitIgnoreParser.ts`
  - Stub: export functions with names matching the real implementation signatures, each throwing "not implemented".
- `packages/storage/src/utils/gitUtils.ts`
  - Stub: export functions with names matching the real implementation signatures, each throwing "not implemented".

### Barrel Export Update

- `packages/storage/src/index.ts`
  - Do NOT export any of the stubbed modules yet. The barrel must remain empty or export only the logger from P01.
  - Test files will import directly from relative paths, not through the barrel, until P02c.

### Verification (P02a)

```bash
# Stubs must typecheck (they export valid TypeScript with complete public API surface)
npm run typecheck --workspace @vybestack/llxprt-code-storage
# Stubs must exist
for f in packages/storage/src/config/storage.ts packages/storage/src/services/fileSystemService.ts packages/storage/src/services/fileDiscoveryService.ts packages/storage/src/utils/gitIgnoreParser.ts packages/storage/src/utils/gitUtils.ts; do test -f "$f" || { echo "MISSING STUB: $f"; exit 1; }; done
# Stubs must export complete public API surface — check via grep for export keywords
grep -q 'export.*LLXPRT_DIR\|export.*PROVIDER_ACCOUNTS_FILENAME\|export.*OAUTH_FILE' packages/storage/src/config/storage.ts || { echo "STUB INCOMPLETE: missing constant exports from storage.ts"; exit 1; }
grep -q 'export.*class Storage' packages/storage/src/config/storage.ts || { echo "STUB INCOMPLETE: missing Storage class export"; exit 1; }
grep -q 'export.*class FileSystemService\|export.*abstract.*class FileSystemService' packages/storage/src/services/fileSystemService.ts || { echo "STUB INCOMPLETE: missing FileSystemService export"; exit 1; }
grep -q 'export.*class StandardFileSystemService' packages/storage/src/services/fileSystemService.ts || { echo "STUB INCOMPLETE: missing StandardFileSystemService export"; exit 1; }
grep -q 'export.*class FileDiscoveryService' packages/storage/src/services/fileDiscoveryService.ts || { echo "STUB INCOMPLETE: missing FileDiscoveryService export"; exit 1; }
```

### P02a Completion Marker

Create `project-plans/issue1590/.completed/P02a.md` listing stub files created.

### P02a-V Verifier

The verifier MUST confirm:
1. All stub files exist.
2. Stubs typecheck.
3. Stubs export the complete public API surface: `Storage` (class), `LLXPRT_DIR` (constant), `PROVIDER_ACCOUNTS_FILENAME` (constant), `OAUTH_FILE` (constant), `FileSystemService` (class), `StandardFileSystemService` (class), `FileDiscoveryService` (class), `FilterFilesOptions` (type), `FilterReport` (type).
4. Runtime methods throw or return wrong-but-typed values (not missing exports).

Write result to `.completed/P02a-V.md`.

---

## Subphase P02b: Create/Modify Tests and Capture RED

### Purpose

Copy behavioral tests from core into storage with import rewrites, then run them against stubs to capture RED output proving tests fail for the right reasons (assertion failures, not import errors).

### Import Rewrite Rules for Moved Tests

When copying test files from core to storage, apply these exact rewrites:

- `packages/core/src/config/storage.test.ts` → `packages/storage/src/config/storage.test.ts`:
  - `from '../config/storage.js'` or `from './storage.js'` → `from './storage.js'` (same directory in storage).
  - Any import from `'../utils/debugLogger.js'` → remove; not needed for `Storage` tests.
  - Any import from `'@vybestack/llxprt-code-core'` → `from '@vybestack/llxprt-code-storage'` if it references moved symbols.

- `packages/core/src/services/fileSystemService.test.ts` → `packages/storage/src/services/fileSystemService.test.ts`:
  - `from '../services/fileSystemService.js'` or `from './fileSystemService.js'` → `from './fileSystemService.js'`.
  - Any import from `'@vybestack/llxprt-code-core'` → `from '@vybestack/llxprt-code-storage'` if it references moved symbols.

- `packages/core/src/services/fileDiscoveryService.test.ts` → `packages/storage/src/services/fileDiscoveryService.test.ts`:
  - `from '../services/fileDiscoveryService.js'` or `from './fileDiscoveryService.js'` → `from './fileDiscoveryService.js'`.
  - `from '../utils/gitIgnoreParser.js'` or `from '../../utils/gitIgnoreParser.js'` → `from '../utils/gitIgnoreParser.js'` (now local to storage).
  - Any import from `'@vybestack/llxprt-code-core'` → `from '@vybestack/llxprt-code-storage'` if it references moved symbols.

- `packages/core/src/utils/gitIgnoreParser.test.ts` → `packages/storage/src/utils/gitIgnoreParser.test.ts`:
  - `from './gitIgnoreParser.js'` → `from './gitIgnoreParser.js'` (same directory).
  - Any import from `'@vybestack/llxprt-code-core'` → `from '@vybestack/llxprt-code-storage'` if it references moved symbols.

### Files to Create

- `packages/storage/src/config/storage.test.ts` (copied from core with rewrites)
- `packages/storage/src/services/fileSystemService.test.ts` (copied from core with rewrites)
- `packages/storage/src/services/fileDiscoveryService.test.ts` (copied from core with rewrites)
- `packages/storage/src/utils/gitIgnoreParser.test.ts` (copied from core with rewrites)

### RED Gate

Run tests against stubs:

```bash
npm run test --workspace @vybestack/llxprt-code-storage -- packages/storage/src/config/storage.test.ts packages/storage/src/services/fileSystemService.test.ts packages/storage/src/services/fileDiscoveryService.test.ts packages/storage/src/utils/gitIgnoreParser.test.ts
```

**Expected**: Tests fail because stub implementations throw "not implemented" or export wrong-but-typed values. Capture output in `.completed/P02b.md` under `## RED Output` heading. The output must show:
1. Tests ran (not just import/module resolution errors).
2. Multiple specific test scenarios failed with behavioral assertion failures — e.g., `expect(LLXPRT_DIR).toBe('.llxprt')` fails because stub returns `''`; `new Storage()` throws "not implemented" caught by test assertions.
3. **Unrelated tests passing is acceptable** — tests that exercise only features not yet stubbed (e.g., logger tests from P01) may pass. The gate requires that every targeted behavioral test against P02a stubs fails. Specifically: every test that asserts against `LLXPRT_DIR`, `PROVIDER_ACCOUNTS_FILENAME`, `OAUTH_FILE`, `Storage`, `FileSystemService`, `StandardFileSystemService`, `FileDiscoveryService`, or `gitIgnoreParser` public API must fail with a behavioral assertion mismatch or "not implemented" throw — not with an import/type error.
4. The failure set must include at least: path/storage constant tests (wrong values) and service construction tests ("not implemented" throws). Each test file that tests P02a-stubbed behavior must have at least one targeted behavioral failure.

**Verifier gate**: The verifier MUST explicitly inspect the captured RED output and confirm (a), (b), (c), and (d) above. If RED output is missing, shows no failures, or shows only import errors (not behavioral failures), the verifier MUST return FAIL.

### P02b Completion Marker

Create `project-plans/issue1590/.completed/P02b.md` with RED output captured.

### P02b-V Verifier

The verifier MUST confirm:
1. RED output exists in `.completed/P02b.md`.
2. RED output shows tests that **ran** (not import/module resolution errors). If output shows `Cannot find module` or `has no exported member`, the stub was incomplete — return FAIL and request stub fix.
3. Multiple specific test scenarios failed with behavioral assertions (wrong values, "not implemented" throws), not structural errors.
4. Every test that asserts against P02a-stubbed symbols (`LLXPRT_DIR`, `Storage`, `FileSystemService`, `FileDiscoveryService`, etc.) shows a behavioral failure. Unrelated tests (e.g., logger tests from P01) may pass.
5. Each test file targeting P02a-stubbed behavior shows at least one targeted behavioral failure.

Write result to `.completed/P02b-V.md`.

---

## Subphase P02c: Copy Implementations and Make Tests Pass (GREEN)

### Purpose

Replace stubs with real implementations copied from core, applying import rewrites. Update barrel exports. Make all P02b tests pass.

### Implementation Import Rewrites

When copying implementation files, apply these exact rewrites:

- `packages/core/src/services/fileDiscoveryService.ts` → `packages/storage/src/services/fileDiscoveryService.ts`:
  - `from '../utils/gitIgnoreParser.js'` → `from '../utils/gitIgnoreParser.js'` (same relative, but resolves to storage-local copy).
  - `from '../utils/gitUtils.js'` → `from '../utils/gitUtils.js'` (same relative, resolves to storage-local copy).
- All other implementation files (`storage.ts`, `fileSystemService.ts`, `gitIgnoreParser.ts`, `gitUtils.ts`) require no import path changes as they use only Node built-ins or their own local paths.

### Files to Modify

- Replace ALL stub files from P02a with real implementations copied from core:
  - `packages/storage/src/config/storage.ts` — full implementation from `packages/core/src/config/storage.ts`. Implements pseudocode line 06.
  - `packages/storage/src/services/fileSystemService.ts` — full implementation from `packages/core/src/services/fileSystemService.ts`. Implements pseudocode line 07.
  - `packages/storage/src/services/fileDiscoveryService.ts` — full implementation from `packages/core/src/services/fileDiscoveryService.ts`. Implements pseudocode lines 08 and 10.
  - `packages/storage/src/utils/gitIgnoreParser.ts` — full implementation. Internal utility for pseudocode line 09.
  - `packages/storage/src/utils/gitUtils.ts` — full implementation. Internal utility for pseudocode line 09.
- `packages/storage/src/index.ts`
  - Export `Storage`, constants, file services, and public related types.
  - Do not export `gitIgnoreParser` or `gitUtils`.

### GREEN Verification

```bash
npm run test --workspace @vybestack/llxprt-code-storage -- packages/storage/src/config/storage.test.ts packages/storage/src/services/fileSystemService.test.ts packages/storage/src/services/fileDiscoveryService.test.ts packages/storage/src/utils/gitIgnoreParser.test.ts
npm run typecheck --workspace @vybestack/llxprt-code-storage
rg "from ['\"].*packages/core|@vybestack/llxprt-code-core" packages/storage/src -g '*.ts' && exit 1 || true
rg "gitIgnoreParser|gitUtils" packages/storage/src/index.ts && exit 1 || true
```

All tests must pass. Capture output in `.completed/P02c.md` under `## GREEN Output` heading.

### Files to Leave in Core for Now

- Keep these originals unchanged in P02: `packages/core/src/config/storage.ts`, `packages/core/src/config/storage.test.ts`, `packages/core/src/services/fileSystemService.ts`, `packages/core/src/services/fileSystemService.test.ts`, `packages/core/src/services/fileDiscoveryService.ts`, `packages/core/src/services/fileDiscoveryService.test.ts`, `packages/core/src/utils/gitIgnoreParser.ts`, `packages/core/src/utils/gitIgnoreParser.test.ts`, and `packages/core/src/utils/gitUtils.ts`.
- P05 must convert only the moved implementation files to shims and remove/replace duplicate core behavior tests for moved APIs. Core utility tests for core-owned `gitIgnoreParser.ts` may remain because core keeps that utility for non-storage users.

### P02c Completion Marker

Create `project-plans/issue1590/.completed/P02c.md` with GREEN output, files changed, and verification output.

### P02c-V Verifier

The verifier MUST confirm:
1. GREEN output exists in `.completed/P02c.md`.
2. All P02b tests now pass.
3. `npm run typecheck --workspace @vybestack/llxprt-code-storage` passes.
4. No core imports in storage source.
5. Git utility imports in `fileDiscoveryService.ts` resolve to local storage copies.
6. Implementation matches pseudocode lines 06-10.

Write result to `.completed/P02c-V.md`.

---

## Overall Phase Verification Commands (P02 Verifier Sequence)

The P02 subphase verifiers (P02a-V, P02b-V, P02c-V) replace the previous single P02-V verifier. Each subphase verifier checks its own completion marker and runs its own verification commands. The overall phase is complete when all three subphase verifier markers exist:

```bash
# Verify all subphase and verifier markers exist
test -f project-plans/issue1590/.completed/P02a.md
test -f project-plans/issue1590/.completed/P02a-V.md
test -f project-plans/issue1590/.completed/P02b.md
test -f project-plans/issue1590/.completed/P02b-V.md
test -f project-plans/issue1590/.completed/P02c.md
test -f project-plans/issue1590/.completed/P02c-V.md
```

## Semantic Verification Checklist

- [ ] P02a stubs exist and typecheck but export no functional behavior. P02a-V confirmed.
- [ ] P02a stubs export complete public API surface: `Storage`, `LLXPRT_DIR`, `PROVIDER_ACCOUNTS_FILENAME`, `OAUTH_FILE`, `FileSystemService`, `StandardFileSystemService`, `FileDiscoveryService`, `FilterFilesOptions`, `FilterReport`.
- [ ] P02b RED output shows behavioral test failures (not import/type errors) against stubs. P02b-V explicitly inspected and confirmed.
- [ ] P02c GREEN output shows all tests passing against real implementations. P02c-V confirmed.
- [ ] Storage path tests verify real path outputs, not only object shape.
- [ ] FileSystemService tests exercise real service behavior or infrastructure-only filesystem mocks.
- [ ] FileDiscoveryService tests exercise actual `.gitignore`/`.llxprtignore` filtering.
- [ ] GitIgnoreParser tests exercise parser-specific behavior in storage.
- [ ] Imports inside storage file discovery use local utilities.
- [ ] Storage package does not import core.
- [ ] Verifiers compared implementation to pseudocode lines 06-10 and 23.

## Success Criteria

- All subphase completion markers exist.
- RED output captured and verified.
- Path and file service tests pass in `packages/storage`.
- Public storage barrel exports intended APIs.
- Git utility implementation is internal and tested.
- P02c-V verifier returns PASS before P03.

## Failure Recovery

Fix moved code/tests in storage before continuing to secure store extraction.

## Phase Completion Marker

The phase is complete when all three subphase markers and all three subphase verifier markers exist (P02a.md, P02a-V.md, P02b.md, P02b-V.md, P02c.md, P02c-V.md).
