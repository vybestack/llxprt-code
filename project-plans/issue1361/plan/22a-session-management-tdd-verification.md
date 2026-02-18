# Phase 22a: Session Management TDD Verification

## Phase ID
`PLAN-20260211-SESSIONRECORDING.P22a`

## Prerequisites
- Required: Phase 22 completed
- Verification: `grep -r "@plan:PLAN-20260211-SESSIONRECORDING.P22" packages/core/src/recording/`

## Verification Commands

```bash
# Test file exists
test -f packages/core/src/recording/sessionManagement.test.ts || echo "FAIL"

# Mock theater
grep -r "toHaveBeenCalled\|mockImplementation\|vi\.mock" packages/core/src/recording/sessionManagement.test.ts && echo "FAIL"

# Reverse testing
grep -r "NotYetImplemented" packages/core/src/recording/sessionManagement.test.ts && echo "FAIL"

# Count tests
TOTAL=$(grep -c "it(\|test(" packages/core/src/recording/sessionManagement.test.ts)
PROPERTY=$(grep -c "fc\.\|test\.prop\|fc\.assert" packages/core/src/recording/sessionManagement.test.ts)
echo "Total: $TOTAL, Property: $PROPERTY"

# Behavioral assertions
BEHAVIORAL=$(grep -c "toBe\|toEqual\|toContain\|toHaveLength\|existsSync\|toThrow\|toMatch" packages/core/src/recording/sessionManagement.test.ts)
echo "Behavioral assertions: $BEHAVIORAL"

# Tests fail against stub
cd packages/core && npx vitest run src/recording/sessionManagement.test.ts 2>&1 | grep -E "FAIL|PASS" | head -10
```

### Semantic Verification Checklist

#### Behavioral Verification Questions
1. **Do list tests verify ACTUAL output content?** — [ ]
   - [ ] Session IDs, metadata present in output
2. **Do delete tests verify ACTUAL file absence on disk?** — [ ]
   - [ ] existsSync checks after deletion
3. **Do lock tests use REAL lock files?** — [ ]
   - [ ] Real .lock files with real/fake PIDs
4. **Are property-based tests meaningful?** — [ ]
   - [ ] 30%+ of tests are property-based
   - [ ] Generators produce realistic scenarios
5. **What's MISSING?** — [ ]
   - [ ] [gap 1]

#### Holistic Functionality Assessment

```markdown
## Test Coverage Assessment
[Which REQ-MGT requirements have direct test coverage?]

## Verdict
[PASS/FAIL]
```

#### Feature Actually Works
```bash
# Verify test file quality
node -e "
const fs = require('fs');
const content = fs.readFileSync('packages/core/src/recording/sessionManagement.test.ts', 'utf-8');
const testCount = (content.match(/it\(|test\(/g) || []).length;
const propCount = (content.match(/fc\.|test\.prop|fc\.assert/g) || []).length;
console.log('Total tests:', testCount);
console.log('Property tests:', propCount);
console.log('Percentage:', Math.round(propCount / testCount * 100) + '%');
"
```

- [ ] List tests verify actual output content (session IDs, metadata)
- [ ] Delete tests verify file absence on disk
- [ ] Lock tests create real lock files
- [ ] Property-based tests generate meaningful test data
- [ ] Tests cover error paths (not found, locked, empty)

## Failure Recovery
```bash
git checkout -- packages/core/src/recording/sessionManagement.test.ts
# Re-implement Phase 22 TDD from scratch
```

## Phase Completion Marker
Create: `project-plans/issue1361/.completed/P22a.md`
