# Phase 04: Base Provider Call Contract Stub

## Phase ID

`PLAN-20251018-STATELESSPROVIDER2.P04`

## Prerequisites

- Required: Phase 03a completed
- Verification: `grep -r "@plan:PLAN-20251018-STATELESSPROVIDER2.P03a" project-plans/20251018statelessprovider2/.completed`
- Expected files from previous phase:
  - Multi-runtime context factory and passing guardrail tests

## Implementation Tasks

### Files to Create

- `project-plans/20251018statelessprovider2/analysis/pseudocode/base-provider-call-contract.md`  
  - Document the target stateless call flow for BaseProvider  
  - Include sections for authentication resolution, settings resolution, and call cleanup  
  - Number each step for later reference  
  - Tag with `@plan:PLAN-20251018-STATELESSPROVIDER2.P04` & `@requirement:REQ-SP2-001`

- `packages/core/src/providers/__tests__/baseProvider.stateless.stub.test.ts`  
  - Placeholder test suite containing only a trivial assertion  
  - Tag with plan/requirement markers  
  - Include `TODO` referencing Phase 05 to replace with real tests

### Files to Modify

- `packages/core/src/providers/BaseProvider.test.ts`  
  - Add comment referencing forthcoming stateless contract tests  
  - Tag the comment with plan markers

### Required Code Markers

```typescript
/**
 * @plan PLAN-20251018-STATELESSPROVIDER2.P04
 * @requirement REQ-SP2-001
 */
```

## Verification Commands

### Automated Checks

```bash
grep -r "@plan:PLAN-20251018-STATELESSPROVIDER2.P04" project-plans/20251018statelessprovider2/analysis/pseudocode/base-provider-call-contract.md
npm test -- --run baseProvider.stateless.stub
```

### Manual Verification Checklist

- [ ] Pseudocode document exists with numbered steps
- [ ] Stub test suite executes successfully
- [ ] Plan markers added to referenced files

## Success Criteria

- Placeholder suite passes
- Pseudocode ready for subsequent phases

## Failure Recovery

1. Remove created files
2. Recreate according to instructions

## Phase Completion Marker

Create: `project-plans/20251018statelessprovider2/.completed/P04.md`

```markdown
Phase: P04
Completed: YYYY-MM-DD HH:MM
Files Created:
- project-plans/20251018statelessprovider2/analysis/pseudocode/base-provider-call-contract.md
- packages/core/src/providers/__tests__/baseProvider.stateless.stub.test.ts
Files Modified:
- packages/core/src/providers/BaseProvider.test.ts
Verification:
- <paste command outputs>
```
