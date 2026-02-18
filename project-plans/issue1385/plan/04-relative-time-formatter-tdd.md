# Phase 04: Relative Time Formatter — TDD

## Phase ID
`PLAN-20260214-SESSIONBROWSER.P04`

## Prerequisites
- Required: Phase 03a completed
- Verification: `test -f project-plans/issue1385/.completed/P03a.md`
- Expected files: `packages/cli/src/utils/formatRelativeTime.ts`

## Requirements Implemented (Expanded)

### REQ-RT-001: Long-Form Relative Time
**Full Text**: See Phase 03 for full requirement text.
**Behavior**:
- GIVEN: Various time deltas
- WHEN: `formatRelativeTime(date, { mode: 'long', now })` is called
- THEN: Returns correct long-form string for each threshold

### REQ-RT-002: Short-Form Relative Time
**Behavior**:
- GIVEN: Various time deltas
- WHEN: `formatRelativeTime(date, { mode: 'short', now })` is called
- THEN: Returns correct abbreviated string for each threshold

### REQ-RT-003: Future Time Clamping
**Behavior**:
- GIVEN: A future timestamp
- WHEN: `formatRelativeTime(futureDate, { now })` is called
- THEN: Returns "just now" (long) or "now" (short)

### REQ-RT-004: Consistent Date Reference
**Behavior**:
- GIVEN: Multiple calls with same `now` parameter
- WHEN: Called in sequence
- THEN: Results are consistent relative to same `now`

## Test Cases

### File to Create
- `packages/cli/src/utils/__tests__/formatRelativeTime.spec.ts`
  - MUST include: `@plan PLAN-20260214-SESSIONBROWSER.P04`
  - MUST include: `@requirement:REQ-RT-001`

### BEHAVIORAL Tests (15+)

1. **Long mode — "just now"**: `formatRelativeTime(now, { mode: 'long', now })` → `"just now"`
2. **Long mode — 15 seconds ago**: Still "just now" (≤30s threshold)
3. **Long mode — 60 seconds ago**: `"1 minute ago"` (31-90s)
4. **Long mode — 5 minutes ago**: `"5 minutes ago"`
5. **Long mode — 1 hour ago**: `"1 hour ago"` (45-89 min)
6. **Long mode — 3 hours ago**: `"3 hours ago"`
7. **Long mode — 1 day ago**: `"yesterday"` (22-35 hours)
8. **Long mode — 5 days ago**: `"5 days ago"`
9. **Long mode — 3 weeks ago**: `"3 weeks ago"` (or "N days ago" depending on threshold)
10. **Long mode — 2 months ago**: formatted date "MMM D, YYYY"
11. **Short mode — "now"**: `formatRelativeTime(now, { mode: 'short', now })` → `"now"`
12. **Short mode — 5 minutes ago**: `"5m ago"`
13. **Short mode — 3 hours ago**: `"3h ago"`
14. **Short mode — 2 days ago**: `"2d ago"`
15. **Short mode — 3 weeks ago**: `"3w ago"`
16. **Short mode — 2 months ago**: short date "MMM D"
17. **Future clamping long**: future date → "just now"
18. **Future clamping short**: future date → "now"
19. **Default mode**: no mode specified defaults to 'long'
20. **Default now**: no `now` specified uses current time (verify by checking output is "just now" for Date.now())

### Boundary Tests

21. **Exactly 30 seconds**: still "just now"
22. **Exactly 31 seconds**: transitions to "1 minute ago"
23. **Exactly 90 seconds**: still "1 minute ago"
24. **Exactly 91 seconds**: "2 minutes ago"
25. **Exactly 45 minutes**: "1 hour ago"
26. **Exactly 22 hours**: "yesterday"
27. **Exactly 26 days**: transitions to week/month range

### Property-Based Tests (~30%)

28. **Property: long mode never returns empty string**: For any valid Date in the past, output is non-empty
29. **Property: short mode output is shorter than long mode**: For any delta, short mode length ≤ long mode length
30. **Property: output changes monotonically**: As delta increases, the output progresses through the threshold labels
31. **Property: future dates always clamp**: Any future date returns "just now" or "now"

### FORBIDDEN Patterns
```typescript
// [ERROR] NO reverse testing
expect(formatRelativeTime(date)).not.toThrow();

// [ERROR] NO mock theater
jest.spyOn(Date, 'now').mockReturnValue(...)  // NO - pass `now` parameter

// [ERROR] NO testing for NotYetImplemented
expect(() => formatRelativeTime(date)).toThrow('NotYetImplemented')
```

### Test Generation Strategy
- Use deterministic `now` parameter for all tests (no Date.now() mocking)
- Create helper: `const ago = (ms: number) => new Date(NOW.getTime() - ms)`
- Use fast-check for property-based tests with arbitrary dates

## Verification Commands

```bash
# Test file exists
test -f packages/cli/src/utils/__tests__/formatRelativeTime.spec.ts || echo "FAIL"

# Plan markers in test file
grep -c "@plan PLAN-20260214-SESSIONBROWSER.P04" packages/cli/src/utils/__tests__/formatRelativeTime.spec.ts
# Expected: 1+

# Requirement markers
grep -c "@requirement:REQ-RT" packages/cli/src/utils/__tests__/formatRelativeTime.spec.ts
# Expected: 1+

# Count test cases
grep -c "it\('" packages/cli/src/utils/__tests__/formatRelativeTime.spec.ts
# Expected: 25+

# Property-based tests exist
grep -c "fc\.\|fast-check\|property" packages/cli/src/utils/__tests__/formatRelativeTime.spec.ts
# Expected: 3+

# Tests fail against stub (expected — stub returns '')
cd packages/cli && npx vitest run src/utils/__tests__/formatRelativeTime.spec.ts 2>&1 | tail -5
# Expected: FAIL (tests expect real strings, stub returns '')

# No mock theater
grep -c "toHaveBeenCalled\|jest.spyOn\|vi.spyOn.*Date" packages/cli/src/utils/__tests__/formatRelativeTime.spec.ts
# Expected: 0

# No reverse testing
grep -c "NotYetImplemented" packages/cli/src/utils/__tests__/formatRelativeTime.spec.ts
# Expected: 0
```

## Success Criteria
- 25+ test cases covering all thresholds
- 4+ property-based tests (~30%)
- All tests fail against stub (expected)
- No mock theater, no reverse testing
- Tests tagged with plan and requirement markers

## Failure Recovery
```bash
git checkout -- packages/cli/src/utils/__tests__/formatRelativeTime.spec.ts
```

## Phase Completion Marker
Create: `project-plans/issue1385/.completed/P04.md`

## Implementation Tasks

- Execute the scoped file updates for this phase only.
- Preserve @plan, @requirement, and @pseudocode traceability markers where applicable.

## Deferred Implementation Detection

```bash
rg -n "TODO|FIXME|HACK|STUB|XXX|TEMPORARY|WIP|NotYetImplemented" [modified-files]
```

## Feature Actually Works

- Manual verification is required for this phase before completion is marked.

## Integration Points Verified

- Verify caller/callee boundaries for every touched integration point.
