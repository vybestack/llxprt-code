# Phase 21a: RPC Channel TDD Verification

## Phase ID
`PLAN-20250212-LSP.P21a`

## Verification Scope
Verify Phase 21 (RPC Channel TDD) deliverables.

## Structural Checks

```bash
test -f packages/lsp/test/rpc-channel.test.ts && echo "PASS" || echo "FAIL"
grep -r "@plan:PLAN-20250212-LSP.P21" packages/lsp/test/rpc-channel.test.ts && echo "PASS" || echo "FAIL"
TEST_COUNT=$(grep -c "it(" packages/lsp/test/rpc-channel.test.ts)
[ "$TEST_COUNT" -ge 8 ] && echo "PASS: $TEST_COUNT tests" || echo "FAIL: only $TEST_COUNT tests"
grep -rn "NotYetImplemented" packages/lsp/test/rpc-channel.test.ts && echo "FAIL" || echo "PASS"
cd packages/lsp && bunx tsc --noEmit
```

## Semantic Checklist
- [ ] All 4 methods tested: lsp/checkFile, lsp/diagnostics, lsp/status, lsp/shutdown
- [ ] Tests assert on response content (not call verification)
- [ ] Tests use in-memory MessageConnection (not subprocess)
- [ ] Tests fail naturally on stubs (RED phase confirmed)
- [ ] Unknown method test present
- [ ] No mock theater — tests verify behavioral output


## Prerequisites
- Required: Phase 21 completed
- Verification: `grep -r "@plan:PLAN-20250212-LSP.P21" .`

### Semantic Verification Checklist (MANDATORY)

#### Behavioral Verification Questions
1. **Does the code DO what the requirement says?**
   - [ ] I read the requirement text
   - [ ] I read the implementation (not just checked file exists)
   - [ ] I can explain HOW the requirement is fulfilled

2. **Is this REAL implementation, not placeholder?**
   - [ ] Deferred implementation detection passed
   - [ ] No empty returns in implementation
   - [ ] No "will be implemented" comments

3. **Would the test FAIL if implementation was removed?**
   - [ ] Test verifies actual outputs, not just that code ran

4. **Is the feature REACHABLE by users?**
   - [ ] Code is called from existing code paths

5. **What's MISSING?**
   - [ ] List any gaps before proceeding

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
- Phase 21 deliverables are complete and compliant

## Failure Recovery
If verification fails:
1. Identify specific failures from verification output
2. Return to Phase 21 to fix issues
3. Re-run Phase 21a verification

## Phase Completion Marker
Create: `project-plans/issue438/.completed/P21a.md`
