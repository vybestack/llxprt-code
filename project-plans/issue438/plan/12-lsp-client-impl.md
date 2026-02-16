# Phase 12: LSP Client Implementation

## Phase ID
`PLAN-20250212-LSP.P12`

## Prerequisites
- Required: Phase 11a completed
- Verification: `grep -r "@plan:PLAN-20250212-LSP.P11" packages/lsp/test/lsp-client.test.ts`
- Expected: Integration tests (Phase 10) and unit tests (Phase 11) exist, all failing on stubs

## Requirements Implemented (Expanded)

### REQ-LIFE-010: Lazy Startup
**Full Text**: When the first file of a given language is touched, the system shall start the appropriate LSP server(s) if not already running.

### REQ-TIME-050: Debounce
**Full Text**: The system shall apply a 150 ms debounce period to allow rapid successive diagnostic updates from the server to settle before returning results.

### REQ-TIME-030: First Touch Timeout
**Full Text**: The system shall use an extended first-touch timeout (default 10000 ms) to allow for server initialization.

### REQ-TIME-090: First Touch vs Normal Timeout
**Full Text**: While a language server is in first-touch initialization, when collecting diagnostics, the system shall apply firstTouchTimeout. Once completed, use diagnosticTimeout.

### REQ-TIME-080: Abort Signal
**Full Text**: When awaiting diagnostics, the system shall honour request cancellation or abort signals.

### REQ-TIME-070: Cold-Start Mutation Response Without Diagnostics
**Full Text**: While a language server is cold-starting, when a first-touch file mutation occurs, the system shall allow the mutation response to be returned without diagnostics if server initialization does not complete within the first-touch timeout.
**Behavior**:
- GIVEN: Language server is cold-starting (first-touch init in progress)
- WHEN: firstTouchTimeout expires before initialization completes
- THEN: waitForDiagnostics() resolves with empty array (no diagnostics, no error)
**Why This Matters**: Cold starts may take longer than the first-touch timeout; the edit must still succeed without diagnostics.

### REQ-LIFE-070: Crash Handling
**Full Text**: If an individual LSP server crashes, the system shall mark it as broken and not restart it.

### REQ-TIME-060: Best-Effort Snapshot
**Full Text**: When diagnostics are returned after a file mutation, the system shall treat them as a best-effort snapshot at the point the timeout expires or the server responds, whichever comes first. Partial or stale results are acceptable.
**Behavior**:
- GIVEN: Server responds with partial diagnostics (still computing)
- WHEN: Timeout expires
- THEN: Returns whatever diagnostics were available at that point
**Why This Matters**: Diagnostics don't need to be perfect — any feedback is better than none.

## Implementation Tasks

### Files to Modify

- `packages/lsp/src/service/lsp-client.ts`
  - MODIFY: Replace stubs with full implementation
  - MUST include: `@plan:PLAN-20250212-LSP.P12`
  - MUST follow pseudocode `lsp-client.md` line-by-line:
    - Lines 01-30: Constructor and state fields
    - Lines 32-60: initialize() — spawn process, LSP handshake
    - Lines 62-95: touchFile() — didOpen/didChange with version tracking
    - Lines 97-130: waitForDiagnostics() — debounce + timeout logic
    - Lines 132-155: Navigation methods (gotoDefinition, findReferences, hover, documentSymbols)
    - Lines 157-175: shutdown() — LSP shutdown/exit sequence
    - Lines 177-190: Crash detection — onExit handler marks broken
  - MUST NOT exceed 800 lines (REQ-PKG-030)

### Files NOT to Modify

- `packages/lsp/test/lsp-client.test.ts` — DO NOT MODIFY
- `packages/lsp/test/lsp-client-integration.test.ts` — DO NOT MODIFY

### Required Code Markers

```typescript
/**
 * @plan PLAN-20250212-LSP.P12
 * @requirement REQ-LIFE-010
 * @pseudocode lsp-client.md lines 32-60
 */
async initialize(): Promise<void> {
  // Implementation following pseudocode
}
```

## Verification Commands

```bash
# All tests pass
cd packages/lsp && bunx vitest run test/lsp-client.test.ts test/lsp-client-integration.test.ts

# No test modifications
git diff packages/lsp/test/lsp-client*.ts | grep -E "^[+-]" | grep -v "^[+-]{3}" && echo "FAIL" || echo "PASS"

# Deferred implementation detection
grep -rn -E "(TODO|FIXME|HACK|STUB|return \[\]|return \{\})" packages/lsp/src/service/lsp-client.ts | grep -v "// broken server" | grep -v "// no diagnostics"
# Expected: No matches

# Pseudocode compliance
grep -c "@pseudocode" packages/lsp/src/service/lsp-client.ts
# Expected: 5+

# Under 800 lines
LINES=$(wc -l < packages/lsp/src/service/lsp-client.ts)
[ "$LINES" -le 800 ] && echo "PASS" || echo "FAIL"

# TypeScript compiles
cd packages/lsp && bunx tsc --noEmit

# Lint passes
cd packages/lsp && bunx eslint src/service/lsp-client.ts
```

### Deferred Implementation Detection (MANDATORY)

```bash
grep -rn -E "(TODO|FIXME|HACK|STUB|XXX|TEMPORARY|TEMP|WIP)" packages/lsp/src/service/lsp-client.ts
# Expected: No matches

grep -rn -E "(in a real|in production|ideally|for now|placeholder|not yet|will be|should be)" packages/lsp/src/service/lsp-client.ts
# Expected: No matches

grep -rn -E "return \[\]|return \{\}|return null|return undefined" packages/lsp/src/service/lsp-client.ts
# Expected: No matches except in guard clauses (broken state → return [])
```

### Semantic Verification Checklist (MANDATORY)

#### Holistic Functionality Assessment

##### What was implemented?
[Describe LspClient: process spawning, LSP handshake, file tracking, debounce, crash detection]

##### Does it satisfy the requirements?
- [ ] REQ-LIFE-010: Server starts on initialize() — cite spawn code
- [ ] REQ-TIME-050: 150ms debounce on diagnostics — cite debounce timer code
- [ ] REQ-TIME-030: First touch extended timeout — cite isFirstTouch check
- [ ] REQ-TIME-090: Switches from firstTouchTimeout to diagnosticTimeout — cite flag
- [ ] REQ-TIME-070: Cold-start timeout → empty result, no error — cite timeout resolution path
- [ ] REQ-TIME-080: Abort signal honored — cite AbortSignal usage
- [ ] REQ-LIFE-070: Crash marks broken — cite onExit handler

##### Verdict
[PASS/FAIL]

#### Feature Actually Works

```bash
cd packages/lsp && bunx vitest run test/lsp-client-integration.test.ts
# Expected: All tests pass — initialize handshake, touchFile, crash handling
```

#### Integration Points Verified
- [ ] LspClient spawns server process via Bun.spawn — verified by reading spawn call
- [ ] LspClient sends initialize/initialized handshake — verified by protocol trace
- [ ] touchFile sends didOpen/didChange — verified by test
- [ ] publishDiagnostics listener updates diagnostic map — verified by reading listener
- [ ] Crash handler fires onCrash callback — verified by test

#### Lifecycle Verified
- [ ] Constructor does NOT spawn process (lazy, per REQ-LIFE-010)
- [ ] initialize() spawns process and performs handshake
- [ ] Subprocess exit event handler sets alive=false, marks broken
- [ ] shutdown() sends LSP shutdown → exit → kills process
- [ ] No orphaned processes after shutdown
- [ ] File version tracking incremented correctly on re-touch

#### Edge Cases Verified
- [ ] Server binary not found → meaningful error
- [ ] Server crashes during init → broken state
- [ ] Rapid consecutive touchFile calls → debounce settles
- [ ] Timeout expires → returns empty, no error
- [ ] Cold-start uses firstTouchTimeout (REQ-TIME-090)

## Success Criteria
- All unit and integration tests pass
- No test files modified
- Pseudocode references in implementation (lsp-client.md lines 01-218)
- No deferred implementation patterns
- All REQ-LIFE-*, REQ-TIME-* requirements satisfied
- Bun.spawn used for process management

## Failure Recovery
1. `git checkout -- packages/lsp/src/service/lsp-client.ts`
2. Re-run Phase 12

## Phase Completion Marker
Create: `project-plans/issue438/.completed/P12.md`
