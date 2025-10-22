# Phase 09: Profile Application Implementation

## Phase ID
`PLAN-20251020-STATELESSPROVIDER3.P09`

## Prerequisites
- Required: Phase 08a completed
- Verification: `test -f project-plans/20251020statelessprovider3/.completed/P08a.md`

## Implementation Tasks

### Files to Modify
- `packages/cli/src/runtime/profileApplication.ts`
  - Implement helpers according to `profile-application.md` pseudocode.
- `packages/cli/src/runtime/runtimeSettings.ts`
  - Call the helpers within `applyProfileSnapshot` and related entry points.
  - Ensure warnings bubble to `/profile` command.
- `packages/cli/src/ui/commands/profileCommand.ts`
  - Surface warnings returned by the helper.

### Required Code Markers
Wrap new logic in comments:
```ts
/**
 * @plan PLAN-20251020-STATELESSPROVIDER3.P09
 * @requirement REQ-SP3-002
 * @pseudocode profile-application.md lines 1-20
 */
```

## Verification Commands
```bash
npm run test --workspace @vybestack/llxprt-code -- --run packages/cli/src/runtime/__tests__/profileApplication.test.ts
```
Tests should pass.

## Manual Verification Checklist
- [ ] Provider lookup guarded when missing.
- [ ] Base URL/auth key preserved after profile load.
- [ ] Warnings captured and surfaced.

## Success Criteria
- RED tests turn GREEN for profile application.

## Failure Recovery
Adjust implementation guided by pseudocode, rerun tests before Phase 09a.

## Phase Completion Marker
Create `project-plans/20251020statelessprovider3/.completed/P09.md`.
