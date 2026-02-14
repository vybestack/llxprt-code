# Phase 10a: Concurrency + Lifecycle TDD Verification

## Phase ID
`PLAN-20260211-SESSIONRECORDING.P10a`

## Prerequisites
- Required: Phase 10 completed
- Verification: `grep -r "@plan:PLAN-20260211-SESSIONRECORDING.P10" packages/core/src/recording/`

## Verification Commands

```bash
# Test file exists
test -f packages/core/src/recording/SessionLockManager.test.ts || echo "FAIL: Test file missing"

# Plan markers
grep -c "@plan:PLAN-20260211-SESSIONRECORDING.P10" packages/core/src/recording/SessionLockManager.test.ts
# Expected: 18+

# Mock theater detection
grep -r "toHaveBeenCalled\|toHaveBeenCalledWith\|mockImplementation\|vi\.mock\|jest\.mock" packages/core/src/recording/SessionLockManager.test.ts && echo "FAIL: Mock theater"

# Reverse testing detection
grep -r "toThrow.*NotYetImplemented\|expect.*not\.toThrow" packages/core/src/recording/SessionLockManager.test.ts && echo "FAIL: Reverse testing"

# Count behavioral assertions
BEHAVIORAL=$(grep -c "toBe\|toEqual\|toContain\|toMatch\|toThrow\|existsSync\|fileExists" packages/core/src/recording/SessionLockManager.test.ts)
echo "Behavioral assertions: $BEHAVIORAL"
[ "$BEHAVIORAL" -lt 18 ] && echo "FAIL: Insufficient behavioral assertions"

# Count property-based tests
PROPERTY=$(grep -c "fc\.\|test\.prop\|fc\.assert" packages/core/src/recording/SessionLockManager.test.ts)
TOTAL=$(grep -c "it(\|test(" packages/core/src/recording/SessionLockManager.test.ts)
echo "Property tests: $PROPERTY / $TOTAL total"

# Verify tests use real temp dirs
grep -q "tmpdir\|mkdtemp\|os\.tmpdir" packages/core/src/recording/SessionLockManager.test.ts || echo "FAIL: Not using real temp dirs"

# Verify tests fail naturally against stub
cd packages/core && npx vitest run src/recording/SessionLockManager.test.ts 2>&1 | grep -E "FAIL|PASS|Error" | head -10
```

### Semantic Verification Checklist

#### Behavioral Verification Questions
1. **Do tests verify ACTUAL file system state?** — [ ]
   - [ ] Lock file presence/absence checked with existsSync or stat
   - [ ] Lock file contents parsed and verified (PID, timestamp)
2. **Do tests use REAL filesystem (no mock fs)?** — [ ]
   - [ ] Real temp directories created and cleaned up
3. **Are stale detection tests realistic?** — [ ]
   - [ ] Dead PIDs use large numbers (e.g., 999999999) unlikely to be running
   - [ ] Alive PIDs use process.pid (known to be running)
4. **Do property-based tests cover meaningful scenarios?** — [ ]
   - [ ] Path generation, acquire/release cycles, idempotent release
5. **What's MISSING?** — [ ]
   - [ ] [gap 1]

#### Holistic Functionality Assessment

```markdown
## Test Coverage Assessment
[Describe: which REQ-CON requirements have direct test coverage]

## Test Quality
[Are tests behavioral? Do they verify real side effects?]

## Verdict
[PASS/FAIL]
```

#### Feature Actually Works
```bash
# Verify test file quality
node -e "
const fs = require('fs');
const content = fs.readFileSync('packages/core/src/recording/SessionLockManager.test.ts', 'utf-8');
const testCount = (content.match(/it\(|test\(/g) || []).length;
const propCount = (content.match(/fc\.|test\.prop|fc\.assert/g) || []).length;
console.log('Total tests:', testCount);
console.log('Property tests:', propCount);
console.log('Percentage:', Math.round(propCount / testCount * 100) + '%');
console.log(propCount / testCount >= 0.3 ? 'OK: 30%+ property tests' : 'FAIL: Below 30%');
"
```

- [ ] Tests verify actual lock file presence/absence on disk
- [ ] Tests verify lock file contents (PID, timestamp)
- [ ] Stale detection tests use realistic dead PIDs (large numbers unlikely to be running)
- [ ] Concurrent acquire test actually attempts two acquires on same path
- [ ] Release tests verify file deletion, not just method return
- [ ] Property-based tests generate meaningful path/sequence variations

## Failure Recovery
```bash
git checkout -- packages/core/src/recording/SessionLockManager.test.ts
# Re-implement Phase 10 TDD from scratch
```

## Phase Completion Marker
Create: `project-plans/issue1361/.completed/P10a.md`
