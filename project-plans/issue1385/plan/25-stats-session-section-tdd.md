# Phase 25: /stats Session Section — TDD

## Phase ID
`PLAN-20260214-SESSIONBROWSER.P25`

## Prerequisites

- Required: Phase 24a completed
- Verification: `test -f project-plans/issue1385/.completed/P24a.md`
- Expected files from previous phase:
  - `packages/cli/src/ui/commands/formatSessionSection.ts` — stub exists
- Preflight verification: Phase 0.5 completed

## Requirements Implemented (Expanded)

### REQ-ST-001: /stats Session Section
**Full Text**: The `/stats` command shall include a "Session" section in its output.
**Behavior**:
- GIVEN: A session recording is active with known metadata
- WHEN: `formatSessionSection(metadata)` is called
- THEN: The returned array includes a "Session:" header line followed by detail lines
**Why This Matters**: Users need to see session info in stats.

### REQ-ST-002: Session ID Display
**Full Text**: The session section shall display the session ID (truncated to 12 characters).
**Behavior**:
- GIVEN: Session metadata with `sessionId = "a1b2c3d4e5f6g7h8i9j0"`
- WHEN: `formatSessionSection(metadata)` is called
- THEN: Output includes `"  ID: a1b2c3d4e5f6"` (first 12 chars)
**Why This Matters**: Full UUIDs are too long for terminal display.

### REQ-ST-003: Session Start Time
**Full Text**: The session section shall display the session start time as a relative time.
**Behavior**:
- GIVEN: Session metadata with a `startTime` in the past
- WHEN: `formatSessionSection(metadata)` is called
- THEN: Output includes `"  Started: <relative time>"` (e.g. "2 hours ago")
**Why This Matters**: Relative times are more intuitive than absolute timestamps.

### REQ-ST-004: File Size
**Full Text**: The session section shall display the session file size.
**Behavior**:
- GIVEN: Session metadata with `filePath` pointing to an existing file
- WHEN: `formatSessionSection(metadata)` is called
- THEN: Output includes `"  File size: <formatted size>"` (e.g. "1.2KB")
**Why This Matters**: Users can gauge session complexity by file size.

### REQ-ST-005: Resumed Status
**Full Text**: The session section shall display whether this is a resumed session (yes/no).
**Behavior**:
- GIVEN: Session metadata with `isResumed = true`
- WHEN: `formatSessionSection(metadata)` is called
- THEN: Output includes `"  Resumed: yes"`
**Why This Matters**: Users need to know if they're in a resumed session.

### REQ-ST-006: No Active Session Fallback
**Full Text**: If no session recording is active, the section shall display "No active session recording."
**Behavior**:
- GIVEN: No session recording (metadata is null)
- WHEN: `formatSessionSection(null)` is called
- THEN: Output includes `"  No active session recording."`
**Why This Matters**: Clear indication when recording is not active.

## Implementation Tasks

### Files to Create

- `packages/cli/src/ui/commands/__tests__/formatSessionSection.spec.ts`
  - MUST include: `@plan PLAN-20260214-SESSIONBROWSER.P25`
  - MUST include: `@requirement:REQ-ST-001` through `@requirement:REQ-ST-006`

### Test Cases (minimum 10)

#### Behavioral Tests

1. **No metadata (null input)** — Returns lines containing "No active session recording."
   - `@requirement:REQ-ST-006`

2. **Session header** — Output includes a "Session:" header line
   - `@requirement:REQ-ST-001`

3. **Session ID truncation to 12 chars** — Given a 36-char UUID, output shows first 12
   - `@requirement:REQ-ST-002`

4. **Session ID shorter than 12 chars** — Given a short ID, output shows the full ID
   - `@requirement:REQ-ST-002`

5. **Start time relative format** — Output includes "Started:" with a relative time string
   - `@requirement:REQ-ST-003`

6. **File size when file exists** — Given a real temp file, output includes "File size:" with formatted bytes
   - `@requirement:REQ-ST-004`

7. **File size when file does not exist** — Given a non-existent filePath, output gracefully handles (no crash)
   - `@requirement:REQ-ST-004`

8. **File size when filePath is null** — Given null filePath, no file size line appears (or shows appropriate message)
   - `@requirement:REQ-ST-004`

9. **Resumed: yes** — Given `isResumed: true`, output includes "Resumed: yes"
   - `@requirement:REQ-ST-005`

10. **Resumed: no** — Given `isResumed: false`, output includes "Resumed: no"
    - `@requirement:REQ-ST-005`

#### Property-Based Tests (~30%)

11. **Session ID truncation property** — For any sessionId string of length >= 12, the displayed ID substring equals sessionId.substring(0, 12)
    - Uses fast-check `fc.string({ minLength: 12, maxLength: 100 })`
    - `@requirement:REQ-ST-002`

12. **Resumed boolean mapping property** — For any boolean value, the output contains "yes" if true, "no" if false
    - Uses `fc.boolean()`
    - `@requirement:REQ-ST-005`

13. **Non-null metadata always has Session header** — For any valid metadata, output always starts with session header
    - Uses arbitrary metadata generator
    - `@requirement:REQ-ST-001`

### Forbidden Patterns

```bash
# These patterns MUST NOT appear in the test file:
grep -n "vi.mock\|jest.mock" packages/cli/src/ui/commands/__tests__/formatSessionSection.spec.ts
# Expected: 0 matches (NO mock theater — use real fs)

grep -n "toHaveBeenCalled\|toHaveBeenCalledWith" packages/cli/src/ui/commands/__tests__/formatSessionSection.spec.ts
# Expected: 0 matches (test behavior, not implementation)

grep -n "NotYetImplemented" packages/cli/src/ui/commands/__tests__/formatSessionSection.spec.ts
# Expected: 0 matches (no reverse testing)
```

### Required Code Markers

```typescript
describe('formatSessionSection @plan PLAN-20260214-SESSIONBROWSER.P25', () => {
  it('returns no-recording message when metadata is null @requirement:REQ-ST-006', () => {
    // ...
  });
});
```

## Verification Commands

### Automated Checks

```bash
# Check plan markers
grep -r "@plan PLAN-20260214-SESSIONBROWSER.P25" packages/cli/src/ | wc -l
# Expected: 13+ (one per test case)

# Check requirements covered
for req in REQ-ST-001 REQ-ST-002 REQ-ST-003 REQ-ST-004 REQ-ST-005 REQ-ST-006; do
  echo -n "$req: "
  grep -c "@requirement:$req" packages/cli/src/ui/commands/__tests__/formatSessionSection.spec.ts
done
# Expected: Each requirement has 1+ test

# Check test count
grep -c "it(" packages/cli/src/ui/commands/__tests__/formatSessionSection.spec.ts
# Expected: 13+ tests

# Check for property-based tests
grep -c "fc\.\|fast-check" packages/cli/src/ui/commands/__tests__/formatSessionSection.spec.ts
# Expected: 3+ (30% of tests)

# Tests should exist but FAIL naturally (stub returns empty/throws)
npm run test -- --run packages/cli/src/ui/commands/__tests__/formatSessionSection.spec.ts 2>&1 | tail -5
# Expected: Tests fail (red phase)

# Check forbidden patterns
grep -n "vi.mock\|jest.mock\|toHaveBeenCalled\|NotYetImplemented" packages/cli/src/ui/commands/__tests__/formatSessionSection.spec.ts
# Expected: 0 matches
```

### Semantic Verification Checklist

1. **Do tests specify REAL behavior?**
   - [ ] Tests assert specific output strings ("No active session recording.", "ID:", "Started:", etc.)
   - [ ] Tests verify actual formatting, not just that function was called

2. **Would tests FAIL if implementation was removed?**
   - [ ] Tests currently fail because stub doesn't produce correct output

3. **Are property tests meaningful?**
   - [ ] Session ID truncation property tests real truncation logic
   - [ ] Boolean mapping property tests actual yes/no output

## Success Criteria

- 13+ tests created covering all 6 requirements
- At least 3 property-based tests using fast-check
- All tests fail naturally (Red phase — stub doesn't implement behavior)
- No forbidden patterns (no mocks, no reverse testing)
- All tests tagged with plan and requirement IDs

## Failure Recovery

If this phase fails:
1. `git checkout -- packages/cli/src/ui/commands/__tests__/formatSessionSection.spec.ts`
2. Re-run Phase 25 with corrected tests

## Phase Completion Marker

Create: `project-plans/issue1385/.completed/P25.md`
Contents:
```markdown
Phase: P25
Completed: YYYY-MM-DD HH:MM
Files Created: [list with line counts]
Tests Added: [count]
Tests Failing: [count] (expected — Red phase)
Verification: [paste of verification command outputs]
```
