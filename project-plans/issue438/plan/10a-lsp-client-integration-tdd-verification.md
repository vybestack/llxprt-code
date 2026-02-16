# Phase 10a: LSP Client Integration TDD Verification

## Phase ID
`PLAN-20250212-LSP.P10a`

## Prerequisites
- Required: Phase 10 completed
- Verification: `grep -r "@plan:PLAN-20250212-LSP.P10" packages/lsp/test/lsp-client-integration.test.ts`

## Verification Commands

```bash
# File exists
test -f packages/lsp/test/lsp-client-integration.test.ts && echo "PASS" || echo "FAIL"

# Test count
TEST_COUNT=$(grep -c "it(" packages/lsp/test/lsp-client-integration.test.ts)
[ "$TEST_COUNT" -ge 8 ] && echo "PASS: $TEST_COUNT tests" || echo "FAIL"

# No reverse testing
grep -rn "NotYetImplemented" packages/lsp/test/lsp-client-integration.test.ts && echo "FAIL" || echo "PASS"

# Uses fake server fixture
grep -q "fake-lsp-server" packages/lsp/test/lsp-client-integration.test.ts && echo "PASS" || echo "FAIL"

# BDD comments
grep -c "@requirement\|@scenario" packages/lsp/test/lsp-client-integration.test.ts
# Expected: Multiple

# Tests fail naturally
cd packages/lsp && bunx vitest run test/lsp-client-integration.test.ts 2>&1 | tail -5
```

### Semantic Verification Checklist
- [ ] Tests exercise real LSP protocol (initialize, didOpen, publishDiagnostics)
- [ ] Tests verify INPUT → OUTPUT (file path in → diagnostics out)
- [ ] Crash scenario tests server exit handling
- [ ] Timeout scenario tests graceful degradation

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
- Phase 10 deliverables are complete and compliant

## Failure Recovery
If verification fails:
1. Identify specific failures from verification output
2. Return to Phase 10 to fix issues
3. Re-run Phase 10a verification

## Phase Completion Marker
Create: `project-plans/issue438/.completed/P10a.md`
