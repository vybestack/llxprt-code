# Phase 08: Diagnostics Formatting Implementation

## Phase ID
`PLAN-20250212-LSP.P08`

## Prerequisites
- Required: Phase 07a completed
- Verification: `grep -r "@plan:PLAN-20250212-LSP.P07" packages/lsp/test/diagnostics.test.ts`
- Expected: Unit tests and integration tests exist, all failing on stubs
- Preflight verification: Phase 00a completed

## Requirements Implemented (Expanded)

### REQ-FMT-010: Diagnostic Line Format
**Full Text**: The system shall format each diagnostic line as: `SEVERITY [line:col] message (code)`.
**Behavior**:
- GIVEN: Diagnostic { severity: 'error', line: 42, character: 5, message: 'Type mismatch', code: 'ts2322' }
- WHEN: formatDiagnosticLine() is called
- THEN: Returns "ERROR [42:5] Type mismatch (ts2322)"
**Why This Matters**: Consistent, parseable format the LLM can reliably interpret.

### REQ-FMT-020: XML Tag Wrapping
**Full Text**: The system shall wrap each file's diagnostics in a `<diagnostics file="relpath">` XML-like tag, where the file path is relative to the workspace root.
**Behavior**:
- GIVEN: File "src/utils.ts" with formatted diagnostic lines
- WHEN: formatSingleFileDiagnostics() is called
- THEN: Output starts with `<diagnostics file="src/utils.ts">` and ends with `</diagnostics>`

### REQ-FMT-030: Line Ordering
**Full Text**: The system shall order diagnostics within a file by line number ascending.
**Behavior**:
- GIVEN: Diagnostics at lines [42, 10, 25]
- WHEN: formatted
- THEN: Output shows line 10 first, then 25, then 42

### REQ-FMT-040: XML Escaping
**Full Text**: The system shall escape `<`, `>`, and `&` characters in diagnostic message text to `&lt;`, `&gt;`, and `&amp;`.

### REQ-FMT-050/055: Per-File Cap with Overflow
**Full Text**: Cap at 20 per file (configurable). Show overflow count.

### REQ-FMT-060/065/066/067: Severity Filtering
**Full Text**: Error-only by default. Configurable. Consistent across all outputs.

### REQ-FMT-068: Cap Ordering — SINGLE PURE FUNCTION MANDATE
**Full Text**: Severity filter → per-file cap → total line cap. Overflow suffix does not count toward total.

**CRITICAL**: The entire cap ordering pipeline MUST be implemented as a single pure function in `formatMultiFileDiagnostics()`. The write tool (P32) and edit tool (P31) MUST call this shared function — they MUST NOT reimplement any cap/filter logic inline. This prevents divergent behavior between tools. The function signature should accept all config values (includeSeverities, maxDiagnosticsPerFile, maxProjectDiagnosticsFiles, maxTotalLines) so callers need only pass raw diagnostics and config.

### REQ-FMT-070: Deduplication
**Full Text**: Deduplicate diagnostics sharing file, range, and message.

### REQ-FMT-080: 0→1 Based Conversion
**Full Text**: Convert LSP 0-based positions to 1-based for display.

### REQ-FMT-090: Deterministic File Ordering
**Full Text**: Edited file first, then others alphabetically.

## Implementation Tasks

### Files to Modify

- `packages/lsp/src/service/diagnostics.ts`
  - MODIFY: Replace stubs with full implementations
  - MUST include: `@plan:PLAN-20250212-LSP.P08`
  - MUST include: `@requirement:REQ-FMT-010` through `REQ-FMT-090`
  - MUST follow pseudocode `diagnostics.md` line-by-line:
    - Lines 01-06: escapeXml — string replacement for <, >, &
    - Lines 08-19: mapSeverity — LSP numeric to string mapping
    - Lines 21-41: normalizeLspDiagnostic — 0→1 conversion, field extraction
    - Lines 43-59: deduplicateDiagnostics — Map-based deduplication
    - Lines 61-70: filterBySeverity — Array filter by severity set
    - Lines 72-78: formatDiagnosticLine — String template
    - Lines 80-100: formatSingleFileDiagnostics — Sort, cap, wrap in XML tags
    - Lines 102-140: formatMultiFileDiagnostics — Multi-file with all caps and ordering

### Files NOT to Modify

- `packages/lsp/test/diagnostics.test.ts` — DO NOT MODIFY
- `packages/lsp/test/diagnostics-integration.test.ts` — DO NOT MODIFY

### Required Code Markers

```typescript
/**
 * @plan PLAN-20250212-LSP.P08
 * @requirement REQ-FMT-010
 * @pseudocode diagnostics.md lines 72-78
 */
export function formatDiagnosticLine(diagnostic: Diagnostic): string {
  // Implementation following pseudocode
}
```

## Verification Commands

### Automated Checks

```bash
# All unit tests pass
cd packages/lsp && bunx vitest run test/diagnostics.test.ts
# Expected: All pass

# All integration tests pass
cd packages/lsp && bunx vitest run test/diagnostics-integration.test.ts
# Expected: All pass

# Plan markers
grep -r "@plan:PLAN-20250212-LSP.P08" packages/lsp/src/service/diagnostics.ts | wc -l
# Expected: 1+

# No test modifications
git diff packages/lsp/test/ | grep -E "^[+-]" | grep -v "^[+-]{3}" && echo "FAIL: Tests modified" || echo "PASS"

# Pseudocode compliance
grep -c "@pseudocode" packages/lsp/src/service/diagnostics.ts
# Expected: 8+ (one per function)

# TypeScript compiles
cd packages/lsp && bunx tsc --noEmit
```

### Deferred Implementation Detection (MANDATORY)

```bash
grep -rn -E "(TODO|FIXME|HACK|STUB|XXX|TEMPORARY|TEMP|WIP)" packages/lsp/src/service/diagnostics.ts
# Expected: No matches

grep -rn -E "(in a real|in production|ideally|for now|placeholder|not yet|will be|should be)" packages/lsp/src/service/diagnostics.ts
# Expected: No matches

grep -rn -E "return \[\]|return \{\}|return ''|return undefined" packages/lsp/src/service/diagnostics.ts
# Expected: No matches (all functions return real values)
```

```

### Semantic Verification Checklist (MANDATORY)

#### Holistic Functionality Assessment

##### What was implemented?
[Describe each function's implementation in your own words]

##### Does it satisfy the requirements?
For each REQ-FMT-*:
- [ ] REQ-FMT-010: formatDiagnosticLine produces correct format — cite code location
- [ ] REQ-FMT-020: XML tags wrap file diagnostics — cite code location
- [ ] REQ-FMT-030: Diagnostics sorted by line number — cite sort code
- [ ] REQ-FMT-040: XML chars escaped — cite escapeXml implementation
- [ ] REQ-FMT-050: Per-file cap enforced — cite slice/cap code
- [ ] REQ-FMT-055: Overflow count shown — cite suffix code
- [ ] REQ-FMT-060: Default error-only filter — cite default severities
- [ ] REQ-FMT-068: Cap ordering correct — cite ordering in formatMultiFile
- [ ] REQ-FMT-070: Deduplication works — cite dedup key generation
- [ ] REQ-FMT-080: 0→1 conversion — cite +1 in normalization
- [ ] REQ-FMT-090: Deterministic file ordering — cite sort comparator

##### Data flow trace
[Trace one complete path: raw LSP diagnostic → escapeXml → mapSeverity → normalize → filter → dedup → format → output string]

##### Verdict
[PASS/FAIL with explanation]

#### Feature Actually Works

```bash
cd packages/lsp && bunx vitest run test/diagnostics.test.ts test/diagnostics-integration.test.ts
# Expected: All tests pass — formatting pipeline produces correct output end-to-end
```

#### Integration Points Verified
- [ ] diagnostics.ts functions are called by rpc-channel.ts and edit/write tool integration
- [ ] normalizeLspDiagnostic accepts raw LSP notification data
- [ ] formatSingleFileDiagnostics output matches edit tool's expected diagnostic format
- [ ] formatMultiFileDiagnostics output matches write tool's expected diagnostic format

#### Lifecycle Verified
- [ ] All functions are pure (no state, no side effects)
- [ ] No async operations
- [ ] No resource cleanup needed

#### Edge Cases Verified
- [ ] Empty diagnostics array → empty output
- [ ] Diagnostics with `<`, `>`, `&` in message → properly escaped
- [ ] 0-based line 0, col 0 → displayed as 1:1
- [ ] Exactly 20 diagnostics → no overflow suffix
- [ ] 21 diagnostics → overflow suffix "... and 1 more"
- [ ] Duplicate diagnostics from two servers → deduplicated to one
- [ ] Multi-file with 50+ total lines → capped at 50

## Success Criteria
- All unit and integration tests pass
- No test files modified
- Pseudocode references in all functions
- No deferred implementation patterns
- All REQ-FMT-* requirements satisfied

## Failure Recovery
1. `git checkout -- packages/lsp/src/service/diagnostics.ts`
2. Do NOT revert tests
3. Re-run Phase 08

## Phase Completion Marker
Create: `project-plans/issue438/.completed/P08.md`
