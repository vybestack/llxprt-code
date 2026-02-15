# Phase 28a: LspServiceClient Integration TDD Verification

## Phase ID
`PLAN-20250212-LSP.P28a`

## Prerequisites
- Required: Phase 26 completed
- Verification: `grep -r "@plan:PLAN-20250212-LSP.P28" packages/core/src/lsp/__tests__/`

## Verification Commands

```bash
# Test file exists (integration tests must be in this file only)
test -f packages/core/src/lsp/__tests__/lsp-service-client-integration.test.ts && echo "PASS" || echo "FAIL"

# Ensure only the integration test file is targeted for this phase
TARGET_FILES=$(find packages/core/src/lsp/__tests__ -maxdepth 1 -type f -name '*.test.ts' | grep -E 'lsp-service-client-integration\.test\.ts$' | wc -l)
[ "$TARGET_FILES" -eq 1 ] && echo "PASS: integration target file present" || echo "FAIL: expected exactly one integration target file"

# Plan markers
grep -r "@plan:PLAN-20250212-LSP.P28" packages/core/src/lsp/__tests__/lsp-service-client-integration.test.ts | wc -l
# Expected: 1+

# Sufficient tests
TEST_COUNT=$(grep -c "it(" packages/core/src/lsp/__tests__/lsp-service-client-integration.test.ts)
[ "$TEST_COUNT" -ge 10 ] && echo "PASS: $TEST_COUNT tests" || echo "FAIL: only $TEST_COUNT tests"

# No reverse testing
grep -rn "NotYetImplemented" packages/core/src/lsp/__tests__/lsp-service-client-integration.test.ts && echo "FAIL" || echo "PASS"

# Has behavioral assertions
ASSERT_COUNT=$(grep -c "toBe\|toEqual\|toMatch\|toContain" packages/core/src/lsp/__tests__/lsp-service-client-integration.test.ts)
[ "$ASSERT_COUNT" -ge 10 ] && echo "PASS: $ASSERT_COUNT assertions" || echo "FAIL: only $ASSERT_COUNT assertions"

# Integration tests must reference subprocess/RPC lifecycle concepts
grep -rn -E "(spawn|child process|child_process|stdio|ready|shutdown|exit|lsp/ready)" packages/core/src/lsp/__tests__/lsp-service-client-integration.test.ts
# Expected: 1+ matches

# RED phase must fail by assertions on stub behavior (not import failure)
npx vitest run packages/core/src/lsp/__tests__/lsp-service-client-integration.test.ts 2>&1 | tee /tmp/p28a-vitest.log
grep -q -E "(AssertionError|expect\()" /tmp/p28a-vitest.log && echo "PASS: assertion failure observed" || echo "FAIL: no assertion failure detected"
grep -q -E "(Cannot find module|ERR_MODULE_NOT_FOUND|Failed to resolve import)" /tmp/p28a-vitest.log && echo "FAIL: import failure detected" || echo "PASS: no import failure"
```

### Semantic Verification Checklist
- [ ] Tests are only in `packages/core/src/lsp/__tests__/lsp-service-client-integration.test.ts` for this phase
- [ ] Tests cover Bun-not-found graceful degradation (REQ-GRACE-020)
- [ ] Tests cover missing LSP package graceful degradation (REQ-GRACE-030)
- [ ] Tests cover isAlive() returning false after crash (REQ-GRACE-040)
- [ ] Tests cover graceful shutdown sequence (REQ-LIFE-050)
- [ ] Tests cover no-restart after crash (REQ-LIFE-080)
- [ ] Tests verify checkFile returns [] when service is dead
- [ ] RED phase failure is assertion-failure-on-stub, not import/compile failure
- [ ] Integration assertions reference subprocess/RPC lifecycle concepts (spawn/stdio/ready/shutdown/exit)

##### Verdict
[PASS/FAIL]

### Anti-Fake Detection

```bash
# TDD tests must not have skipped/todo markers
grep -rn -E "(TODO|FIXME|HACK|it\.skip|xit|xdescribe|test\.todo)" packages/core/src/lsp/__tests__/lsp-service-client-integration.test.ts
# Expected: No matches

# Tests must not contain placeholder assertions
grep -rn -E "(expect\(true\)\.toBe\(true\)|expect\(1\)\.toBe\(1\))" packages/core/src/lsp/__tests__/lsp-service-client-integration.test.ts
# Expected: No matches

# FAIL if tests validate synthetic fake strings/patterns instead of protocol behavior
grep -rn -E "(File checked by LSP service|synthetic diagnostic|fake diagnostic|scenario counter|local diagnostics map)" packages/core/src/lsp/__tests__/lsp-service-client-integration.test.ts && echo "FAIL" || echo "PASS"

# FAIL if tests are coupled to test-aware fake controls or synthetic hardcoded branches
grep -rn -E "(integrationScenarioStartCount|shouldForceIntegrationUnavailableScenario|callNumber\\s*===)" packages/core/src/lsp/__tests__/lsp-service-client-integration.test.ts && echo "FAIL" || echo "PASS"
```

## Success Criteria
- All verification checks pass
- Anti-fake detection confirms tests are protocol/lifecycle-oriented and not synthetic-pattern-oriented
- Semantic verification confirms behavioral correctness
- Phase 28 deliverables are complete and compliant

## Failure Recovery
If verification fails:
1. Identify specific failures from verification output
2. Return to Phase 28 to fix issues
3. Re-run Phase 28a verification

## Phase Completion Marker
Create: `project-plans/issue438/.completed/P28a.md`
