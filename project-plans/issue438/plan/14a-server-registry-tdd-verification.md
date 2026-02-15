# Phase 14a: Server Registry TDD Verification

## Phase ID
`PLAN-20250212-LSP.P14a`

## Prerequisites
- Required: Phase 14 completed
- Verification: `grep -r "@plan:PLAN-20250212-LSP.P14" packages/lsp/test/server-registry.test.ts`

## Verification Commands

```bash
TEST_COUNT=$(grep -c "it(\|test(" packages/lsp/test/server-registry.test.ts)
PROP_COUNT=$(grep -c "fc\.\|prop\[" packages/lsp/test/server-registry.test.ts)
echo "Tests: $TEST_COUNT, Property: $PROP_COUNT"
[ "$TEST_COUNT" -ge 15 ] && echo "PASS" || echo "FAIL"
RATIO=$((PROP_COUNT * 100 / TEST_COUNT))
[ "$RATIO" -ge 30 ] && echo "PASS: ${RATIO}%" || echo "FAIL: ${RATIO}%"
grep -rn "NotYetImplemented" packages/lsp/test/server-registry.test.ts && echo "FAIL" || echo "PASS"
```

### Semantic Verification Checklist
- [ ] Built-in servers tested (5+ servers)
- [ ] Extension lookup tested (.ts, .go, .py, .rs, unknown)
- [ ] Multi-server-per-extension tested (.ts → TS + ESLint)
- [ ] User config disable tested
- [ ] User config custom server tested

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
- Phase 14 deliverables are complete and compliant

## Failure Recovery
If verification fails:
1. Identify specific failures from verification output
2. Return to Phase 14 to fix issues
3. Re-run Phase 14a verification

## Phase Completion Marker
Create: `project-plans/issue438/.completed/P14a.md`
