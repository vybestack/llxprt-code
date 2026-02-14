# Phase 07a: Replay Engine TDD Verification

## Phase ID
`PLAN-20260211-SESSIONRECORDING.P07a`

## Prerequisites
- Required: Phase 07 completed
- Verification: `grep -r "@plan:PLAN-20260211-SESSIONRECORDING.P07" packages/core/src/recording/`

## Verification Commands

```bash
# Test file exists
test -f packages/core/src/recording/ReplayEngine.test.ts || echo "FAIL: Test file missing"

# Plan markers present
grep -c "@plan:PLAN-20260211-SESSIONRECORDING.P07" packages/core/src/recording/ReplayEngine.test.ts
# Expected: 20+

# Mock theater detection
grep -r "toHaveBeenCalled\|toHaveBeenCalledWith\|mockImplementation" packages/core/src/recording/ReplayEngine.test.ts && echo "FAIL: Mock theater"

# Reverse testing detection
grep -r "toThrow.*NotYetImplemented\|expect.*not\.toThrow" packages/core/src/recording/ReplayEngine.test.ts && echo "FAIL: Reverse testing"

# Structure-only testing
grep -r "toHaveProperty\|toBeDefined\|toBeUndefined" packages/core/src/recording/ReplayEngine.test.ts | grep -v "specific value" && echo "WARNING: Structure-only test"

# Count behavioral assertions
BEHAVIORAL=$(grep -c "toBe\|toEqual\|toContain\|toMatch\|toHaveLength\|toBeGreaterThan" packages/core/src/recording/ReplayEngine.test.ts)
echo "Behavioral assertions: $BEHAVIORAL"
[ "$BEHAVIORAL" -lt 20 ] && echo "FAIL: Insufficient behavioral assertions"

# Count property-based tests
PROPERTY=$(grep -c "fc\.\|test\.prop\|fc\.assert" packages/core/src/recording/ReplayEngine.test.ts)
TOTAL=$(grep -c "it(\|test(" packages/core/src/recording/ReplayEngine.test.ts)
echo "Property tests: $PROPERTY / $TOTAL total"
[ "$TOTAL" -lt 20 ] && echo "FAIL: Insufficient total tests (need 20+)"

# Verify tests use real temp dirs (not mocked fs)
grep -q "tmpdir\|mkdtemp\|os\.tmpdir" packages/core/src/recording/ReplayEngine.test.ts || echo "FAIL: Not using real temp dirs"

# Verify tests create JSONL files using SessionRecordingService (not hand-written)
grep -q "SessionRecordingService" packages/core/src/recording/ReplayEngine.test.ts || echo "WARNING: Tests should use SessionRecordingService to create test files"

# Verify tests fail naturally against stub
cd packages/core && npx vitest run src/recording/ReplayEngine.test.ts 2>&1 | grep -E "FAIL|PASS|Error" | head -10
```

### Semantic Verification Checklist

#### Behavioral Verification Questions
1. **Do tests verify ACTUAL replay results (not just method return)?** — [ ]
   - [ ] Tests check IContent speaker, block content
   - [ ] Tests verify history length AND contents
2. **Do tests create REAL JSONL files using SessionRecordingService?** — [ ]
   - [ ] Tests use Phase 05 implementation to write test files
   - [ ] No hand-written JSON files
3. **Are corruption tests REALISTIC?** — [ ]
   - [ ] Truncated last line (simulating crash mid-write)
   - [ ] Garbage data mid-file
   - [ ] Missing session_start
4. **Are property-based tests meaningful?** — [ ]
   - [ ] Generators produce varied IContent structures
   - [ ] Properties assert invariants about history length, compression behavior
5. **What's MISSING?** — [ ]
   - [ ] [gap 1]

#### Holistic Functionality Assessment

```markdown
## Test Coverage Assessment
[Describe: which REQ-RPL requirements have direct test coverage]

## Test Quality
[Are tests behavioral? Do they use real files? Any mock theater?]

## Property Test Quality
[Do generators produce meaningful data? 30%+ property tests?]

## Verdict
[PASS/FAIL]
```

#### Feature Actually Works
```bash
# Verify test file quality
node -e "
const fs = require('fs');
const content = fs.readFileSync('packages/core/src/recording/ReplayEngine.test.ts', 'utf-8');
const testCount = (content.match(/it\(|test\(/g) || []).length;
const propCount = (content.match(/fc\.|test\.prop|fc\.assert/g) || []).length;
console.log('Total tests:', testCount);
console.log('Property tests:', propCount);
console.log('Percentage:', Math.round(propCount / testCount * 100) + '%');
console.log(propCount / testCount >= 0.3 ? 'OK: 30%+ property tests' : 'FAIL: Below 30%');
// Check for mock theater
const hasMocks = content.includes('toHaveBeenCalled') || content.includes('mockImplementation');
console.log(hasMocks ? 'FAIL: Mock theater detected' : 'OK: No mock theater');
"
```

### Deferred Implementation Detection
```bash
grep -rn -E "NotYetImplemented" packages/core/src/recording/ReplayEngine.test.ts && echo "FAIL: Reverse testing"
grep -rn "toHaveBeenCalled\|mockImplementation" packages/core/src/recording/ReplayEngine.test.ts && echo "FAIL: Mock theater"
```

- [ ] Each test verifies a specific behavioral requirement from REQ-RPL-002 through REQ-RPL-007
- [ ] Tests create real JSONL files and replay them (not mock calls)
- [ ] Tests clean up temp directories after execution
- [ ] Property-based tests generate meaningful random data (IContent variations, event sequences)
- [ ] Corruption tests write actual corrupt data to files (not mocked parse errors)
- [ ] Tests would fail if replaySession returned empty results
- [ ] Tests verify actual IContent contents, not just array lengths

## Failure Recovery
```bash
git checkout -- packages/core/src/recording/ReplayEngine.test.ts
# Re-implement Phase 07 TDD from scratch
```

## Phase Completion Marker
Create: `project-plans/issue1361/.completed/P07a.md`
