# Phase 04a: Core Types + Writer TDD Verification

## Phase ID
`PLAN-20260211-SESSIONRECORDING.P04a`

## Prerequisites
- Required: Phase 04 completed
- Verification: `grep -r "@plan:PLAN-20260211-SESSIONRECORDING.P04" packages/core/src/recording/`

## Verification Commands

```bash
# Mock theater detection
grep -r "toHaveBeenCalled\|toHaveBeenCalledWith\|mockImplementation" packages/core/src/recording/SessionRecordingService.test.ts && echo "FAIL: Mock theater"

# Reverse testing detection
grep -r "toThrow.*NotYetImplemented\|expect.*not\.toThrow" packages/core/src/recording/SessionRecordingService.test.ts && echo "FAIL: Reverse testing"

# Structure-only testing
grep -r "toHaveProperty\|toBeDefined\|toBeUndefined" packages/core/src/recording/SessionRecordingService.test.ts | grep -v "specific value" && echo "WARNING: Structure-only test"

# Count behavioral assertions
BEHAVIORAL=$(grep -c "toBe\|toEqual\|toContain\|toMatch\|toHaveLength\|toBeGreaterThan" packages/core/src/recording/SessionRecordingService.test.ts)
echo "Behavioral assertions: $BEHAVIORAL"
[ "$BEHAVIORAL" -lt 15 ] && echo "FAIL: Insufficient behavioral assertions"

# Count property-based tests
PROPERTY=$(grep -c "fc\.\|test\.prop\|property" packages/core/src/recording/SessionRecordingService.test.ts)
TOTAL=$(grep -c "it(\|test(" packages/core/src/recording/SessionRecordingService.test.ts)
echo "Property tests: $PROPERTY / $TOTAL total"

# Verify tests fail (not error out)
cd packages/core && npx vitest run src/recording/SessionRecordingService.test.ts 2>&1 | grep -E "FAIL|PASS|Error" | head -10
```

### Semantic Verification Checklist

#### Behavioral Verification Questions
1. **Do tests verify ACTUAL file contents (not mock calls)?** — [ ]
   - [ ] Tests read JSONL files and parse lines
   - [ ] Tests verify JSON structure matches envelope format
2. **Do tests use REAL filesystem (not mocked)?** — [ ]
   - [ ] Tests use `os.tmpdir()` for temp directories
   - [ ] No `vi.mock('fs')` or similar
3. **Are property-based tests meaningful (not trivial)?** — [ ]
   - [ ] Generators produce varied IContent structures
   - [ ] Properties assert invariants, not just "no crash"
4. **Would tests FAIL with empty/stub implementation?** — [ ]
   - [ ] Tests assert specific content in files
   - [ ] Tests verify sequence numbers, not just "method returned"
5. **What's MISSING?** — [ ]
   - [ ] [gap 1]

#### Holistic Functionality Assessment

```markdown
## Test Coverage Assessment
[Describe: which REQ-REC requirements have direct test coverage]

## Test Quality
[Are tests behavioral? Do they verify real side effects? Any mock theater?]

## Property Test Quality
[Do generators produce meaningful data? Do properties capture real invariants?]

## Verdict
[PASS/FAIL]
```

#### Feature Actually Works
```bash
# Verify test file exists and can be parsed
node -e "
const fs = require('fs');
const content = fs.readFileSync('packages/core/src/recording/SessionRecordingService.test.ts', 'utf-8');
const testCount = (content.match(/it\(|test\(/g) || []).length;
const propCount = (content.match(/fc\.|test\.prop|fc\.assert/g) || []).length;
console.log('Total tests:', testCount);
console.log('Property tests:', propCount);
console.log('Percentage:', Math.round(propCount / testCount * 100) + '%');
console.log(propCount / testCount >= 0.3 ? 'OK: 30%+ property tests' : 'FAIL: Below 30%');
"
```

- [ ] Each test verifies a specific behavioral requirement (not just structure)
- [ ] Tests read actual file contents to verify (not mock calls)
- [ ] Tests clean up temp directories after execution
- [ ] Property-based tests generate meaningful random data
- [ ] ENOSPC test simulates at filesystem level

## Failure Recovery
```bash
git checkout -- packages/core/src/recording/SessionRecordingService.test.ts
# Re-implement Phase 04 TDD from scratch
```

## Phase Completion Marker
Create: `project-plans/issue1361/.completed/P04a.md`
