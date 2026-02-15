# Phase 17a: Orchestrator Integration TDD Verification

## Phase ID
`PLAN-20250212-LSP.P17a`

## Prerequisites
- Required: Phase 17 completed
- Verification: `grep -r "@plan:PLAN-20250212-LSP.P17" packages/lsp/test/orchestrator-integration.test.ts`

## Verification Commands

```bash
TEST_COUNT=$(grep -c "it(" packages/lsp/test/orchestrator-integration.test.ts)
[ "$TEST_COUNT" -ge 10 ] && echo "PASS" || echo "FAIL"
grep -rn "NotYetImplemented" packages/lsp/test/orchestrator-integration.test.ts && echo "FAIL" || echo "PASS"
grep -rn "toHaveBeenCalled" packages/lsp/test/orchestrator-integration.test.ts && echo "WARNING" || echo "PASS"
cd packages/lsp && bunx vitest run test/orchestrator-integration.test.ts 2>&1 | tail -5
```

### Semantic Verification Checklist
- [ ] Parallel collection tested (timing assertions or race verification)
- [ ] Workspace boundary tested
- [ ] Broken server bypass tested
- [ ] Known-files set tested
- [ ] Navigation delegation tested
- [ ] Uses real components, not mocks

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
- Phase 17 deliverables are complete and compliant

## Failure Recovery
If verification fails:
1. Identify specific failures from verification output
2. Return to Phase 17 to fix issues
3. Re-run Phase 17a verification

## Phase Completion Marker
Create: `project-plans/issue438/.completed/P17a.md`
