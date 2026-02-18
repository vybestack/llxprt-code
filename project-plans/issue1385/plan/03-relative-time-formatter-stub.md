# Phase 03: Relative Time Formatter — Stub

## Phase ID
`PLAN-20260214-SESSIONBROWSER.P03`

## Prerequisites
- Required: Phase 02a completed
- Verification: `test -f project-plans/issue1385/.completed/P02a.md`
- Preflight verification: Phase 00a MUST be completed before any implementation phase

## Requirements Implemented (Expanded)

### REQ-RT-001: Long-Form Relative Time
**Full Text**: The system shall format relative timestamps in long form using the following rules: ≤30 seconds → "just now"; 31-90 seconds → "1 minute ago"; >90 seconds to <45 minutes → "N minutes ago"; 45-89 minutes → "1 hour ago"; 90 minutes to <22 hours → "N hours ago"; 22-35 hours → "yesterday"; 36 hours to <26 days → "N days ago"; 26-45 days → "1 month ago"; >45 days → formatted date (MMM D, YYYY).
**Behavior**:
- GIVEN: A timestamp and the current time
- WHEN: `formatRelativeTime(date, { mode: 'long' })` is called
- THEN: Returns a human-readable relative time string in long form
**Why This Matters**: Long-form time is used in the session browser's wide mode and detail line.

### REQ-RT-002: Short-Form Relative Time
**Full Text**: When in narrow mode, the system shall format relative timestamps in abbreviated form: ≤30 seconds → "now"; 31 seconds to <45 minutes → "Nm ago"; 45 minutes to <22 hours → "Nh ago"; 22 hours to <26 days → "Nd ago"; 26-45 days → "1mo ago"; >45 days → short date (MMM D).
**Behavior**:
- GIVEN: A timestamp and the current time
- WHEN: `formatRelativeTime(date, { mode: 'short' })` is called
- THEN: Returns an abbreviated relative time string
**Why This Matters**: Short-form keeps narrow terminals readable.

### REQ-RT-003: Future Time Clamping
**Full Text**: If a session's lastModified timestamp is in the future (e.g. system clock skew), the system shall clamp it to "just now" (long) or "now" (short) instead of displaying negative time.
**Behavior**:
- GIVEN: A timestamp that is 5 minutes in the future
- WHEN: `formatRelativeTime(futureDate)` is called
- THEN: Returns "just now" (long) or "now" (short) instead of an error or negative value

### REQ-RT-004: Consistent Date Reference
**Full Text**: All relative time calculations shall use a single reference point (`now`) for the duration of a single render pass to avoid inconsistencies across rows.
**Behavior**:
- GIVEN: Multiple calls to `formatRelativeTime` within a render
- WHEN: `now` parameter is passed explicitly
- THEN: All calculations use the same reference point

## Implementation Tasks

### Files to Create

- `packages/cli/src/utils/formatRelativeTime.ts`
  - Export `formatRelativeTime(date: Date, options?: { mode?: 'long' | 'short'; now?: Date }): string`
  - Stub implementation: `return ''`
  - MUST include: `@plan PLAN-20260214-SESSIONBROWSER.P03`
  - MUST include: `@requirement:REQ-RT-001`

### Required Code Markers

```typescript
/**
 * Formats a Date as a human-readable relative time string.
 *
 * @plan PLAN-20260214-SESSIONBROWSER.P03
 * @requirement REQ-RT-001, REQ-RT-002, REQ-RT-003, REQ-RT-004
 * @pseudocode integration-wiring.md lines 170-212
 */
export function formatRelativeTime(
  date: Date,
  options?: { mode?: 'long' | 'short'; now?: Date },
): string {
  return '';
}
```

## Verification Commands

### Automated Checks (Structural)
```bash
# File exists
test -f packages/cli/src/utils/formatRelativeTime.ts || echo "FAIL"

# Plan markers exist
grep -r "@plan PLAN-20260214-SESSIONBROWSER.P03" packages/cli/src/utils/formatRelativeTime.ts | wc -l
# Expected: 1+

# Requirement markers exist
grep -r "@requirement:REQ-RT" packages/cli/src/utils/formatRelativeTime.ts | wc -l
# Expected: 1+

# Exports the function
grep "export.*formatRelativeTime" packages/cli/src/utils/formatRelativeTime.ts || echo "FAIL"

# TypeScript compiles
cd packages/cli && npx tsc --noEmit 2>&1 | head -20
```

### Structural Verification Checklist
- [ ] File created at correct path
- [ ] Function exported with correct signature
- [ ] Plan markers present
- [ ] Requirement markers present
- [ ] TypeScript compiles

## Success Criteria
- `formatRelativeTime.ts` exists with correct export signature
- Returns empty string (stub)
- Compiles without errors

## Failure Recovery
```bash
git checkout -- packages/cli/src/utils/formatRelativeTime.ts
```

## Phase Completion Marker
Create: `project-plans/issue1385/.completed/P03.md`

## Deferred Implementation Detection

```bash
rg -n "TODO|FIXME|HACK|STUB|XXX|TEMPORARY|WIP|NotYetImplemented" [modified-files]
```

## Feature Actually Works

- Manual verification is required for this phase before completion is marked.

## Integration Points Verified

- Verify caller/callee boundaries for every touched integration point.
