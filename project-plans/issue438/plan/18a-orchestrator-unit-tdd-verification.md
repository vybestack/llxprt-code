# Phase 18a: Orchestrator Unit TDD Verification

## Phase ID
`PLAN-20250212-LSP.P18a`

## Prerequisites
- Required: Phase 18 completed
- Verification: `grep -r "@plan:PLAN-20250212-LSP.P18" packages/lsp/test/orchestrator.test.ts`

## Verification Commands

```bash
TEST_COUNT=$(grep -c "it(\|test(" packages/lsp/test/orchestrator.test.ts)
PROP_COUNT=$(grep -c "fc\.\|prop\[" packages/lsp/test/orchestrator.test.ts)
[ "$TEST_COUNT" -ge 15 ] && echo "PASS: count" || echo "FAIL: count"
RATIO=$((PROP_COUNT * 100 / TEST_COUNT))
[ "$RATIO" -ge 30 ] && echo "PASS: ratio" || echo "FAIL: ratio"
grep -rn "NotYetImplemented" packages/lsp/test/orchestrator.test.ts && echo "FAIL" || echo "PASS"
```

### Semantic Verification Checklist
- [ ] Workspace root detection tested
- [ ] Server deduplication tested
- [ ] Broken server tracking tested
- [ ] Partial results tested
- [ ] Boundary enforcement tested

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
- Phase 18 deliverables are complete and compliant

## Failure Recovery
If verification fails:
1. Identify specific failures from verification output
2. Return to Phase 18 to fix issues
3. Re-run Phase 18a verification

## Phase Completion Marker
Create: `project-plans/issue438/.completed/P18a.md`
