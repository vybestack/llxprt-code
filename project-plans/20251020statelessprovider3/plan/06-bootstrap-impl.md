# Phase 06: Bootstrap Implementation

## Phase ID
`PLAN-20251020-STATELESSPROVIDER3.P06`

## Prerequisites
- Required: Phase 05a completed
- Verification: `test -f project-plans/20251020statelessprovider3/.completed/P05a.md`

## Implementation Tasks

### Files to Modify
- `packages/cli/src/config/profileBootstrap.ts`
  - Replace NotYetImplemented throws with implementations following `bootstrap-order.md` pseudocode.
- `packages/cli/src/config/config.ts`
  - Use the new helpers inside `loadCliConfig` to parse args and apply profile state only after runtime/provider manager are prepared.
- `scripts/start.js`
  - Route bootstrap through the helper to ensure consistent flow.

### Required Code Markers
Add block comments around new logic:
```ts
/**
 * @plan PLAN-20251020-STATELESSPROVIDER3.P06
 * @requirement REQ-SP3-001
 * @pseudocode bootstrap-order.md lines 1-9
 */
```

## Verification Commands
```bash
npm test -- --grep "PLAN-20251020-STATELESSPROVIDER3.P05"
```
Tests should now pass.

## Manual Verification Checklist
- [ ] Helper implementations match pseudocode ordering.
- [ ] `loadCliConfig` no longer applies profile before manager exists.
- [ ] `scripts/start.js` uses the new helper and maintains existing arguments.

## Success Criteria
- Bootstrap tests from Phase 05 pass (GREEN).

## Failure Recovery
If tests still fail, adjust the helper logic referencing pseudocode lines and rerun tests before Phase 06a.

## Phase Completion Marker
Create `project-plans/20251020statelessprovider3/.completed/P06.md`.
