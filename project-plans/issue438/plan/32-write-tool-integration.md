# Phase 32: Write Tool Integration

## Phase ID
`PLAN-20250212-LSP.P32`

## Prerequisites
- Required: Phase 31a completed
- Verification: `grep -r "@plan:PLAN-20250212-LSP.P31" packages/core/src/tools/edit.ts`
- Expected: Edit tool LSP integration complete
- Preflight verification: Phase 00a completed

## Requirements Implemented (Expanded)

### REQ-DIAG-040: Multi-File Diagnostics After Write
**Full Text**: When the LLM uses the write-file tool to write a file and an LSP server is available for that file's language, the system shall append error-level diagnostics for the written file and for other affected files to the tool's `llmContent` response.
**Behavior**:
- GIVEN: write-file tool writes `src/types.ts`, which is imported by `src/utils.ts` and `src/index.ts`
- WHEN: write completes and LSP service reports errors in all three files
- THEN: `llmContent` contains diagnostics for `src/types.ts` (this file) PLUS `src/utils.ts` and `src/index.ts` (other files)
**Why This Matters**: Write operations often break downstream importers. Multi-file diagnostics tell the LLM about cascading errors immediately.

### REQ-DIAG-045: Known Files Set for Other Files
**Full Text**: When the write-file tool includes diagnostics for other affected files, the system shall select those files from the known-files set (files with non-empty current diagnostics from `publishDiagnostics` notifications).
**Behavior**:
- GIVEN: LSP servers track files A, B, C with non-empty diagnostics
- WHEN: getAllDiagnostics() is called
- THEN: Returns diagnostics for A, B, C (the known-files set)

**[RESEARCH — Bug 2: Diagnostic freshness approach]**: The write tool's multi-file diagnostic flow uses an epoch-based freshness mechanism:
1. Capture `epoch = await lspClient.getDiagnosticEpoch()` BEFORE calling `checkFile()` (ASYNC RPC call — no local epoch mirror, server-authoritative)
2. Call `checkFile(filePath, text)` which returns `Diagnostic[]` and the orchestrator increments its epoch
3. Call `getAllDiagnosticsAfter(epoch)` which waits for the orchestrator epoch to advance past the captured value before snapshotting

This ensures cross-file invalidation (e.g., writing `types.ts` breaks `utils.ts`) has had time to propagate before the global snapshot is taken. The `checkFile()` return type remains a simple `Diagnostic[]` — the freshness tracking is a separate mechanism via the epoch counter. The write tool SHOULD use `getAllDiagnosticsAfter()` to capture cascading errors, with a short propagation wait (default 250ms).

### REQ-DIAG-050: Written File First, Others Second
**Full Text**: When the write-file tool produces multi-file diagnostics, the system shall display the written file's diagnostics first, labelled "LSP errors detected in this file," followed by other files' diagnostics, labelled "LSP errors detected in other files."
**Behavior**:
- GIVEN: Written file has errors, other files have errors
- WHEN: Diagnostics are appended
- THEN: Written file section headed "LSP errors detected in this file, please fix:", others headed "LSP errors detected in other files:"

### REQ-DIAG-060: Max Other Files Cap
**Full Text**: When the write-file tool produces multi-file diagnostics, the system shall cap other-file diagnostics at a maximum of 5 files (configurable via `maxProjectDiagnosticsFiles`).
**Behavior**:
- GIVEN: 10 other files with errors, maxProjectDiagnosticsFiles=5
- WHEN: Diagnostics are appended
- THEN: Only 5 other files included

### REQ-DIAG-070: Total Line Cap
**Full Text**: When the write-file tool produces multi-file diagnostics, the system shall cap total diagnostic lines across all files at 50, stopping the inclusion of further files once the cap is reached.
**Behavior**:
- GIVEN: 3 files with 20 errors each (60 total), maxTotalLines=50
- WHEN: Diagnostics formatted
- THEN: First file: 20 lines, second file: 20 lines, third file: 10 lines (capped at 50)

### REQ-FMT-068: Cap Ordering — USE SHARED FUNCTION, DO NOT DUPLICATE
**Full Text**: The system shall apply caps in order: severity filtering first, then per-file cap, then total multi-file line cap. Overflow suffix lines shall not count toward the total cap.

**CRITICAL**: The write tool MUST call the shared `formatMultiFileDiagnostics()` function from `packages/lsp/src/service/diagnostics.ts` (or its core-package equivalent) to apply severity filtering, per-file caps, and total line caps. It MUST NOT reimplement cap logic inline. The write tool passes raw diagnostics + config to the formatter; the formatter handles all ordering and capping. This ensures REQ-FMT-067 (consistency across mutation tools, checkFile, and diagnostics) is satisfied automatically.

### REQ-FMT-090: Deterministic File Ordering
**Full Text**: The system shall order files deterministically: the written file first, then other files sorted alphabetically by path.

### REQ-GRACE-050: LSP Failure Never Fails Write
**Full Text**: Wrap every LSP call in try/catch. LSP failure never causes write failure.

### REQ-GRACE-055: No Error Text on Failure
**Full Text**: Return normal success response with no LSP error text on failure.

### REQ-KNOWN-010: Known Files Set
**Full Text**: Known files are those with non-empty diagnostics from publishDiagnostics.

## Implementation Tasks

### Files to Modify

- `packages/core/src/tools/write-file.ts`
  - MODIFY: Add diagnostic integration after file write succeeds
  - MUST include: `@plan:PLAN-20250212-LSP.P32`
  - MUST include: `@requirement:REQ-DIAG-040`, `@requirement:REQ-DIAG-070`, `@requirement:REQ-GRACE-050`
  - MUST follow pseudocode `write-integration.md` line-by-line:
    - Lines 12-13: Get lspClient from config, check isAlive()
    - Lines 14-15: Try: const epoch = await lspClient.getDiagnosticEpoch(), then checkFile(filePath, text) → Diagnostic[]
    - Lines 16-19: getAllDiagnosticsAfter(epoch) to get all known-file diagnostics with freshness guarantee
    - Lines 21-25: Extract config values (includeSeverities, maxPerFile, maxOtherFiles, maxTotalLines)
    - Lines 27-80: Call `formatMultiFileDiagnostics()` from the diagnostics module (implemented in P08). Do NOT reimplement cap ordering inline. Pass writtenFile path, allDiagnostics map, and config to the shared function — it handles severity filtering, per-file caps, total line caps, overflow suffixes, file ordering (written file first, others alphabetical), and "in this file" / "in other files" section labeling (REQ-FMT-068, REQ-FMT-090, REQ-DIAG-050, REQ-DIAG-060)
    - Lines 82-84: Catch: silently continue (REQ-GRACE-050/055)
  - LOCATION: After llmSuccessMessageParts construction, before ToolResult creation
  - DO NOT modify existing success message construction
  - DO NOT modify any other part of write-file.ts

### Files to Create

- `packages/core/src/tools/__tests__/write-file-lsp-integration.test.ts`
  - MUST include: `@plan:PLAN-20250212-LSP.P32`
  - Tests (15+):
    1. Write succeeds without LSP (lspClient undefined) — no diagnostics
    2. Write succeeds with dead LSP — no diagnostics
    3. Write with live LSP, written file has errors → "in this file" section
    4. Write with live LSP, no errors → no diagnostics
    5. Multi-file: written file + other files → both sections present
    6. Written file diagnostics appear BEFORE other files (REQ-DIAG-050)
    7. Other files sorted alphabetically (REQ-FMT-090)
    8. Other files capped at maxProjectDiagnosticsFiles (default 5) (REQ-DIAG-060)
    9. Total lines capped at 50 (REQ-DIAG-070)
    10. Per-file cap applied (maxDiagnosticsPerFile)
    11. Overflow suffix shown, does NOT count toward total cap (REQ-FMT-068)
    12. Severity filtering: error-only by default
    13. Severity filtering: configurable includeSeverities
    14. LSP error caught silently — write succeeds
    15. Written file label: "LSP errors detected in this file, please fix:"
    16. Other file label: "LSP errors detected in other files:"
    17. Anti-fake freshness epoch: GIVEN file A imports file B, WHEN write-file writes B with a type change, THEN getAllDiagnosticsAfter(epoch) returns diagnostics for BOTH file A and file B — not just B. The epoch ensures cross-file propagation is captured. A naive implementation that returns stale diagnostics from before the checkFile call would miss file A's errors.
    18. [HIGH #11] GIVEN abort signal fires during diagnostic collection, WHEN write-tool awaits diagnostics, THEN write succeeds with partial or no diagnostics (no error thrown)
    19. [HIGH #11] GIVEN diagnostic timeout expires, WHEN write-tool calls getAllDiagnosticsAfter, THEN returns best-effort snapshot (not empty if diagnostics were already available)

### Required Code Markers

```typescript
/**
 * @plan PLAN-20250212-LSP.P32
 * @requirement REQ-DIAG-040
 * @requirement REQ-DIAG-070
 * @requirement REQ-GRACE-050
 * @pseudocode write-integration.md lines 12-84
 */
```

## Verification Commands

### Automated Checks

```bash
# Write LSP integration tests pass
npx vitest run packages/core/src/tools/__tests__/write-file-lsp-integration.test.ts
# Expected: All pass

# Plan markers
grep -r "@plan:PLAN-20250212-LSP.P32" packages/core/src/tools/write-file.ts | wc -l
# Expected: 1+

# Existing write tests still pass
npx vitest run packages/core/src/tools/__tests__/write-file.test.ts
# Expected: All pass (no regression)

# Deferred implementation detection
grep -rn -E "(TODO|FIXME|HACK|STUB|XXX)" packages/core/src/tools/write-file.ts | grep -i "lsp\|diagnostic"
# Expected: No matches

# TypeScript compiles
cd packages/core && npx tsc --noEmit
```

### Deferred Implementation Detection (MANDATORY)

```bash
grep -rn -E "(TODO|FIXME|HACK|STUB|XXX|TEMPORARY)" packages/core/src/tools/write-file.ts
# Expected: No new matches

grep -rn -E "(in a real|in production|ideally|for now|placeholder)" packages/core/src/tools/write-file.ts
# Expected: No new matches

grep -rn -E "return \[\]|return \{\}|return null|return undefined" packages/core/src/tools/write-file.ts | grep -i "lsp\|diag\|check"
# Expected: No matches in the LSP integration code path (catch blocks returning empty for graceful degradation are OK per REQ-GRACE-050)
```

### Semantic Verification Checklist (MANDATORY)

#### Holistic Functionality Assessment

##### What was implemented?
[Describe: After write success, call checkFile + getAllDiagnostics, format multi-file diagnostics with caps and ordering, append to llmContent]

##### Does it satisfy the requirements?
- [ ] REQ-DIAG-040: Multi-file diagnostics from getAllDiagnostics — cite the call
- [ ] REQ-DIAG-045: Known files from getAllDiagnostics (publishDiagnostics-based) — cite the response usage
- [ ] REQ-DIAG-050: Written file labeled "in this file", others "in other files" — cite label strings
- [ ] REQ-DIAG-060: Other files capped at maxProjectDiagnosticsFiles — cite otherFileCount check
- [ ] REQ-DIAG-070: Total lines capped at 50 — cite totalDiagnosticLines check
- [ ] REQ-FMT-068: Caps applied in order: severity → per-file → total, overflow suffix excluded — cite ordering
- [ ] REQ-FMT-090: Written file first, others alphabetical — cite sort comparator
- [ ] REQ-GRACE-050: try/catch wraps all LSP code — cite catch block
- [ ] REQ-GRACE-055: Silent failure — cite empty catch block

##### Verdict
[PASS/FAIL with explanation]

#### Feature Actually Works

```bash
npx vitest run packages/core/src/tools/__tests__/write-file-lsp-integration.test.ts
# Expected: All tests pass — multi-file diagnostics with caps, ordering, graceful degradation
```

#### Integration Points Verified
- [ ] write-file.ts calls config.getLspServiceClient() — verified by reading both files
- [ ] checkFile(filePath) called first, then getAllDiagnostics() — verified by reading sequence
- [ ] Diagnostics appended to llmSuccessMessageParts — verified by checking array usage
- [ ] try/catch wraps all LSP code — verified by reading catch block

#### Lifecycle Verified
- [ ] File write BEFORE diagnostics (REQ-DIAG-020)
- [ ] Async calls properly awaited (no fire-and-forget)

#### Edge Cases Verified
- [ ] No LSP client → no diagnostics appended
- [ ] LSP dead → graceful skip
- [ ] Written file has errors, no other files affected → only "in this file" section
- [ ] 6+ other files with errors → capped at 5
- [ ] 50+ total diagnostic lines → capped at 50
- [ ] Overflow suffix lines don't count toward 50 cap
- [ ] [HIGH #11] Abort signal during diagnostic collection → write succeeds with partial/no diagnostics
- [ ] [HIGH #11] Diagnostic timeout → getAllDiagnosticsAfter returns best-effort snapshot

## Success Criteria
- Write tool appends multi-file diagnostics with proper caps and ordering
- Existing write tests still pass
- LSP failure never fails the write
- 15+ integration tests pass

## Failure Recovery
1. `git checkout -- packages/core/src/tools/write-file.ts`
2. `git checkout -- packages/core/src/tools/__tests__/write-file-lsp-integration.test.ts`
3. Re-run Phase 32

## Phase Completion Marker
Create: `project-plans/issue438/.completed/P32.md`
