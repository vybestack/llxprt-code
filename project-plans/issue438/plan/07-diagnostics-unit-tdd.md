# Phase 07: Diagnostics Formatting Unit TDD

## Phase ID
`PLAN-20250212-LSP.P07`

## Prerequisites
- Required: Phase 06a completed
- Verification: `grep -r "@plan:PLAN-20250212-LSP.P06" packages/lsp/test/diagnostics-integration.test.ts`
- Expected: Integration tests exist and fail naturally on stubs
- Preflight verification: Phase 00a completed

## Requirements Implemented (Expanded)

Unit tests for each individual formatting function. These complement the integration tests (Phase 06) by covering edge cases, boundary values, and error conditions that are impractical to test end-to-end.

### REQ-FMT-040: XML Escaping (Edge Cases)
**Full Text**: The system shall escape `<`, `>`, and `&` characters in diagnostic message text to `&lt;`, `&gt;`, and `&amp;`.
**Behavior (edge cases)**:
- GIVEN: Message with no special characters
- WHEN: escapeXml() is called
- THEN: Returns message unchanged
- GIVEN: Message with already-escaped entities (`&amp;`)
- WHEN: escapeXml() is called
- THEN: Double-escapes to `&amp;amp;` (no smartness — raw escaping)
- GIVEN: Empty string
- WHEN: escapeXml() is called
- THEN: Returns empty string

### REQ-FMT-080: 0→1 Based Conversion
**Full Text**: The system shall convert LSP 0-based line and character positions to 1-based for display.
**Behavior**:
- GIVEN: LSP diagnostic with line=0, character=0
- WHEN: normalizeLspDiagnostic() is called
- THEN: Returns Diagnostic with line=1, character=1

### REQ-FMT-070: Deduplication
**Full Text**: When multiple LSP servers produce diagnostics for the same file, the system shall deduplicate diagnostics that share the same file, range, and message.
**Behavior**:
- GIVEN: Two identical diagnostics from tsserver and eslint
- WHEN: deduplicateDiagnostics() is called
- THEN: Returns one diagnostic

## Implementation Tasks

### Files to Create

- `packages/lsp/test/diagnostics.test.ts`
  - MUST include: `@plan:PLAN-20250212-LSP.P07`
  - Unit tests for each function in diagnostics.ts:
    - escapeXml: 5+ tests (normal, special chars, empty, already-escaped, multiple occurrences)
    - mapSeverity: 5+ tests (each LSP severity value, unknown value)
    - normalizeLspDiagnostic: 5+ tests (0→1 conversion, missing code, source extraction)
    - deduplicateDiagnostics: 4+ tests (exact dupes, different messages, empty input)
    - filterBySeverity: 7+ tests (errors only, errors+warnings, all severities, empty filter, all filtered out, includeSeverities replaces default (REQ-FMT-065), maxDiagnosticsPerFile applied after filter (REQ-FMT-066))
    - formatDiagnosticLine: 4+ tests (with code, without code, escaped message)
    - formatSingleFileDiagnostics: 5+ tests (under cap, at cap, over cap, empty, ordering)
    - formatMultiFileDiagnostics: 5+ tests (single file, multi file, total cap, other-file cap, ordering)
  - 30%+ property-based tests:
    - escapeXml is idempotent on already-safe strings
    - normalizeLspDiagnostic always produces line >= 1
    - deduplicateDiagnostics output.length <= input.length
    - filterBySeverity output.length <= input.length
  - Total: 37+ unit tests, 12+ property-based tests

### Required Code Markers

```typescript
/**
 * @plan PLAN-20250212-LSP.P07
 * @requirement REQ-FMT-040
 * @scenario XML escaping edge cases
 * @given Diagnostic message with special XML characters
 * @when escapeXml is called
 * @then Characters are properly escaped
 */
```

## Verification Commands

### Automated Checks

```bash
# Test file exists
test -f packages/lsp/test/diagnostics.test.ts && echo "PASS" || echo "FAIL"

# Plan markers
grep -r "@plan:PLAN-20250212-LSP.P07" packages/lsp/ | wc -l
# Expected: 1+

# Test count (should be 37+)
TEST_COUNT=$(grep -c "it(\|test(" packages/lsp/test/diagnostics.test.ts)
echo "Unit test count: $TEST_COUNT"
[ "$TEST_COUNT" -ge 30 ] && echo "PASS" || echo "FAIL"

# Property-based test count
PROP_COUNT=$(grep -c "fc\.\|prop\[" packages/lsp/test/diagnostics.test.ts)
echo "Property tests: $PROP_COUNT"
RATIO=$((PROP_COUNT * 100 / TEST_COUNT))
echo "Property test ratio: ${RATIO}%"
[ "$RATIO" -ge 30 ] && echo "PASS" || echo "FAIL: need 30%"

# No reverse testing
grep -rn "NotYetImplemented" packages/lsp/test/diagnostics.test.ts && echo "FAIL" || echo "PASS"

# No mock theater
grep -rn "toHaveBeenCalled" packages/lsp/test/diagnostics.test.ts && echo "FAIL" || echo "PASS"

# Tests fail naturally
cd packages/lsp && bunx vitest run test/diagnostics.test.ts 2>&1 | tail -5
# Expected: FAIL with assertion errors
```

### Deferred Implementation Detection (MANDATORY)

```bash
# TDD phase — tests must not contain deferred markers:
grep -rn -E "(TODO|FIXME|HACK|STUB|XXX|TEMPORARY)" packages/lsp/test/diagnostics.test.ts
# Expected: No matches

# No skipped tests:
grep -rn -E "(skip|xit|xdescribe|\.todo)" packages/lsp/test/diagnostics.test.ts
# Expected: No matches
```

### Semantic Verification Checklist (MANDATORY)

#### Behavioral Verification Questions
1. **Do tests cover all 8 exported functions?** — Each function has dedicated test suite
   - [ ] escapeXml, mapSeverity, normalizeLspDiagnostic, deduplicateDiagnostics
   - [ ] filterBySeverity, formatDiagnosticLine, formatSingleFileDiagnostics, formatMultiFileDiagnostics
2. **Are edge cases covered?** — Empty inputs, boundary values, overflow conditions
   - [ ] Each function has at least 2 edge case tests
3. **Are property-based tests meaningful?** — They express invariants, not just "doesn't crash"
   - [ ] Invariants like: escaped output never contains raw `<`, `>`, `&`
4. **Would tests catch real bugs?** — e.g., off-by-one in 0→1 conversion, missed escaping
   - [ ] Tests assert specific output values, not just "is truthy"

#### Feature Actually Works

```bash
# TDD phase — tests should FAIL naturally on stubs:
cd packages/lsp && bunx vitest run test/diagnostics.test.ts 2>&1 | tail -5
# Expected: Tests FAIL with assertion errors (not NotYetImplemented)
```

#### Integration Points Verified
- [ ] Tests import all 8 functions from diagnostics.ts
- [ ] Test input data uses Diagnostic type from types.ts
- [ ] Property-based tests use fast-check generators matching type constraints

#### Lifecycle Verified
- [ ] No setup/teardown with external resources (pure function tests)
- [ ] No async operations requiring cleanup

#### Edge Cases Verified
- [ ] escapeXml: empty string, string with no special chars, all special chars
- [ ] mapSeverity: all 4 LSP severity levels, invalid severity numbers
- [ ] normalizeLspDiagnostic: 0-based line 0 → 1-based line 1, missing fields
- [ ] formatSingleFileDiagnostics: exactly at cap, one over cap, zero diagnostics
- [ ] formatMultiFileDiagnostics: total cap reached mid-file, overflow suffix counting

## Golden Test Fixtures (Concrete Input/Output)

### Fixture 1: 25 errors in one file (per-file cap)

**Input**: 25 diagnostics all severity 'error' for `src/big.ts`, maxDiagnosticsPerFile=20
**Expected `formatSingleFileDiagnostics` output**:
```
<diagnostics file="src/big.ts">
ERROR [1:1] Error message 1 (ts0001)
ERROR [2:1] Error message 2 (ts0002)
... (lines 3-20)
ERROR [20:1] Error message 20 (ts0020)
... and 5 more
</diagnostics>
```

### Fixture 2: Mixed severities with custom filter

**Input**: 5 errors, 3 warnings, 2 info diagnostics. includeSeverities=['error','warning'], maxDiagnosticsPerFile=20
**Expected `filterBySeverity` output**: 8 diagnostics (5 error + 3 warning). Info excluded.
**Expected `formatSingleFileDiagnostics` output** (all 8 fit within cap):
```
<diagnostics file="src/mixed.ts">
ERROR [1:1] Type mismatch (ts2322)
ERROR [5:3] Missing property (ts2741)
ERROR [10:1] Cannot find name (ts2304)
ERROR [15:7] Unused variable (ts6133)
ERROR [20:1] No overload matches (ts2769)
WARNING [3:1] Deprecated API (ts6385)
WARNING [8:5] Implicit any (ts7006)
WARNING [25:1] Unreachable code (ts7027)
</diagnostics>
```

### Fixture 3: XML escaping in messages

**Input**: Diagnostic with message `Type '<string>' is not assignable to type '&Record<K, V>'`
**Expected `escapeXml` output**: `Type '&lt;string&gt;' is not assignable to type '&amp;Record&lt;K, V&gt;'`
**Expected `formatDiagnosticLine` output**: `ERROR [10:5] Type '&lt;string&gt;' is not assignable to type '&amp;Record&lt;K, V&gt;' (ts2322)`

### Fixture 4: Multi-file with total line cap hit mid-file

**Input**: 3 files: `src/a.ts` (20 errors), `src/b.ts` (20 errors), `src/c.ts` (20 errors). maxTotalLines=50, maxDiagnosticsPerFile=20.
**Expected `formatMultiFileDiagnostics` output**:
- `src/a.ts`: 20 diagnostic lines (total=20)
- `src/b.ts`: 20 diagnostic lines (total=40)
- `src/c.ts`: 10 diagnostic lines (total=50, capped), plus `... and 10 more` (overflow suffix NOT counted)
- Total diagnostic lines counted toward cap: exactly 50
- Overflow suffix lines ("... and 10 more"): NOT counted toward 50

### Fixture 5: Overflow suffix does NOT count toward total cap (REQ-FMT-068)

**Input**: 2 files: `src/a.ts` (25 errors), `src/b.ts` (25 errors). maxTotalLines=50, maxDiagnosticsPerFile=20.
**Expected**:
- `src/a.ts`: 20 lines + `... and 5 more` → 20 counted toward total
- `src/b.ts`: 20 lines + `... and 5 more` → 20 counted toward total (total=40)
- Both files fully included because 20+20=40 < 50
- The "... and 5 more" lines in each file are NOT counted

## Success Criteria
- 37+ unit tests covering all 8 functions
- 30%+ property-based tests
- Tests fail naturally on stubs
- No reverse testing or mock theater
- BDD-style comments on all tests
- All 5 golden test fixtures implemented as concrete test cases

## Failure Recovery
1. `git checkout -- packages/lsp/test/diagnostics.test.ts`
2. Re-run Phase 07

## Phase Completion Marker
Create: `project-plans/issue438/.completed/P07.md`
