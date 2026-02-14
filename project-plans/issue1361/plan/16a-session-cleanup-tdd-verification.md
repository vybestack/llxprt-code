# Phase 16a: Session Cleanup TDD Verification

## Phase ID
`PLAN-20260211-SESSIONRECORDING.P16a`

## Prerequisites
- Required: Phase 16 completed
- Verification: `grep -r "@plan:PLAN-20260211-SESSIONRECORDING.P16" packages/`

## Verification Commands

```bash
# Test file exists
test -f packages/cli/src/utils/sessionCleanup.test.ts || echo "FAIL"

# Mock theater detection
grep -r "toHaveBeenCalled\|mockImplementation\|vi\.mock\|jest\.mock" packages/cli/src/utils/sessionCleanup.test.ts && echo "FAIL: Mock theater"

# Reverse testing
grep -r "NotYetImplemented" packages/cli/src/utils/sessionCleanup.test.ts && echo "FAIL"

# Count tests and property tests
TOTAL=$(grep -c "it(\|test(" packages/cli/src/utils/sessionCleanup.test.ts)
PROPERTY=$(grep -c "fc\.\|test\.prop\|fc\.assert" packages/cli/src/utils/sessionCleanup.test.ts)
echo "Total: $TOTAL, Property: $PROPERTY"
[ "$TOTAL" -lt 15 ] && echo "FAIL: Insufficient tests"

# Behavioral assertions
BEHAVIORAL=$(grep -c "toBe\|toEqual\|toContain\|toHaveLength\|existsSync" packages/cli/src/utils/sessionCleanup.test.ts)
echo "Behavioral assertions: $BEHAVIORAL"

# Uses real temp dirs
grep -q "tmpdir\|mkdtemp" packages/cli/src/utils/sessionCleanup.test.ts || echo "FAIL: Not using real temp dirs"
```

### Semantic Verification Checklist

#### Behavioral Verification Questions
1. **Do tests create ACTUAL session files (not just empty files)?** — [ ]
   - [ ] .jsonl files with valid session headers
   - [ ] .lock files with PID content
2. **Do tests verify ACTUAL file deletion/preservation on disk?** — [ ]
   - [ ] existsSync checks after cleanup operations
3. **Are lock-aware tests realistic?** — [ ]
   - [ ] Active locks use current process PID
   - [ ] Stale locks use dead PIDs (999999999)
4. **Do tests verify .jsonl-only targeting?** — [ ]
   - [ ] Only .jsonl files are targeted for cleanup
   - [ ] Old .json files are ignored (handled by preexisting cleanup)
5. **What's MISSING?** — [ ]
   - [ ] [gap 1]

#### Holistic Functionality Assessment

```markdown
## Test Coverage Assessment
[Which REQ-CLN requirements have direct test coverage?]

## Verdict
[PASS/FAIL]
```

#### Feature Actually Works
```bash
# Verify test file quality
node -e "
const fs = require('fs');
const content = fs.readFileSync('packages/cli/src/utils/sessionCleanup.test.ts', 'utf-8');
const testCount = (content.match(/it\(|test\(/g) || []).length;
const propCount = (content.match(/fc\.|test\.prop|fc\.assert/g) || []).length;
console.log('Total tests:', testCount);
console.log('Property tests:', propCount);
console.log('Percentage:', Math.round(propCount / testCount * 100) + '%');
"
```

- [ ] Tests create actual .jsonl files (not just empty files)
- [ ] Tests create actual .lock files with PID content
- [ ] Lock-aware tests verify file survival/deletion after cleanup
- [ ] Property-based tests cover meaningful state spaces
- [ ] Tests verify .jsonl-only targeting (old .json files not included)

## Failure Recovery
```bash
git checkout -- packages/cli/src/utils/sessionCleanup.test.ts
# Re-implement Phase 16 TDD from scratch
```

## Phase Completion Marker
Create: `project-plans/issue1361/.completed/P16a.md`
