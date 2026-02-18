# Phase 28: --resume Flag Removal — TDD

## Phase ID
`PLAN-20260214-SESSIONBROWSER.P28`

## Prerequisites

- Required: Phase 27a completed
- Verification: `test -f project-plans/issue1385/.completed/P27a.md`
- Expected files from previous phase:
  - `packages/cli/src/config/config.ts` — deprecation markers added
  - `packages/cli/src/utils/sessionUtils.ts` — deprecation markers added
- Preflight verification: Phase 0.5 completed

## Requirements Implemented (Expanded)

### REQ-RR-001: Remove --resume Option
**Full Text**: The `--resume` and `-r` CLI options shall be removed from the argument parser.
**Behavior**:
- GIVEN: The CLI argument parser
- WHEN: The user passes `--resume` or `-r`
- THEN: The parser rejects it as an unknown option

### REQ-RR-004: Remove RESUME_LATEST
**Full Text**: `RESUME_LATEST` constant shall be removed.
**Behavior**:
- GIVEN: The `sessionUtils.ts` module
- WHEN: Another module tries to import `RESUME_LATEST`
- THEN: The import fails (symbol no longer exported)

### REQ-RR-006: Preserve --continue
**Full Text**: Existing `--continue` / `-C` behavior shall be unaffected.
**Behavior**:
- GIVEN: The CLI argument parser
- WHEN: The user passes `--continue` or `-C`
- THEN: The parser accepts it and returns the correct value

### REQ-RR-007: Preserve --list-sessions
**Full Text**: `--list-sessions` shall be unaffected.
**Behavior**:
- GIVEN: The CLI argument parser
- WHEN: The user passes `--list-sessions`
- THEN: The parser accepts it

### REQ-RR-008: Preserve --delete-session
**Full Text**: `--delete-session` shall be unaffected.
**Behavior**:
- GIVEN: The CLI argument parser
- WHEN: The user passes `--delete-session <ref>`
- THEN: The parser accepts it and returns the correct value

## Implementation Tasks

### Files to Create

- `packages/cli/src/config/__tests__/continueFlagRemoval.spec.ts`
  - MUST include: `@plan PLAN-20260214-SESSIONBROWSER.P28`
  - Tests verifying the --resume flag is GONE and preserved flags still work

### Test Cases (minimum 8)

#### Behavioral Tests — Removal Verification

1. **--resume flag rejected** — Parsing `['--resume', 'some-id']` should fail or produce no `resume` field
   - `@requirement:REQ-RR-001`

2. **-r alias rejected** — Parsing `['-r', 'some-id']` should fail or produce no `resume` field
   - `@requirement:REQ-RR-001`

3. **No resume field in parsed args** — After parsing valid args, the result object should not have a `resume` property
   - `@requirement:REQ-RR-002`

4. **RESUME_LATEST not exported** — `import { RESUME_LATEST } from '../utils/sessionUtils.js'` should fail at compile time
   - `@requirement:REQ-RR-004` — This is verified structurally via grep, not a runtime test

5. **SessionSelector not exported** — The SessionSelector class is no longer available
   - `@requirement:REQ-RR-005` — Verified structurally

#### Behavioral Tests — Preservation Verification

6. **--continue flag accepted** — Parsing `['--continue']` produces `continueSession: true` (or equivalent)
   - `@requirement:REQ-RR-006`

7. **-C alias accepted** — Parsing `['-C']` produces the continue flag
   - `@requirement:REQ-RR-006`

8. **--list-sessions flag accepted** — Parsing `['--list-sessions']` is recognized
   - `@requirement:REQ-RR-007`

9. **--delete-session flag accepted** — Parsing `['--delete-session', 'some-id']` is recognized
   - `@requirement:REQ-RR-008`

#### Structural Tests (grep-based, not runtime)

10. **No RESUME_LATEST in sessionUtils** — `grep RESUME_LATEST sessionUtils.ts` returns 0 matches after P29
11. **No SessionSelector in sessionUtils** — `grep "class SessionSelector" sessionUtils.ts` returns 0 matches after P29

#### Property-Based Tests (~30%)

12. **Preserved flags always accepted** — For any valid session reference string, `['--continue', ref]` and `['--delete-session', ref]` are accepted by the parser
    - Uses `fc.string({ minLength: 1, maxLength: 50 }).filter(s => !s.startsWith('-'))`
    - `@requirement:REQ-RR-006, REQ-RR-008`

### Notes on Testing Strategy

Since the "removal" hasn't happened yet in P28 (that's P29), the tests should be written to assert the POST-removal state. Some tests will pass even before removal (preservation tests), while removal tests will initially fail or need to be written as negative assertions that currently fail.

For config parsing tests: The existing `config.spec.ts` already has a pattern for testing flag parsing. The new tests should follow the same pattern but assert absence of `--resume`.

### Forbidden Patterns

```bash
grep -n "vi.mock\|jest.mock\|toHaveBeenCalled" packages/cli/src/config/__tests__/continueFlagRemoval.spec.ts
# Expected: 0 matches
```

### Required Code Markers

```typescript
describe('--resume flag removal @plan PLAN-20260214-SESSIONBROWSER.P28', () => {
  it('does not recognize --resume flag @requirement:REQ-RR-001', () => {
    // ...
  });
});
```

## Verification Commands

### Automated Checks

```bash
# 1. Test file exists
test -f packages/cli/src/config/__tests__/continueFlagRemoval.spec.ts && echo "OK" || echo "MISSING"

# 2. Plan markers
grep -c "@plan PLAN-20260214-SESSIONBROWSER.P28" packages/cli/src/config/__tests__/continueFlagRemoval.spec.ts
# Expected: 8+

# 3. Requirements covered
for req in REQ-RR-001 REQ-RR-002 REQ-RR-004 REQ-RR-005 REQ-RR-006 REQ-RR-007 REQ-RR-008; do
  echo -n "$req: "
  grep -c "@requirement:$req" packages/cli/src/config/__tests__/continueFlagRemoval.spec.ts
done
# Expected: Each has 1+

# 4. Test count
grep -c "it(" packages/cli/src/config/__tests__/continueFlagRemoval.spec.ts
# Expected: 8+

# 5. Property tests present
grep -c "fc\.\|fast-check" packages/cli/src/config/__tests__/continueFlagRemoval.spec.ts
# Expected: 1+

# 6. Forbidden patterns
grep -n "vi.mock\|jest.mock\|toHaveBeenCalled" packages/cli/src/config/__tests__/continueFlagRemoval.spec.ts
# Expected: 0

# 7. Some tests fail (removal tests expect --resume gone, but it's still there)
npm run test -- --run packages/cli/src/config/__tests__/continueFlagRemoval.spec.ts 2>&1 | grep -E "FAIL|fail"
# Expected: Some failures (Red phase for removal tests)
```

### Semantic Verification Checklist

1. **Do removal tests assert correct post-removal behavior?**
   - [ ] Tests check that `--resume` is not recognized
   - [ ] Tests check that `resume` field is absent from result

2. **Do preservation tests assert correct behavior?**
   - [ ] `--continue` still works
   - [ ] `--list-sessions` still works
   - [ ] `--delete-session` still works

## Success Criteria

- 8+ tests created covering all requirements
- At least 1 property-based test
- Removal tests fail naturally (Red phase)
- Preservation tests pass
- No forbidden patterns

## Failure Recovery

If this phase fails:
1. `git checkout -- packages/cli/src/config/__tests__/continueFlagRemoval.spec.ts`
2. Re-run Phase 28

## Phase Completion Marker

Create: `project-plans/issue1385/.completed/P28.md`
Contents:
```markdown
Phase: P28
Completed: YYYY-MM-DD HH:MM
Files Created: [list with line counts]
Tests Added: [count]
Tests Failing: [count] (expected — Red phase for removal tests)
Verification: [paste of verification command outputs]
```
