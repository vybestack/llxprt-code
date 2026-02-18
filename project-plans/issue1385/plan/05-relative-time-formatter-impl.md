# Phase 05: Relative Time Formatter — Implementation

## Phase ID
`PLAN-20260214-SESSIONBROWSER.P05`

## Prerequisites
- Required: Phase 04a completed
- Verification: `test -f project-plans/issue1385/.completed/P04a.md`
- Expected files:
  - `packages/cli/src/utils/formatRelativeTime.ts` (stub from P03)
  - `packages/cli/src/utils/__tests__/formatRelativeTime.spec.ts` (tests from P04)

## Requirements Implemented (Expanded)
This phase makes the TDD tests from Phase 04 pass by implementing the real `formatRelativeTime` function.

- REQ-RT-001: Long-form relative time with thresholds
- REQ-RT-002: Short-form abbreviated relative time
- REQ-RT-003: Future time clamping
- REQ-RT-004: Consistent date reference via `now` parameter

## Algorithm Overview (from pseudocode integration-wiring.md lines 170-212)

```
1. Calculate deltaMs = now.getTime() - date.getTime()
2. If deltaMs < 0 (future): clamp to 0
3. Convert to deltaSeconds, deltaMinutes, deltaHours, deltaDays
4. If mode === 'long':
   - <=30s: "just now"
   - 31-90s: "1 minute ago"
   - >90s to <45min: "N minutes ago"
   - 45-89min: "1 hour ago"
   - 90min to <22h: "N hours ago"
   - 22-35h: "yesterday"
   - 36h to <26d: "N days ago"
   - 26-45d: "1 month ago"
   - >45d: formatted date (MMM D, YYYY)
5. If mode === 'short':
   - <=30s: "now"
   - 31s to <45min: "Nm ago"
   - 45min to <22h: "Nh ago"
   - 22h to <26d: "Nd ago"
   - 26-45d: "1mo ago"
   - >45d: short date (MMM D)
6. Default mode is 'long'
7. Default now is new Date()
```

## Implementation Tasks

### Files to Modify
- `packages/cli/src/utils/formatRelativeTime.ts`
  - Replace stub implementation with real threshold logic
  - MUST preserve: `@plan PLAN-20260214-SESSIONBROWSER.P03` marker
  - ADD: `@plan PLAN-20260214-SESSIONBROWSER.P05`

### Do NOT Modify
- `packages/cli/src/utils/__tests__/formatRelativeTime.spec.ts` — Tests must pass WITHOUT modification

## Verification Commands

```bash
# Tests pass
cd packages/cli && npx vitest run src/utils/__tests__/formatRelativeTime.spec.ts
# Expected: ALL PASS

# Plan markers exist for both phases
grep -c "@plan PLAN-20260214-SESSIONBROWSER.P0[35]" packages/cli/src/utils/formatRelativeTime.ts
# Expected: 2

# Requirement markers
grep -c "@requirement:REQ-RT" packages/cli/src/utils/formatRelativeTime.ts
# Expected: 1+

# Pseudocode reference
grep "@pseudocode" packages/cli/src/utils/formatRelativeTime.ts || echo "FAIL: pseudocode reference missing"

# TypeScript compiles
cd packages/cli && npx tsc --noEmit

# No deferred implementation
grep -n "TODO\|FIXME\|HACK\|NotYetImplemented" packages/cli/src/utils/formatRelativeTime.ts && echo "FAIL: deferred" || echo "OK"
grep -n "return ''\|return \[\]\|return \{\}" packages/cli/src/utils/formatRelativeTime.ts && echo "FAIL: empty return" || echo "OK"
```

### Semantic Verification Checklist
- [ ] All TDD tests pass without modification
- [ ] Function returns correct strings for all thresholds
- [ ] Future dates are clamped
- [ ] Default mode is 'long'
- [ ] Default now is current time
- [ ] No deferred implementation markers

## Success Criteria
- ALL tests from Phase 04 pass
- Tests pass WITHOUT modification
- No TODO/FIXME/HACK markers
- TypeScript compiles

## Failure Recovery
```bash
git checkout -- packages/cli/src/utils/formatRelativeTime.ts
```

## Phase Completion Marker
Create: `project-plans/issue1385/.completed/P05.md`

## Deferred Implementation Detection

```bash
rg -n "TODO|FIXME|HACK|STUB|XXX|TEMPORARY|WIP|NotYetImplemented" [modified-files]
```

## Feature Actually Works

- Manual verification is required for this phase before completion is marked.

## Integration Points Verified

- Verify caller/callee boundaries for every touched integration point.
