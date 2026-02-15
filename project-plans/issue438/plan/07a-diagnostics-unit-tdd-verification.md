# Phase 07a: Diagnostics Formatting Unit TDD Verification

## Phase ID
`PLAN-20250212-LSP.P07a`

## Prerequisites
- Required: Phase 07 completed
- Verification: `grep -r "@plan:PLAN-20250212-LSP.P07" packages/lsp/test/diagnostics.test.ts`

## Verification Commands

### Automated Checks

```bash
# All checks from Phase 07 verification commands
# Plus: verify test count, property ratio, no mock theater, no reverse testing

TEST_COUNT=$(grep -c "it(\|test(" packages/lsp/test/diagnostics.test.ts)
PROP_COUNT=$(grep -c "fc\.\|prop\[" packages/lsp/test/diagnostics.test.ts)
echo "Tests: $TEST_COUNT, Property: $PROP_COUNT"
[ "$TEST_COUNT" -ge 30 ] && echo "PASS: test count" || echo "FAIL: test count"
RATIO=$((PROP_COUNT * 100 / TEST_COUNT))
[ "$RATIO" -ge 30 ] && echo "PASS: property ratio ${RATIO}%" || echo "FAIL: property ratio ${RATIO}%"

# Each function has tests
for fn in escapeXml mapSeverity normalizeLspDiagnostic deduplicateDiagnostics filterBySeverity formatDiagnosticLine formatSingleFileDiagnostics formatMultiFileDiagnostics; do
  grep -q "$fn" packages/lsp/test/diagnostics.test.ts && echo "PASS: $fn tested" || echo "FAIL: $fn not tested"
done
```

### Semantic Verification Checklist (MANDATORY)

#### Holistic Functionality Assessment

##### What tests were written?
[List test suites per function with count and key scenarios]

##### Coverage assessment
- [ ] escapeXml: normal, special chars, empty, already-escaped, multiple
- [ ] mapSeverity: all 4 LSP severities, unknown, boundary
- [ ] normalizeLspDiagnostic: 0→1 conversion, missing fields, source
- [ ] deduplicateDiagnostics: exact dupes, different messages, empty
- [ ] filterBySeverity: errors only, mixed, empty filter, none match
- [ ] formatDiagnosticLine: with code, without code, escaped
- [ ] formatSingleFileDiagnostics: under cap, at cap, over cap, empty, ordered
- [ ] formatMultiFileDiagnostics: single, multi, total cap, other-file cap, ordering

##### Verdict
[PASS/FAIL]


### Deferred Implementation Detection (MANDATORY)

```bash
# TDD tests must not have skipped/todo markers:
grep -rn -E "(TODO|FIXME|HACK|it\.skip|xit|xdescribe|test\.todo)" [test-files]
# Expected: No matches — all tests must be active

# Tests must not contain placeholder assertions:
grep -rn -E "(expect\(true\)\.toBe\(true\)|expect\(1\)\.toBe\(1\))" [test-files]
# Expected: No matches — trivially passing tests are fraud
```


### Feature Actually Works

```bash
# TDD phase — verify tests exist and FAIL naturally on stubs:
# (Tests should fail because stubs return empty/throw, NOT because of import errors)
cd packages/lsp && bunx vitest run 2>&1 | tail -20
# Expected: Tests fail with assertion errors, not import/compile errors
```


## Success Criteria
- All verification checks pass
- No deferred implementation patterns found
- Semantic verification confirms behavioral correctness
- Phase 07 deliverables are complete and compliant


## Failure Recovery
If verification fails:
1. Identify specific failures from verification output
2. Return to Phase 07 to fix issues
3. Re-run Phase 07a verification


## Phase Completion Marker
Create: `project-plans/issue438/.completed/P07a.md`
