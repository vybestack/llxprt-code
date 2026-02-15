# Phase 06: Diagnostics Formatting Integration TDD

## Phase ID
`PLAN-20250212-LSP.P06`

## Prerequisites
- Required: Phase 05a completed
- Verification: `grep -r "@plan:PLAN-20250212-LSP.P05" packages/lsp/src/service/diagnostics.ts`
- Expected files: `packages/lsp/src/service/diagnostics.ts` (stub with 8 exported functions)
- Preflight verification: Phase 00a completed

## Requirements Implemented (Expanded)

Integration tests verify the diagnostics module works end-to-end: raw LSP diagnostic input → formatted output string. These tests are written FIRST (vertical slice) to define the contract before unit tests detail edge cases.

### REQ-FMT-010: Line Format
**Full Text**: The system shall format each diagnostic line as: `SEVERITY [line:col] message (code)`.
**Behavior**:
- GIVEN: A Diagnostic with severity='error', line=42, character=5, message='Type error', code='ts2322'
- WHEN: formatDiagnosticLine() is called
- THEN: Returns `ERROR [42:5] Type error (ts2322)`

### REQ-FMT-020: XML Tag Wrapping
**Full Text**: The system shall wrap each file's diagnostics in a `<diagnostics file="relpath">` XML-like tag.
**Behavior**:
- GIVEN: File "src/utils.ts" with diagnostics
- WHEN: formatSingleFileDiagnostics() is called
- THEN: Output wraps in `<diagnostics file="src/utils.ts">...</diagnostics>`

### REQ-FMT-040: XML Escaping
**Full Text**: The system shall escape `<`, `>`, and `&` characters in diagnostic message text.
**Behavior**:
- GIVEN: Diagnostic with message `Type '<string>' is not assignable to type 'A & B'`
- WHEN: escapeXml() is called
- THEN: Returns `Type '&lt;string&gt;' is not assignable to type 'A &amp; B'`

### REQ-FMT-050: Per-File Cap
**Full Text**: The system shall cap displayed diagnostics at a maximum of 20 error-level diagnostics per file.
**Behavior**:
- GIVEN: 25 error diagnostics for a single file, maxDiagnosticsPerFile=20
- WHEN: formatSingleFileDiagnostics() is called
- THEN: Shows 20 diagnostics + "... and 5 more"

### REQ-FMT-065: Configurable includeSeverities
**Full Text**: Where `includeSeverities` is configured, the system shall include exactly the configured severity levels in diagnostic output, replacing the default error-only filter.
**Behavior**:
- GIVEN: 10 errors + 5 warnings, includeSeverities=['error','warning']
- WHEN: filterBySeverity is applied
- THEN: All 15 diagnostics pass the filter

### REQ-FMT-066: maxDiagnosticsPerFile After Severity Filter
**Full Text**: Where `includeSeverities` is configured, the system shall apply `maxDiagnosticsPerFile` to the total displayed diagnostics after severity filtering.
**Behavior**:
- GIVEN: 25 errors + 10 warnings (35 total), includeSeverities=['error','warning'], maxPerFile=20
- WHEN: Formatted
- THEN: severity filter keeps all 35, then per-file cap → 20 shown + "... and 15 more"

### REQ-FMT-067: Consistent Severity Filter Across All Outputs
**Full Text**: Where `includeSeverities` is configured, the system shall apply the configured severity filter consistently across mutation-tool diagnostic output, `lsp/checkFile` responses, and `lsp/diagnostics` responses.
**Behavior**:
- GIVEN: includeSeverities=['error','warning']
- WHEN: The same diagnostics are formatted in edit tool, write tool, and `lsp_diagnostics` tool
- THEN: All three outputs apply the same severity filter

### REQ-FMT-068: Cap Ordering
**Full Text**: When applying severity filters and diagnostic limits, the system shall apply them in the following order: severity filtering first, then per-file cap (`maxDiagnosticsPerFile`), then total multi-file line cap. Overflow suffix lines (e.g., `... and N more`) shall not count toward the total multi-file line cap.
**Behavior**:
- GIVEN: 30 diagnostics (20 error + 10 warning), includeSeverities=['error'], maxPerFile=20
- WHEN: formatted
- THEN: Warnings filtered first (30→20), then per-file cap applied (20→20, no change)
- GIVEN: maxTotalLines=50, file1 has 25 errors capped at 20 + overflow suffix, file2 has 30 errors
- WHEN: multi-file formatted
- THEN: file1: 20 lines + suffix (suffix NOT counted), file2: 30 lines capped at remaining budget

### REQ-DIAG-070: Total Line Cap
**Full Text**: The system shall cap total diagnostic lines across all files at 50.
**Behavior**:
- GIVEN: 3 files with 20 errors each (60 total), maxTotalLines=50
- WHEN: formatMultiFileDiagnostics() is called
- THEN: First file gets 20, second file gets 20, third file gets 10

## Implementation Tasks

### Files to Create

- `packages/lsp/test/diagnostics-integration.test.ts`
  - MUST include: `@plan:PLAN-20250212-LSP.P06`
  - Integration tests that exercise the FULL pipeline:
    1. normalizeLspDiagnostic → filterBySeverity → deduplicateDiagnostics → formatSingleFileDiagnostics
    2. normalizeLspDiagnostic → filterBySeverity → deduplicateDiagnostics → formatMultiFileDiagnostics
  - Tests cover: REQ-FMT-010/020/030/040/050/055/060/065/066/067/068/070/080/090
  - 10+ integration tests
  - Tests FAIL naturally on stubs (return '' or [])
  - NO testing for NotYetImplemented

### Required Code Markers

```typescript
/**
 * @plan PLAN-20250212-LSP.P06
 * @requirement REQ-FMT-010
 * @scenario Full pipeline: raw LSP → formatted string
 * @given Raw LSP diagnostics from a language server
 * @when The full formatting pipeline is invoked
 * @then Correctly formatted string output matching specification
 */
```

## Verification Commands

### Automated Checks

```bash
# Integration test file exists
test -f packages/lsp/test/diagnostics-integration.test.ts && echo "PASS" || echo "FAIL"

# Plan markers
grep -r "@plan:PLAN-20250212-LSP.P06" packages/lsp/ | wc -l
# Expected: 1+

# No reverse testing
grep -rn "NotYetImplemented\|expect.*not\.toThrow" packages/lsp/test/diagnostics-integration.test.ts
# Expected: No output

# No mock theater
grep -rn "toHaveBeenCalled\|toHaveBeenCalledWith" packages/lsp/test/diagnostics-integration.test.ts
# Expected: No output

# Has behavioral assertions
grep -c "toBe\|toEqual\|toMatch\|toContain\|toStrictEqual" packages/lsp/test/diagnostics-integration.test.ts
# Expected: 10+

# Tests fail naturally (stubs return empty)
cd packages/lsp && bunx vitest run test/diagnostics-integration.test.ts 2>&1 | head -20
# Expected: Tests FAIL (not with NotYetImplemented, but with assertion failures)
```

### Deferred Implementation Detection (MANDATORY)

```bash
# TDD phase — tests should NOT contain deferred markers:
grep -rn -E "(TODO|FIXME|HACK|STUB|XXX|TEMPORARY)" packages/lsp/test/diagnostics-integration.test.ts
# Expected: No matches (tests must be complete, not placeholders)

# No cop-out test patterns:
grep -rn -E "(skip|xit|xdescribe|\.todo)" packages/lsp/test/diagnostics-integration.test.ts
# Expected: No skipped tests

# Check for empty/trivial implementations
grep -rn -E "return \[\]|return \{\}|return null|return undefined" packages/lsp/test/diagnostics-integration.test.ts | grep -v ".test.ts"
# Expected: For TDD phases, this grep targets the test file itself — empty returns in test helpers/fixtures
# are acceptable. The key concern is that test assertions are real, not trivially passing stubs.
```

### Semantic Verification Checklist (MANDATORY)

#### Behavioral Verification Questions
1. **Do tests verify INPUT → OUTPUT transformations?** — Real data in, expected string out
   - [ ] Each test has concrete input data and expected output assertions
2. **Would tests fail if implementation was removed?** — Yes, stubs return empty/throw
   - [ ] Verified: assertions check for non-empty, specific values
3. **Do tests cover all REQ-FMT-* requirements?** — Check each has a test
   - [ ] REQ-FMT-010, 020, 030, 040, 050, 055, 060, 065, 066, 067, 068, 070, 080, 090
4. **Are tests end-to-end through the formatting pipeline?** — Not testing individual functions in isolation
   - [ ] Tests exercise normalize → filter → dedupe → format chain
5. **What's MISSING?** (list gaps that need fixing before proceeding)
   - [ ] Full implementation is deferred to the impl phase (P07/P08) — tests are expected to FAIL on stubs by design
   - [ ] [List any unexpected gaps]

#### Feature Actually Works

```bash
# TDD phase — tests should FAIL naturally on stubs:
cd packages/lsp && bunx vitest run test/diagnostics-integration.test.ts 2>&1 | tail -5
# Expected: Tests FAIL with assertion errors (not NotYetImplemented)
```

#### Integration Points Verified
- [ ] Tests import functions from diagnostics.ts (verified by import statements)
- [ ] Tests use types from types.ts for input data (Diagnostic type, LspConfig type)
- [ ] Tests exercise the full pipeline, not individual function mocks
- [ ] Test data matches realistic LSP server output format

#### Lifecycle Verified
- [ ] No setup/teardown with external resources (these are pure function tests)
- [ ] No async operations that need cleanup

#### Edge Cases Verified
- [ ] Tests include empty array input
- [ ] Tests include XML special characters in messages
- [ ] Tests include boundary conditions (exactly maxDiagnosticsPerFile)
- [ ] Tests include multi-server deduplication scenarios

## Success Criteria
- 10+ integration tests exist
- Tests fail naturally on stubs (assertion failures, not NotYetImplemented)
- No reverse testing or mock theater
- All REQ-FMT-* requirements have at least one test
- Tests have behavioral BDD-style comments
- No skipped or placeholder tests

## Failure Recovery
1. `git checkout -- packages/lsp/test/diagnostics-integration.test.ts`
2. Re-run Phase 06

## Phase Completion Marker
Create: `project-plans/issue438/.completed/P06.md`
