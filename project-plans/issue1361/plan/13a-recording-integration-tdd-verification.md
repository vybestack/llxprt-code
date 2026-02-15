# Phase 13a: Recording Integration TDD Verification

## Phase ID
`PLAN-20260211-SESSIONRECORDING.P13a`

## Prerequisites
- Required: Phase 13 completed
- Verification: `grep -r "@plan:PLAN-20260211-SESSIONRECORDING.P13" packages/core/src/recording/`

## Verification Commands

```bash
# Test file exists
test -f packages/core/src/recording/RecordingIntegration.test.ts || echo "FAIL"

# Mock theater detection
grep -r "toHaveBeenCalled\|toHaveBeenCalledWith\|mockImplementation\|vi\.spyOn\|vi\.mock" packages/core/src/recording/RecordingIntegration.test.ts && echo "FAIL: Mock theater"

# Reverse testing detection
grep -r "toThrow.*NotYetImplemented\|expect.*not\.toThrow" packages/core/src/recording/RecordingIntegration.test.ts && echo "FAIL: Reverse testing"

# Count behavioral assertions
BEHAVIORAL=$(grep -c "toBe\|toEqual\|toContain\|toMatch\|toHaveLength" packages/core/src/recording/RecordingIntegration.test.ts)
echo "Behavioral assertions: $BEHAVIORAL"
[ "$BEHAVIORAL" -lt 15 ] && echo "FAIL: Insufficient behavioral assertions"

# Count property-based tests
PROPERTY=$(grep -c "fc\.\|test\.prop\|fc\.assert" packages/core/src/recording/RecordingIntegration.test.ts)
TOTAL=$(grep -c "it(\|test(" packages/core/src/recording/RecordingIntegration.test.ts)
echo "Property tests: $PROPERTY / $TOTAL total"

# Verify tests use real SessionRecordingService (not mocked)
grep -q "new SessionRecordingService" packages/core/src/recording/RecordingIntegration.test.ts || echo "WARNING: Should use real SessionRecordingService"

# Verify tests read actual JSONL files
grep -q "readFileSync\|readFile\|readdir" packages/core/src/recording/RecordingIntegration.test.ts || echo "FAIL: Tests should read actual files"

# Tests fail against stub
cd packages/core && npx vitest run src/recording/RecordingIntegration.test.ts 2>&1 | grep -E "FAIL|PASS|Error" | head -10
```

### Semantic Verification Checklist

#### Behavioral Verification Questions
1. **Do tests verify ACTUAL JSONL file contents (not mock calls)?** — [ ]
   - [ ] Tests read and parse JSONL files after flush
   - [ ] Tests verify event types and payloads
2. **Do tests use REAL SessionRecordingService (not mocked)?** — [ ]
   - [ ] Real temp directories created and cleaned up
   - [ ] `new SessionRecordingService(...)` used in tests
3. **Are event subscription/unsubscription tests behavioral?** — [ ]
   - [ ] Verified through actual side effects (events captured/not captured)
   - [ ] Re-subscription test verifies old subscription is cleaned up
4. **Are property-based tests meaningful?** — [ ]
   - [ ] IContent generators produce varied structures
   - [ ] 30%+ of tests are property-based
5. **What's MISSING?** — [ ]
   - [ ] [gap 1]

#### Holistic Functionality Assessment

```markdown
## Test Coverage Assessment
[Describe: which REQ-INT requirements have direct test coverage]

## Test Quality
[Are tests behavioral? Do they use real services?]

## Verdict
[PASS/FAIL]
```

#### Feature Actually Works
```bash
# Verify test file quality
node -e "
const fs = require('fs');
const content = fs.readFileSync('packages/core/src/recording/RecordingIntegration.test.ts', 'utf-8');
const testCount = (content.match(/it\(|test\(/g) || []).length;
const propCount = (content.match(/fc\.|test\.prop|fc\.assert/g) || []).length;
console.log('Total tests:', testCount);
console.log('Property tests:', propCount);
console.log('Percentage:', Math.round(propCount / testCount * 100) + '%');
"
```

- [ ] Tests verify actual JSONL file contents (parsed event objects)
- [ ] Tests use real temp directories and real SessionRecordingService
- [ ] Event subscription/unsubscription tested through actual side effects
- [ ] Property-based tests generate meaningful IContent variations
- [ ] Re-subscription test verifies old subscription is cleaned up

## Failure Recovery
```bash
git checkout -- packages/core/src/recording/RecordingIntegration.test.ts
# Re-implement Phase 13 TDD from scratch
```

## Phase Completion Marker
Create: `project-plans/issue1361/.completed/P13a.md`
