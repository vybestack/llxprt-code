# Phase 08: Profile Application TDD

## Phase ID
`PLAN-20251020-STATELESSPROVIDER3.P08`

## Prerequisites
- Required: Phase 07a completed
- Verification: `test -f project-plans/20251020statelessprovider3/.completed/P07a.md`

## Implementation Tasks

### Files to Create
- `packages/cli/src/runtime/__tests__/profileApplication.test.ts`
  - Add Vitest suites covering:
    - Provider selection when requested provider is missing.
    - Base URL and auth key preservation when profile is applied.
    - Warning generation for fallback providers.
  - Each test annotated with `@plan:PLAN-20251020-STATELESSPROVIDER3.P08` and `@requirement:REQ-SP3-002`.

## Verification Commands
```bash
npm test -- --run tests --grep "PLAN-20251020-STATELESSPROVIDER3.P08"
```
Expect failures due to NotYetImplemented.

## Manual Verification Checklist
- [ ] Tests assert behaviour, not implementation details.
- [ ] Failures originate from stub error.

## Success Criteria
- RED stage captured for profile application fixes.

## Failure Recovery
Adjust expectations if tests pass inadvertently; ensure they depend on future behaviour.

## Phase Completion Marker
Create `project-plans/20251020statelessprovider3/.completed/P08.md`.
