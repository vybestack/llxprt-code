# Phase 19a: Resume Flow TDD Verification

## Phase ID
`PLAN-20260211-SESSIONRECORDING.P19a`

## Prerequisites
- Required: Phase 19 completed
- Verification: `grep -r "@plan:PLAN-20260211-SESSIONRECORDING.P19" packages/core/src/recording/`

## Verification Commands

```bash
# Test files exist
test -f packages/core/src/recording/SessionDiscovery.test.ts || echo "FAIL"
test -f packages/core/src/recording/resumeSession.test.ts || echo "FAIL"

# Mock theater detection
grep -r "toHaveBeenCalled\|mockImplementation\|vi\.mock" packages/core/src/recording/SessionDiscovery.test.ts packages/core/src/recording/resumeSession.test.ts && echo "FAIL: Mock theater"

# Reverse testing
grep -r "NotYetImplemented" packages/core/src/recording/SessionDiscovery.test.ts packages/core/src/recording/resumeSession.test.ts && echo "FAIL"

# Count tests
TOTAL_D=$(grep -c "it(\|test(" packages/core/src/recording/SessionDiscovery.test.ts)
TOTAL_R=$(grep -c "it(\|test(" packages/core/src/recording/resumeSession.test.ts)
echo "Discovery tests: $TOTAL_D, Resume tests: $TOTAL_R"

# Property-based test count
PROP=$(grep -c "fc\.\|test\.prop\|fc\.assert" packages/core/src/recording/SessionDiscovery.test.ts packages/core/src/recording/resumeSession.test.ts)
echo "Property tests: $PROP"

# Behavioral assertions
BEHAVIORAL=$(grep -c "toBe\|toEqual\|toContain\|toHaveLength\|toMatch" packages/core/src/recording/SessionDiscovery.test.ts packages/core/src/recording/resumeSession.test.ts)
echo "Behavioral assertions: $BEHAVIORAL"

# Uses real services
grep -q "new SessionRecordingService" packages/core/src/recording/resumeSession.test.ts || echo "WARNING: Should use real SessionRecordingService"
```

### Semantic Verification Checklist

#### Behavioral Verification Questions
1. **Do discovery tests create REAL session files?** — [ ]
   - [ ] Use SessionRecordingService to write real JSONL files
   - [ ] Verify file scanning returns correct session metadata
2. **Do resume tests verify ACTUAL IContent history?** — [ ]
   - [ ] Check speaker, block content — not just array length
3. **Do lock-related tests use REAL locks?** — [ ]
   - [ ] Real .lock files created with real/fake PIDs
4. **Are property-based tests meaningful?** — [ ]
   - [ ] Cover edge cases: empty dirs, single sessions, many sessions
   - [ ] 30%+ of tests are property-based
5. **What's MISSING?** — [ ]
   - [ ] [gap 1]

#### Holistic Functionality Assessment

```markdown
## Test Coverage Assessment
[Which REQ-RSM requirements have direct test coverage?]

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
const d = fs.readFileSync('packages/core/src/recording/SessionDiscovery.test.ts', 'utf-8');
const r = fs.readFileSync('packages/core/src/recording/resumeSession.test.ts', 'utf-8');
const content = d + r;
const testCount = (content.match(/it\(|test\(/g) || []).length;
const propCount = (content.match(/fc\.|test\.prop|fc\.assert/g) || []).length;
console.log('Total tests:', testCount);
console.log('Property tests:', propCount);
console.log('Percentage:', Math.round(propCount / testCount * 100) + '%');
"
```

- [ ] Discovery tests create real session files and scan them
- [ ] Resume tests verify actual IContent history from replay
- [ ] Lock-related tests create real lock files
- [ ] Property-based tests cover edge cases meaningfully
- [ ] All tests would fail with empty/stub implementation

## Failure Recovery
```bash
git checkout -- packages/core/src/recording/SessionDiscovery.test.ts
git checkout -- packages/core/src/recording/resumeSession.test.ts
# Re-implement Phase 19 TDD from scratch
```

## Phase Completion Marker
Create: `project-plans/issue1361/.completed/P19a.md`
