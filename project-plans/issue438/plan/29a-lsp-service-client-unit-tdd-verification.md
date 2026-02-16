# Phase 29a: LspServiceClient Unit TDD Verification

## Phase ID
`PLAN-20250212-LSP.P29a`

## Prerequisites
- Required: Phase 27 completed
- Verification: `grep -r "@plan:PLAN-20250212-LSP.P29" packages/core/src/lsp/__tests__/lsp-service-client.test.ts`

## Verification Commands

```bash
# Test file exists (unit tests must be in this file only)
test -f packages/core/src/lsp/__tests__/lsp-service-client.test.ts && echo "PASS" || echo "FAIL"

# Ensure only the unit test file is targeted for this phase (works for tracked + untracked files)
TARGET_FILES=$(find packages/core/src/lsp/__tests__ -maxdepth 1 -type f -name '*.test.ts' | grep -E 'lsp-service-client\.test\.ts$' | wc -l)
[ "$TARGET_FILES" -eq 1 ] && echo "PASS: unit target file present" || echo "FAIL: expected exactly one unit target file"

# Sufficient tests
TEST_COUNT=$(grep -c "it(" packages/core/src/lsp/__tests__/lsp-service-client.test.ts)
[ "$TEST_COUNT" -ge 15 ] && echo "PASS: $TEST_COUNT tests" || echo "FAIL: only $TEST_COUNT tests"

# No reverse testing
grep -rn "NotYetImplemented" packages/core/src/lsp/__tests__/lsp-service-client.test.ts && echo "FAIL" || echo "PASS"

# Has behavioral assertions
ASSERT_COUNT=$(grep -c "toBe\|toEqual\|toMatch\|toContain" packages/core/src/lsp/__tests__/lsp-service-client.test.ts)
[ "$ASSERT_COUNT" -ge 15 ] && echo "PASS: $ASSERT_COUNT assertions" || echo "FAIL: only $ASSERT_COUNT assertions"

# Unit tests must reference JSON-RPC coupling concepts
grep -rn -E "(createMessageConnection|sendRequest|StreamMessageReader|StreamMessageWriter|MessageConnection)" packages/core/src/lsp/__tests__/lsp-service-client.test.ts
# Expected: 1+ matches

# Unit tests must cover abort/cancellation behavior
grep -rn -E "(AbortController|AbortSignal|abort|cancellation|cancel)" packages/core/src/lsp/__tests__/lsp-service-client.test.ts
# Expected: 1+ matches

# RED phase must fail naturally on stubs
npx vitest run packages/core/src/lsp/__tests__/lsp-service-client.test.ts 2>&1 | tail -5
# Expected: Tests FAIL on stub assertions
```

### Semantic Verification Checklist
- [ ] Tests are only in `packages/core/src/lsp/__tests__/lsp-service-client.test.ts` for this phase
- [ ] Tests cover Bun detection (which/execSync)
- [ ] Tests cover subprocess spawn args (stdio, cwd, env)
- [ ] Tests cover JSON-RPC request/response for all 4 methods
- [ ] Tests reference JSON-RPC coupling symbols (`createMessageConnection`, `sendRequest`, stream reader/writer equivalents)
- [ ] Tests cover abort/cancellation behavior paths
- [ ] Tests cover error handling (RPC errors → empty returns)
- [ ] Tests cover shutdown sequence (lsp/shutdown → SIGTERM → SIGKILL)
- [ ] Tests cover cleanup (alive=false, null refs after shutdown)
- [ ] Tests cover getMcpTransportStreams alive/dead cases

##### Verdict
[PASS/FAIL]

### Anti-Fake Detection

```bash
# TDD tests must not have skipped/todo markers
grep -rn -E "(TODO|FIXME|HACK|it\.skip|xit|xdescribe|test\.todo)" packages/core/src/lsp/__tests__/lsp-service-client.test.ts
# Expected: No matches

# Tests must not contain placeholder assertions
grep -rn -E "(expect\(true\)\.toBe\(true\)|expect\(1\)\.toBe\(1\))" packages/core/src/lsp/__tests__/lsp-service-client.test.ts
# Expected: No matches

# FAIL if tests rely on test-aware scenario counters
grep -rn -E "(scenarioCounter|scenario counter|test scenario id|fake scenario)" packages/core/src/lsp/__tests__/lsp-service-client.test.ts && echo "FAIL" || echo "PASS"

# FAIL if tests are coupled to test-aware fake controls or synthetic hardcoded branches
grep -rn -E "(integrationScenarioStartCount|shouldForceIntegrationUnavailableScenario|callNumber\\s*===)" packages/core/src/lsp/__tests__/lsp-service-client.test.ts && echo "FAIL" || echo "PASS"
```

## Success Criteria
- All verification checks pass
- Anti-fake detection confirms tests are validating true JSON-RPC/process coupling behavior
- Semantic verification confirms behavioral correctness
- Phase 29 deliverables are complete and compliant

## Failure Recovery
If verification fails:
1. Identify specific failures from verification output
2. Return to Phase 29 to fix issues
3. Re-run Phase 29a verification

## Phase Completion Marker
Create: `project-plans/issue438/.completed/P29a.md`
