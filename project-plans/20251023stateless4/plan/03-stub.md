# Phase 03: BaseProvider Runtime Guard Stub

## Phase ID
`PLAN-20251023-STATELESS-HARDENING.P03`

## Prerequisites
- Required: `.completed/P02a.md` present.
- Verification: `test -f project-plans/20251023stateless4/.completed/P02a.md`
- Expected files from previous phase: Final pseudocode documents.

## Implementation Tasks

### Files to Modify
- `packages/core/src/providers/BaseProvider.ts`
  - Introduce placeholder `assertRuntimeContext` method returning existing fallbacks (stub) tagged `@plan:PLAN-20251023-STATELESS-HARDENING.P03` and `@requirement:REQ-SP4-001`.
- `packages/core/src/providers/errors.ts` (or new purpose-built file)
  - Add empty error class shell `MissingProviderRuntimeError` exporting but not yet thrown.
- `packages/core/src/providers/__tests__/` (new or existing) stub test file skeleton with `test.skip` entries referencing upcoming behaviour.

### Activities
- Ensure stubs compile without changing runtime behaviour (fallback still operational) to unblock TDD.
- Annotate stubbed sections with explicit `@plan` scaffolding comments or temporary `throw new NotYetImplementedError()` guards referencing pseudocode lines 10-14 from `analysis/pseudocode/base-provider-fallback-removal.md` for traceability.

### Required Code Markers
- All new methods/classes must include comment block with `@plan:PLAN-20251023-STATELESS-HARDENING.P03` and `@requirement:REQ-SP4-001`.

## Verification Commands

### Automated Checks
```bash
# Type-check focused files
pnpm lint providers --filter BaseProvider
```

### Manual Verification Checklist
- [ ] Stubs introduce no behavioural change (tests still pass).
- [ ] Markers present on new stub elements.
- [ ] Skip placeholders exist for future TDD assertions.

## Success Criteria
- Skeleton guard structure ready for tests without removing fallbacks yet.

## Failure Recovery
1. Revert stub modifications locally if they break existing behaviour.
2. Reintroduce minimal placeholders ensuring compile success.

## Phase Completion Marker
- Create `.completed/P03.md` with timestamp, stub summary, and lint output per PLAN-TEMPLATE guidelines.
