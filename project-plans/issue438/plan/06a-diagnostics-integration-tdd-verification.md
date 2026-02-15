# Phase 06a: Diagnostics Formatting Integration TDD Verification

## Phase ID
`PLAN-20250212-LSP.P06a`

## Prerequisites
- Required: Phase 06 completed
- Verification: `grep -r "@plan:PLAN-20250212-LSP.P06" packages/lsp/test/diagnostics-integration.test.ts`

## Verification Commands

### Automated Checks

```bash
# File exists
test -f packages/lsp/test/diagnostics-integration.test.ts && echo "PASS" || echo "FAIL"

# No reverse testing
grep -rn "NotYetImplemented" packages/lsp/test/diagnostics-integration.test.ts && echo "FAIL" || echo "PASS"

# No mock theater
grep -rn "toHaveBeenCalled" packages/lsp/test/diagnostics-integration.test.ts && echo "FAIL" || echo "PASS"

# No structure-only tests
grep -rn "toHaveProperty\|toBeDefined\|toBeUndefined" packages/lsp/test/diagnostics-integration.test.ts && echo "WARNING: structure-only assertions" || echo "PASS"

# Behavioral assertions present
ASSERTIONS=$(grep -c "toBe\|toEqual\|toStrictEqual\|toContain\|toMatch" packages/lsp/test/diagnostics-integration.test.ts)
echo "Behavioral assertions: $ASSERTIONS"
[ "$ASSERTIONS" -ge 10 ] && echo "PASS" || echo "FAIL: need 10+ assertions"

# Test count
TEST_COUNT=$(grep -c "it(" packages/lsp/test/diagnostics-integration.test.ts)
echo "Test count: $TEST_COUNT"
[ "$TEST_COUNT" -ge 10 ] && echo "PASS" || echo "FAIL: need 10+ tests"

# BDD comments present
grep -c "@requirement\|@scenario\|@given\|@when\|@then" packages/lsp/test/diagnostics-integration.test.ts
# Expected: Multiple

# Tests fail naturally (expected — stubs are empty)
cd packages/lsp && bunx vitest run test/diagnostics-integration.test.ts 2>&1 | tail -5
# Expected: FAIL with assertion errors, NOT NotYetImplemented
```

### Semantic Verification Checklist (MANDATORY)

#### Holistic Functionality Assessment

##### What tests were written?
[List the integration test scenarios — what data flows through what functions]

##### Do tests cover the requirements?
- [ ] REQ-FMT-010: Line format test
- [ ] REQ-FMT-020: XML tag wrapping test
- [ ] REQ-FMT-030: Line ordering test
- [ ] REQ-FMT-040: XML escaping test
- [ ] REQ-FMT-050: Per-file cap test
- [ ] REQ-FMT-055: Overflow count test
- [ ] REQ-FMT-060: Default severity filter test
- [ ] REQ-FMT-065: Custom severity filter test
- [ ] REQ-FMT-068: Cap ordering test (severity → per-file → total)
- [ ] REQ-FMT-070: Deduplication test
- [ ] REQ-FMT-080: 0→1 based conversion test
- [ ] REQ-FMT-090: Deterministic file ordering test

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
- Phase 06 deliverables are complete and compliant


## Failure Recovery
If verification fails:
1. Identify specific failures from verification output
2. Return to Phase 06 to fix issues
3. Re-run Phase 06a verification


## Phase Completion Marker
Create: `project-plans/issue438/.completed/P06a.md`
