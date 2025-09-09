# Phase 12: Footer UI Component Token Display Stub

## Phase ID
`PLAN-20250909-TOKENCOUNTER.P12`

## Prerequisites
- Required: Phase 11 completed
- Verification: `grep -r "@plan:PLAN-20250909-TOKENCOUNTER.P11" .`
- Expected files from previous phase:
  - `packages/core/src/telemetry/uiTelemetry.ts` with token tracking implementations

## Implementation Tasks

### Files to Modify

- `packages/cli/src/ui/components/Footer.tsx`
  - Line 70: Add `throttleWaitTimeMs` to component props
  - Line 80: Add `tokensPerMinute` to component props
  - Line 120: Update responsive context display to include token rate
  - ADD comment: `@plan:PLAN-20250909-TOKENCOUNTER.P12`
  - Implements: `@requirement:REQ-INT-001.1` and `@requirement:REQ-INT-001.2`

### Required Code Markers
Every modified function MUST include:
```typescript
/**
 * @plan PLAN-20250909-TOKENCOUNTER.P12
 * @requirement REQ-INT-001.1
 * @requirement REQ-INT-001.2
 */
```

## Verification Commands

### Automated Checks

```bash
# Check plan markers exist
grep -r "@plan:PLAN-20250909-TOKENCOUNTER.P12" packages/cli/src/ui/components/Footer.tsx | wc -l
# Expected: 2+ occurrences

# Check requirements covered
grep -r "@requirement:REQ-INT-001.1\|@requirement:REQ-INT-001.2" packages/cli/src/ui/components/Footer.tsx | wc -l
# Expected: 2+ occurrences
```

### Manual Verification Checklist

- [ ] Previous phase markers present
- [ ] Footer.tsx file modified
- [ ] New props added to component interface
- [ ] Responsive components updated
- [ ] Plan markers added to all changes
- [ ] Requirements tagged appropriately

## Success Criteria

- Footer.tsx compiles successfully
- Updated component interface and responsive display logic
- All plan markers and requirement tags are present

## Failure Recovery

If this phase fails:

1. `git checkout -- packages/cli/src/ui/components/Footer.tsx`
2. Files to revert: `packages/cli/src/ui/components/Footer.tsx`
3. Re-run Phase 12 with corrected implementation

## Phase Completion Marker

Create: `project-plans/tokencounter/.completed/P12.md`