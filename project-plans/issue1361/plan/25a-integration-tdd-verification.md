# Phase 25a: System Integration TDD Verification

## Phase ID
`PLAN-20260211-SESSIONRECORDING.P25a`

## Prerequisites
- Required: Phase 25 completed
- Verification: `grep -r "@plan:PLAN-20260211-SESSIONRECORDING.P25" packages/core/src/recording/integration.test.ts`

## Verification Commands

```bash
# Test file exists with integration tests
test -f packages/core/src/recording/integration.test.ts && echo "OK" || echo "FAIL"

# Count total tests
TOTAL=$(grep -c "it(\|test(" packages/core/src/recording/integration.test.ts)
echo "Total tests: $TOTAL"
[ "$TOTAL" -lt 16 ] && echo "FAIL: Need at least 16 behavioral tests"

# Count property-based tests (30%+ threshold)
PROPERTY=$(grep -c "fc\.\|test\.prop\|fc\.assert" packages/core/src/recording/integration.test.ts)
echo "Property tests: $PROPERTY"
[ "$PROPERTY" -lt 5 ] && echo "FAIL: Need at least 5 property-based tests"

# No mock theater
grep -rn "toHaveBeenCalled\|mockImplementation\|vi\.mock\|vi\.spyOn\|jest\.mock\|jest\.spyOn" packages/core/src/recording/integration.test.ts && echo "FAIL: Mock theater detected"

# No reverse testing (tests that assert NotYetImplemented)
grep -rn "NotYetImplemented\|not\.toBeImplemented\|toThrow.*not.*implemented" packages/core/src/recording/integration.test.ts && echo "FAIL: Reverse testing detected"

# Tests use real filesystem (look for tmpdir/mkdtemp patterns)
grep -c "mkdtemp\|tmpdir\|tmp" packages/core/src/recording/integration.test.ts
# Expected: 1+ (using temp directories for test isolation)

# Tests exercise real components (imports, not mocks)
grep -c "SessionRecordingService\|ReplayEngine\|SessionDiscovery\|SessionLockManager" packages/core/src/recording/integration.test.ts
# Expected: 4+ (all real components used)

# Plan markers present
grep -c "@plan:PLAN-20260211-SESSIONRECORDING.P25" packages/core/src/recording/integration.test.ts
# Expected: 1+

# All tests should pass (all underlying components implemented in P03-P23)
cd packages/core && npx vitest run src/recording/integration.test.ts 2>&1 | tail -20
```

### Behavioral Test Coverage Assessment

The verifier MUST confirm each of these categories has at least one test:

1. **Full lifecycle (record → flush → replay)** — [ ]
2. **Resume flow (record → dispose → resume → verify history)** — [ ]
3. **Resume + continue (resume → record more → verify continuation)** — [ ]
4. **Compression roundtrip (record → compress → resume → verify post-compression state)** — [ ]
5. **Rewind roundtrip** — [ ]
6. **Session discovery** — [ ]
7. **Session deletion** — [ ]
8. **Lock concurrency** — [ ]
9. **Config integration** — [ ]
10. **Deferred materialization (no file without content)** — [ ]

### Property-Based Test Quality Assessment

The verifier MUST confirm property tests cover:

1. **Roundtrip invariant**: arbitrary content sequences serialize and deserialize losslessly — [ ]
2. **Resume length invariant**: history length preserved across resume — [ ]
3. **Monotonic sequence invariant**: seq numbers monotonically increase across resumes — [ ]
4. **Sort invariant**: discovery returns newest-first — [ ]
5. **Compression count invariant**: post-compression count matches expected — [ ]

### FORBIDDEN Pattern Detection

```bash
# No mocking framework usage
grep -rn "vi\.mock\|vi\.spyOn\|jest\.mock\|jest\.fn\|sinon\." packages/core/src/recording/integration.test.ts && echo "FAIL: Mocking detected in integration tests"

# No asserting on call counts (mock theater)
grep -rn "toHaveBeenCalledTimes\|toHaveBeenCalledWith\|toHaveBeenCalled" packages/core/src/recording/integration.test.ts && echo "FAIL: Call-count assertions detected"

# No test doubles
grep -rn "stub\|fake\|double\|dummy" packages/core/src/recording/integration.test.ts | grep -vi "mkdtemp" && echo "WARNING: Possible test doubles"
```

### Semantic Verification Checklist

#### Behavioral Verification Questions
1. **Do the integration tests exercise MULTI-COMPONENT flows?** — [ ]
   - Tests must use SessionRecordingService + ReplayEngine + SessionDiscovery together, not in isolation
2. **Do tests verify ACTUAL DATA, not just counts?** — [ ]
   - Tests must check IContent.speaker, blocks content, not just `history.length === 6`
3. **Do tests verify FILE CONTENTS, not just in-memory state?** — [ ]
   - Tests must read JSONL files and verify structure, not just check `service.isActive()`
4. **Do property tests use MEANINGFUL generators?** — [ ]
   - Generators must produce realistic IContent objects with speaker + blocks
5. **What's MISSING?** — [ ]
   - List any untested scenarios that need fixing before proceeding

### Holistic Assessment

```markdown
## Test Quality Assessment
[Describe: do these tests actually catch regressions?]

## Coverage Gaps
[List any important flows NOT tested]

## Verdict
[PASS/FAIL]
```

## Success Criteria
- 16+ E2E behavioral tests exist and pass
- 5+ property-based tests exist and pass
- Zero mock/spy usage in integration tests
- Tests exercise real filesystem with temp directories
- Tests import and use real component classes

## Failure Recovery
```bash
git checkout -- packages/core/src/recording/integration.test.ts
# Re-examine P25 requirements and rewrite tests
```

## Phase Completion Marker
Create: `project-plans/issue1361/.completed/P25a.md`


---

## Addendum: Over-Mocking Prevention Verification Checklist

### Verification Phase Must Confirm

During Phase 25a verification, explicitly check that integration tests comply with the no-mock policy:

1. **Real HistoryService usage**: Every integration test that exercises recording must instantiate a real `HistoryService`, call `addInternal()` or equivalent to trigger real `contentAdded` events. Verify:
   - `grep -c "new HistoryService" packages/core/src/recording/integration.test.ts` — expected: 1+
   - `grep -c "vi.mock.*HistoryService\|jest.mock.*HistoryService" packages/core/src/recording/integration.test.ts` — expected: 0

2. **Real file I/O**: Every integration test that exercises replay must write a real `.jsonl` file and replay it. Verify:
   - `grep -c "fs.writeFileSync\|fs.promises.writeFile\|createWriteStream" packages/core/src/recording/integration.test.ts` — expected: 1+ (test setup writes files)
   - `grep -c "fs.readFileSync\|fs.promises.readFile\|createReadStream" packages/core/src/recording/integration.test.ts` — expected: 1+ (verification reads files)

3. **Real JSONL parsing**: Replay tests must parse actual JSON lines, not pre-constructed objects. Verify:
   - Integration tests write string content to files (not serialized mock objects)
   - Replay engine parses these strings through `JSON.parse()`

4. **Temp directory cleanup**: Every test using file I/O must clean up its temp directory. Verify:
   - `grep -c "afterEach\|afterAll" packages/core/src/recording/integration.test.ts` — expected: 1+ with cleanup logic

### Failure Criteria
If any of the above checks fail, the verification phase MUST flag the integration tests as insufficient and require remediation before marking Phase 25a complete.
