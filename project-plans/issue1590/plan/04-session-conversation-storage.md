# Phase 04: Move Session Types and Conversation File Writer Behavior/Tests

## Phase ID

`PLAN-20260609-ISSUE1590.P04`

**Phase Structure**: This phase is split into four sequential subphases with per-subphase verifier gates:
- **P04a**: Create stubs for session types and conversation file writer
- **P04b**: Create tests (new for CFW, copied for session types), capture RED output
- **P04c**: Copy session types implementation, make session tests pass (GREEN)
- **P04d**: Copy conversation file writer implementation, make CFW tests pass (GREEN)

Session types (P04c) and conversation file writer (P04d) are separated because CFW has more complex implementation (logger injection, singleton) and gets entirely new tests.

Each subphase must complete and pass its per-subphase verifier before the next begins. Per `dev-docs/COORDINATING.md`: worker → verifier → next worker.

## Prerequisites

- Required: Phase P03 completed and P03c-V PASS.
- Verification: `test -f project-plans/issue1590/.completed/P03c-V.md`.
- Expected files from previous phase: secure store APIs in storage.

## Requirements Implemented (Expanded)

### REQ-SESSIONTYPES-001: Move Session Types

**Full Text**: Move session record types and constants from `packages/core/src/storage/sessionTypes.ts` into `packages/storage/src/session/sessionTypes.ts`.
**Behavior**:

- GIVEN: callers need session file record types/constants
- WHEN: they import from storage or core compatibility shims
- THEN: the same exported names are available

**Why This Matters**: Session record format types are foundational and do not need core dependencies.

### REQ-CONVLOG-001: Move Conversation File Writer

**Full Text**: Move `ConversationFileWriter` and `getConversationFileWriter` into `packages/storage/src/conversation/ConversationFileWriter.ts` while preserving JSONL format and default log path.
**Behavior**:

- GIVEN: provider logging writes request/response/tool call entries
- WHEN: it uses the moved conversation file writer
- THEN: JSONL entries include timestamps and payload fields in the same default directory behavior as before

**Why This Matters**: Provider logging must continue to persist conversations after package extraction.

### ConversationFileWriter Test Coverage Baseline

**Evidence**: `test -f packages/core/src/storage/ConversationFileWriter.test.ts` returns false. There are NO existing behavioral tests for `ConversationFileWriter` in core. New tests must be written in storage (P04b) — this is new coverage, not a move.

After `getConversationFileWriter` is moved to storage, provider logging integration tests must verify that `LoggingProviderWrapper.ts` correctly calls the moved writer. These tests are specified in P06 (separate from this phase) after consumer import rewiring.

---

## Subphase P04a: Create Implementation Stubs

### Purpose

Create minimal stub files so tests can import modules without resolution errors.

### Files to Create

- `packages/storage/src/session/sessionTypes.ts`
  - Stub: export all public symbols with correct signatures. The real file exports `SESSION_FILE_PREFIX`, `ConversationRecord`, `BaseMessageRecord`, `ToolCallRecord`. The stub must export all of them:
    - `export const SESSION_FILE_PREFIX = '';` — wrong value but typed correctly.
    - `export interface ConversationRecord { ... }` — copy the actual interface shape from core.
    - `export interface BaseMessageRecord { ... }` — copy the actual interface shape from core.
    - `export interface ToolCallRecord { ... }` — copy the actual interface shape from core.
  - **Why export types in stubs**: Tests that import these types for type annotations must not fail at import time. Stubs must typecheck so RED failures are behavioral.
- `packages/storage/src/conversation/ConversationFileWriter.ts`
  - Stub: export all public symbols with correct signatures. Runtime methods throw "not implemented":
    - `export class ConversationFileWriter { constructor(_logPath?: string) { throw new Error('not implemented'); } }` — class with correct constructor signature.
    - `export function getConversationFileWriter(_logPath?: string): ConversationFileWriter { throw new Error('not implemented'); }` — function with correct signature.
    - `export function resetConversationFileWriterForTesting(): void {}` — empty function (test-only, exported from source but NOT from barrel).

### Verification (P04a)

```bash
test -f packages/storage/src/session/sessionTypes.ts
test -f packages/storage/src/conversation/ConversationFileWriter.ts
npm run typecheck --workspace @vybestack/llxprt-code-storage
# Verify complete public API surface
grep -q 'SESSION_FILE_PREFIX' packages/storage/src/session/sessionTypes.ts || { echo "STUB INCOMPLETE: missing SESSION_FILE_PREFIX"; exit 1; }
grep -q 'ConversationRecord' packages/storage/src/session/sessionTypes.ts || { echo "STUB INCOMPLETE: missing ConversationRecord"; exit 1; }
grep -q 'BaseMessageRecord' packages/storage/src/session/sessionTypes.ts || { echo "STUB INCOMPLETE: missing BaseMessageRecord"; exit 1; }
grep -q 'ToolCallRecord' packages/storage/src/session/sessionTypes.ts || { echo "STUB INCOMPLETE: missing ToolCallRecord"; exit 1; }
grep -q 'ConversationFileWriter' packages/storage/src/conversation/ConversationFileWriter.ts || { echo "STUB INCOMPLETE: missing ConversationFileWriter"; exit 1; }
grep -q 'getConversationFileWriter' packages/storage/src/conversation/ConversationFileWriter.ts || { echo "STUB INCOMPLETE: missing getConversationFileWriter"; exit 1; }
grep -q 'resetConversationFileWriterForTesting' packages/storage/src/conversation/ConversationFileWriter.ts || { echo "STUB INCOMPLETE: missing resetConversationFileWriterForTesting"; exit 1; }
```

### P04a Completion Marker

Create `project-plans/issue1590/.completed/P04a.md` listing stub files created.

### P04a-V Verifier

The verifier MUST confirm:
1. All stub files exist.
2. Stubs typecheck.
3. Stubs export the complete public API surface: `SESSION_FILE_PREFIX`, `ConversationRecord`, `BaseMessageRecord`, `ToolCallRecord`, `ConversationFileWriter`, `getConversationFileWriter`, `resetConversationFileWriterForTesting`.
4. Runtime methods throw or return wrong-but-typed values (not missing exports).

Write result to `.completed/P04a-V.md`.

---

## Subphase P04b: Create Tests and Capture RED

### Purpose

Create new tests for ConversationFileWriter and session types. Run against stubs to capture RED output.

### Session Types Test

- `packages/storage/src/session/sessionTypes.test.ts` (NEW)
  - Scenario 1: `import { SESSION_FILE_PREFIX } from '../session/sessionTypes.js'` — assert `SESSION_FILE_PREFIX === 'session-'`.
  - Scenario 2: `import type { ConversationRecord, BaseMessageRecord, ToolCallRecord } from '../session/sessionTypes.js'` — create a valid `ConversationRecord` object with required fields and confirm it satisfies the type (compile-time assertion via variable assignment).
  - Scenario 3 (root barrel import — tested in P04d): root import `import { SESSION_FILE_PREFIX, type ConversationRecord } from '@vybestack/llxprt-code-storage'` is NOT tested in P04b because the barrel has not been updated yet. P04d updates the barrel and must add this test. See P04d "Barrel Import Test" below.

### ConversationFileWriter Test

- `packages/storage/src/conversation/ConversationFileWriter.test.ts` (NEW)
  - **CRITICAL**: No test in this file may write to the real `~/.llxprt` directory. All tests must use `os.tmpdir()` or a temporary directory via `fs.promises.mkdtemp()`. For zero-arg backward-compat tests that would normally default to `~/.llxprt/conversations`, use one of these approaches:
    - **Approach A (preferred)**: Override `os.homedir` via `vi.mock('os', ...)` to return a temp directory, so `new ConversationFileWriter()` resolves to the temp path. Clean up the temp directory in `afterEach`.
    - **Approach B**: Test zero-arg construction only verifies the instance is created and the path includes `.llxprt/conversations`, without actually writing. Then test actual writes using one-arg construction with a temp path.
  - **Behavioral assertions against real observable output**:
    - Scenario 1 (request write): `new ConversationFileWriter(tmpPath)`, call `writeRequest('openai', [{ role: 'user', content: 'hi' }], { sessionId: 's1' })`. Read the resulting JSONL file from disk. Assert the file contains one line, the parsed JSON has `type: 'request'`, `provider: 'openai'`, messages match input, context is present, and `timestamp` is a valid ISO string.
    - Scenario 2 (response write): `writeResponse('openai', { text: 'ok' }, { tokens: 2 })`. Read the JSONL file. Assert second line has `type: 'response'`, response payload matches, metadata present, valid timestamp.
    - Scenario 3 (tool call write): `writeToolCall('openai', 'read_file', { path: 'README.md' })`. Read the JSONL file. Assert JSON has `type: 'tool_call'`, `provider: 'openai'`, `tool: 'read_file'`, context spread at top level (not nested under `context`), valid timestamp.
    - Scenario 4 (singleton reuse): `getConversationFileWriter(customPath)` returns the same instance on repeated calls. After calling `resetConversationFileWriterForTesting()` (imported from `@vybestack/llxprt-code-storage/testing`), a new call returns a different instance. **Note**: `resetConversationFileWriterForTesting` is imported from the test-only deep export `@vybestack/llxprt-code-storage/testing`, NOT from the barrel. See specification Tier 3 changes.
- Scenario 5 (zero-arg backward compat): `new ConversationFileWriter()` constructs without error. Verify the resolved `logPath` includes `.llxprt` and `conversations`. Do NOT write to the real home directory — use mocked `os.homedir` returning a temp directory.
  - Scenario 6 (one-arg backward compat): `new ConversationFileWriter(tmpPath)`. Write a response, read the JSONL file, verify entry is valid.
  - Scenario 7 (writeEntry error path — deterministic filesystem failure): Construct a `ConversationFileWriter` with a log path whose parent directory component is a regular file (not a directory), causing `mkdir` to fail deterministically. Setup: use `fs.promises.mkdtemp` to create a temp directory, then write a regular file inside it (e.g., `<tmpdir>/regularfile`), then use `<tmpdir>/regularfile/conversations` as the log path. Call `writeEntry({ type: 'test', data: 'hello' })`. `testLogger` is a `StorageLogger` implementation that records calls to a local array. Assert the logger's error array contains an entry. Do NOT use `vi.fn()` mock assertions — use a real logger object that pushes to an observable array. This approach is platform-stable and does not depend on filesystem permission semantics which differ across macOS/Linux/Windows and CI environments. **Why test writeEntry failure, not constructor failure**: the constructor is backward-compatible and existing callers never pass a logger, so it is not the primary error path. The error path that matters is `writeEntry` when directory creation or file append fails — this is the path core `debugLogger.error` previously covered. Testing constructor failure with a bad path would add a new behavioral requirement not present in the current implementation.
  - Scenario 8 (logger injection): `new ConversationFileWriter(parentIsFilePath, testLogger)` where `parentIsFilePath` is constructed as in Scenario 7 (parent is a regular file). Verify `testLogger.error` was called by checking the recorded array contents, NOT by using `expect(testLogger.error).toHaveBeenCalled()`.

### RED Gate

```bash
npm run test --workspace @vybestack/llxprt-code-storage -- packages/storage/src/session/sessionTypes.test.ts packages/storage/src/conversation/ConversationFileWriter.test.ts --reporter verbose
```

**Expected**: Tests fail because stubs throw "not implemented" or export wrong values. Capture output in `.completed/P04b.md` under `## RED Output` heading. The output must show:
1. Tests ran (not just import/module resolution errors).
2. Multiple specific test scenarios failed with behavioral assertion failures.
3. **Unrelated tests passing is acceptable** — tests that exercise only features not in P04 scope (e.g., path/file service tests from P02c, secure store tests from P03c, logger tests from P01) may pass. The gate requires that every targeted behavioral test against P04a stubs fails. Specifically: every test that asserts against `SESSION_FILE_PREFIX`, `ConversationRecord` (runtime shape), `ConversationFileWriter`, `getConversationFileWriter`, or `resetConversationFileWriterForTesting` must fail with a behavioral assertion mismatch or "not implemented" throw.
4. **Session types compile-time assertions may pass** (type-only tests that verify `ConversationRecord` satisfies an interface are erased at runtime). That is acceptable. However, the **runtime assertions must fail**: `expect(SESSION_FILE_PREFIX).toBe('session-')` must fail because the stub returns `''`. The RED output must show at least this runtime assertion failure.
5. **ConversationFileWriter tests must fail** with behavioral failures: `new ConversationFileWriter(tmpPath)` throws "not implemented" from the stub, caught by test assertions. The RED output must show at least: construction failures, singleton access failures, and write-method failures.
6. Each test file targeting P04a-stubbed behavior must show at least one targeted behavioral failure.

### P04b Completion Marker

Create `project-plans/issue1590/.completed/P04b.md` with RED output captured.

### P04b-V Verifier

The verifier MUST confirm:
1. RED output exists in `.completed/P04b.md`.
2. RED output shows tests that **ran** (not import/module resolution errors). If output shows `Cannot find module` or `has no exported member`, the stub was incomplete — return FAIL and request stub fix.
3. Session types runtime assertion failed: `SESSION_FILE_PREFIX` stub value `''` was correctly rejected by `expect(SESSION_FILE_PREFIX).toBe('session-')`. Compile-time type assertions passing is acceptable.
4. ConversationFileWriter tests failed with behavioral failures: construction threw "not implemented", singleton access threw, write methods threw.
5. Every test that asserts against P04a-stubbed symbols shows a behavioral failure. Unrelated tests (e.g., P02c/P03c tests) may pass.
6. Failures are behavioral (assertion failures, wrong values, "not implemented" throws), not structural (missing imports, type errors).

Write result to `.completed/P04b-V.md`.

---

## Subphase P04c: Session Types Implementation (GREEN)

### Purpose

Replace session types stub with real implementation.

### Files to Modify

- Replace `packages/storage/src/session/sessionTypes.ts` stub with full implementation from `packages/core/src/storage/sessionTypes.ts`.
  - Implements pseudocode line 19.
  - Must export: `SESSION_FILE_PREFIX` (const string), `ToolCallRecord` (interface), `BaseMessageRecord` (interface), `ConversationRecord` (interface).
  - No modifications needed — pure types/constants file with no runtime dependencies.

### Verification

```bash
npm run test --workspace @vybestack/llxprt-code-storage -- packages/storage/src/session/sessionTypes.test.ts
npm run typecheck --workspace @vybestack/llxprt-code-storage
```

### P04c Completion Marker

Create `project-plans/issue1590/.completed/P04c.md`.

### P04c-V Verifier

The verifier MUST confirm:
1. Session types tests pass.
2. `npm run typecheck --workspace @vybestack/llxprt-code-storage` passes.
3. All session type exports are preserved.

Write result to `.completed/P04c-V.md`.

---

## Subphase P04d: Conversation File Writer Implementation (GREEN)

### Purpose

Replace CFW stub with real implementation. Make CFW tests pass.

### Files to Modify

- Replace `packages/storage/src/conversation/ConversationFileWriter.ts` stub with full implementation from `packages/core/src/storage/ConversationFileWriter.ts`.
  - Implements pseudocode lines 20-21.
  - **Backward-compatible public signatures (exact, from current core implementation)**:
    - `constructor(logPath?: string)` — unchanged.
    - `writeEntry(entry: Record<string, unknown>): void` — unchanged.
    - `writeRequest(provider: string, messages: unknown[], context?: Record<string, unknown>): void` — unchanged.
    - `writeResponse(provider: string, response: unknown, metadata?: Record<string, unknown>): void` — unchanged.
    - `writeToolCall(provider: string, toolName: string, context?: Record<string, unknown>): void` — unchanged.
  - **Additive-only changes for storage package**:
    - Replace `import { debugLogger } from '../utils/debugLogger.js'` with optional injected `StorageLogger`.
    - Constructor gains an optional second parameter: `constructor(logPath?: string, logger?: StorageLogger)`. When `logger` is not provided, uses `NullStorageLogger` (silent). Backward-compatible because existing callers pass zero or one argument.
    - `writeEntry` error handling: replaces `debugLogger.error(...)` with `this.logger?.error(...)`.
    - **`logPath` resolution preserved exactly**: `this.logPath = logPath || path.join(os.homedir(), '.llxprt', 'conversations')` — falsy coalescing (`||`), not nullish coalescing (`??`). Empty string `''` is falsy and falls through to the default, matching existing behavior.
    - **`currentLogFile` preserved exactly**: `this.currentLogFile = path.join(this.logPath, 'conversation-${new Date().toISOString().split('T')[0]}.jsonl')` — appends date-stamped filename to `this.logPath` (the directory), not to the caller-supplied path directly.
    - **Constructor does NOT call mkdir**: Directory creation is lazy — it happens in `writeEntry` on first write, not in the constructor. This preserves the exact existing constructor behavior (backward-compatible, no new failure modes for existing callers who construct without writing). The constructor is purely state initialization: logPath, currentLogFile, and logger.
  - Export `getConversationFileWriter(logPath?: string): ConversationFileWriter` — unchanged signature.
  - Export `resetConversationFileWriterForTesting()` for test singleton cleanup.

- **`packages/storage/src/index.ts` — barrel export update (explicit P04d task)**:
  - Export from `./session/sessionTypes.js`: all session record types and constants (`SESSION_FILE_PREFIX`, `ConversationRecord`, `BaseMessageRecord`, `ToolCallRecord`).
  - Export from `./conversation/ConversationFileWriter.js`: `ConversationFileWriter`, `getConversationFileWriter`.
  - Do NOT export `resetConversationFileWriterForTesting` from barrel.

- **`packages/storage/src/testing.ts` — populate test-only deep export**:
  ```typescript
  // packages/storage/src/testing.ts
  // Test-only exports — NOT part of stable public API (Tier 3)
  // These may change between minor versions without notice
  export { resetConversationFileWriterForTesting } from './conversation/ConversationFileWriter.js';
  ```

### `resetConversationFileWriterForTesting` Test-Only Export Convention

**This function is NOT part of the stable public API (Tier 3).** It is exported from a test-only deep export path:

- **Package export map must include**: `"./testing": "./dist/src/testing.js"`
- **Create `packages/storage/src/testing.ts`** that re-exports test-only symbols:
  ```typescript
  // packages/storage/src/testing.ts
  // Test-only exports — NOT part of stable public API (Tier 3)
  // These may change between minor versions without notice
  export { resetConversationFileWriterForTesting } from './conversation/ConversationFileWriter.js';
  ```
- **The barrel (`packages/storage/src/index.ts`) does NOT export `resetConversationFileWriterForTesting`.**
- **Tests import it as**: `import { resetConversationFileWriterForTesting } from '@vybestack/llxprt-code-storage/testing';`
- **Core compatibility shims in P05 must NOT re-export this symbol.**
- **Rationale**: This follows the common pattern of `@angular/core/testing`, `@nestjs/testing`, etc. — a dedicated test-only entry point that is explicitly not part of the stable API contract. This avoids polluting the root barrel with test-only symbols while giving tests a clean import path.

### Expanded Pseudocode Algorithms

#### ConversationFileWriter Singleton/Reset/Default Path/Error Logging

```
Algorithm: getConversationFileWriter singleton
1. IF _instance is null THEN
2.   SET _instance = new ConversationFileWriter(logPath)
3. END IF
4. RETURN _instance

Algorithm: resetConversationFileWriterForTesting
1. SET _instance = null

Algorithm: ConversationFileWriter constructor
1. IF logPath is provided AND truthy THEN
2.   SET this.logPath = logPath
3. ELSE
4.   SET this.logPath = path.join(os.homedir(), '.llxprt', 'conversations')
5. END IF
6. SET this.currentLogFile = path.join(this.logPath, 'conversation-' + new Date().toISOString().split('T')[0] + '.jsonl')
7. IF logger is provided THEN
8.   SET this.logger = logger
9. ELSE
10.  SET this.logger = new NullStorageLogger()
11. END IF

Algorithm: writeEntry — directory creation and write with error logging
1. SET line = JSON.stringify({ ...entry, timestamp: new Date().toISOString() })
2. TRY
3.   ENSURE directory this.logPath exists (mkdir recursive) — lazily on first write, NOT in constructor
4.   appendFileSync(this.currentLogFile, line + '\n')
5. CATCH error
6.   CALL this.logger.error('Failed to write log entry:', error)
7.   // Do NOT rethrow — matching existing behavior
8. END TRY
```

### Barrel Import Test (P04d — after barrel update)

After `packages/storage/src/index.ts` is updated in P04d to export session types and ConversationFileWriter, add or update the following test to verify root barrel access:

- In `packages/storage/src/session/sessionTypes.test.ts`, add:
  - Scenario 3 (root barrel import): `import { SESSION_FILE_PREFIX, type ConversationRecord } from '@vybestack/llxprt-code-storage'` — assert `SESSION_FILE_PREFIX === 'session-'` and that `ConversationRecord` is accessible as a type from the barrel. This test was deferred from P04b because the barrel had not been updated yet. It MUST be added in P04d after the barrel export update.

### Verification

```bash
npm run test --workspace @vybestack/llxprt-code-storage -- packages/storage/src/conversation/ConversationFileWriter.test.ts packages/storage/src/session/sessionTypes.test.ts
npm run typecheck --workspace @vybestack/llxprt-code-storage
rg "debugLogger|DebugLogger|@vybestack/llxprt-code-core|\.\./utils/debugLogger" packages/storage/src/conversation packages/storage/src/session -g '*.ts' && exit 1 || true
# Verify no test writes to real ~/.llxprt
grep -rn 'homedir\(\).*\.llxprt\|os\.homedir' packages/storage/src/conversation/ConversationFileWriter.test.ts | grep -v 'vi.mock\|mockReturnValue\|mockImplementation' && echo "WARNING: test may write to real home dir" || true
# Verify resetConversationFileWriterForTesting is NOT in barrel
rg "resetConversationFileWriterForTesting" packages/storage/src/index.ts && exit 1 || echo "OK: not in barrel"
# Verify testing.ts exists and exports it
grep -q "resetConversationFileWriterForTesting" packages/storage/src/testing.ts
# Verify barrel exports session types and ConversationFileWriter (explicit P04d task)
grep -q "sessionTypes" packages/storage/src/index.ts || { echo "BARREL INCOMPLETE: missing sessionTypes export"; exit 1; }
grep -q "ConversationFileWriter" packages/storage/src/index.ts || { echo "BARREL INCOMPLETE: missing ConversationFileWriter export"; exit 1; }
```

### P04d Completion Marker

Create `project-plans/issue1590/.completed/P04d.md` with GREEN output.

### P04d-V Verifier

The verifier MUST confirm:
1. CFW tests pass.
2. `npm run typecheck --workspace @vybestack/llxprt-code-storage` passes.
3. No core debug dependency in storage CFW source.
4. No test writes to real `~/.llxprt`.
5. `resetConversationFileWriterForTesting` is NOT in barrel — only in `@vybestack/llxprt-code-storage/testing`.
6. `testing.ts` exists and exports `resetConversationFileWriterForTesting`.
7. Barrel (`src/index.ts`) exports session types and ConversationFileWriter (explicit P04d task verified).
8. Implementation matches pseudocode lines 20-22.

Write result to `.completed/P04d-V.md`.

---

## Overall Phase Verification Commands (P04 Verifier Sequence)

The P04 subphase verifiers (P04a-V, P04b-V, P04c-V, P04d-V) replace the previous single P04-V verifier. Each subphase verifier checks its own completion marker and runs its own verification commands. The overall phase is complete when all four subphase verifier markers exist:

```bash
# Verify all subphase and verifier markers exist
test -f project-plans/issue1590/.completed/P04a.md
test -f project-plans/issue1590/.completed/P04a-V.md
test -f project-plans/issue1590/.completed/P04b.md
test -f project-plans/issue1590/.completed/P04b-V.md
test -f project-plans/issue1590/.completed/P04c.md
test -f project-plans/issue1590/.completed/P04c-V.md
test -f project-plans/issue1590/.completed/P04d.md
test -f project-plans/issue1590/.completed/P04d-V.md
```

## Semantic Verification Checklist

- [ ] P04a stubs exist and typecheck with complete public API surface (constants, types, classes, functions). P04a-V confirmed.
- [ ] P04b RED output shows behavioral test failures against stubs (not import/type errors). P04b-V explicitly inspected and confirmed. Session type runtime assertions failed; compile-time type assertions may pass.
- [ ] P04c session types implementation passes all session type tests. P04c-V confirmed.
- [ ] P04d CFW implementation passes all conversation writer tests. P04d-V confirmed.
- [ ] P04d barrel export update completed: `src/index.ts` exports session types and `ConversationFileWriter`/`getConversationFileWriter`. Verified by P04d-V.
- [ ] P04d `testing.ts` populated with `resetConversationFileWriterForTesting` re-export. Verified by P04d-V.
- [ ] Session type exports preserve the same names.
- [ ] Conversation writer test reads actual JSONL output from disk and asserts field values — no mock-theater.
- [ ] Error logging test uses a real `StorageLogger` that records to an observable array, NOT `vi.fn()` mock call assertions.
- [ ] `SessionPersistenceService` remains in core.
- [ ] ConversationFileWriter tests cover zero-arg, one-arg, and logger-injection construction.
- [ ] No ConversationFileWriter test writes to real `~/.llxprt` — all use temp directories or mocked `os.homedir`.
- [ ] `resetConversationFileWriterForTesting` is NOT in the barrel — it is exported only from `@vybestack/llxprt-code-storage/testing` (Tier 3 test-only deep export).
- [ ] Core compatibility shims do NOT re-export `resetConversationFileWriterForTesting`.
- [ ] Verifiers compared implementation to pseudocode lines 19-23.

## Success Criteria

- All subphase completion markers exist.
- RED output captured and verified.
- Session/conversation storage tests pass in storage package.
- Public API exports are complete (barrel + testing deep export).
- No core import exists in moved files.
- P04d-V verifier returns PASS before P05.

## Failure Recovery

Fix moved session/conversation code/tests before adding core shims.

## Phase Completion Marker

The phase is complete when all four subphase markers and all four subphase verifier markers exist (P04a.md, P04a-V.md, P04b.md, P04b-V.md, P04c.md, P04c-V.md, P04d.md, P04d-V.md).
