# Phase 03: Classification Stub

## Phase ID

`PLAN-20260223-ISSUE1598.P03`

## Prerequisites

- Required: Phase 02a completed
- Verification: `grep -r "@plan:PLAN-20260223-ISSUE1598.P02a" project-plans/issue1598/.completed/`
- Expected files: All pseudocode files verified

## Requirements Implemented (Expanded)

This phase creates TYPE and INTERFACE changes for bucket classification. NO LOGIC IMPLEMENTED YET.

### REQ-1598-IC08: BucketFailureReason Type

**Full Text**: The `BucketFailureReason` type shall be a union containing: `"quota-exhausted"`, `"expired-refresh-failed"`, `"reauth-failed"`, `"no-token"`, `"skipped"`.

**Behavior**:
- GIVEN: TypeScript code needs to classify bucket failures
- WHEN: Code assigns a classification reason
- THEN: TypeScript compiler enforces only valid values

**Why This Matters**: Type safety prevents typos and invalid classifications, catching errors at compile time rather than runtime.

### REQ-1598-IC10: FailoverContext Type

**Full Text**: The `FailoverContext` type shall include a `triggeringStatus` field with type `number | undefined`.

**Behavior**:
- GIVEN: RetryOrchestrator detects API error with status code
- WHEN: tryFailover() is called with context
- THEN: Classification logic can access the HTTP status

**Why This Matters**: Enables accurate classification based on the actual error that triggered failover (especially 429).

## Implementation Tasks

### Files to Create

- `packages/core/src/providers/errors.ts` (UPDATE EXISTING FILE)
  - ADD: `export type BucketFailureReason = ...` (lines 3-8 from error-reporting.md pseudocode)
  - MUST include: `@plan:PLAN-20260223-ISSUE1598.P03`
  - MUST include: `@requirement:REQ-1598-IC08`

### Files to Modify

- `packages/core/src/config/config.ts`
  - ADD: `import type { BucketFailureReason } from '../providers/errors.js'`
  - ADD: `export interface FailoverContext { triggeringStatus?: number }`
  - UPDATE: `BucketFailoverHandler.tryFailover(context?: FailoverContext): Promise<boolean>`
  - MUST include: `@plan:PLAN-20260223-ISSUE1598.P03`
  - MUST include: `@requirement:REQ-1598-IC10, REQ-1598-IC09`

- `packages/cli/src/auth/BucketFailoverHandlerImpl.ts`
  - UPDATE: `tryFailover(context?: FailoverContext): Promise<boolean>` signature
  - NO LOGIC CHANGES — just signature update
  - MUST include: `@plan:PLAN-20260223-ISSUE1598.P03`
  - MUST include: `@requirement:REQ-1598-IC09`

### Required Code Markers

```typescript
/**
 * @plan PLAN-20260223-ISSUE1598.P03
 * @requirement REQ-1598-IC08
 * @pseudocode error-reporting.md lines 3-8
 */
export type BucketFailureReason =
  | "quota-exhausted"
  | "expired-refresh-failed"
  | "reauth-failed"
  | "no-token"
  | "skipped";
```

## Verification Commands

### Automated Checks (Structural)

```bash
# Check plan markers
grep -r "@plan:PLAN-20260223-ISSUE1598.P03" packages/ | wc -l
# Expected: 3+ occurrences

# Check requirement markers
grep -r "@requirement:REQ-1598-IC08" packages/core/src/providers/errors.ts | wc -l
# Expected: 1 occurrence

# Run TypeScript compilation
npm run typecheck
# Expected: No errors
```

### Structural Verification Checklist

- [ ] Phase 02a completion marker exists
- [ ] BucketFailureReason type exported from errors.ts
- [ ] FailoverContext interface defined in config.ts
- [ ] Import statement added to config.ts
- [ ] tryFailover signature updated in config.ts interface
- [ ] tryFailover signature updated in BucketFailoverHandlerImpl.ts
- [ ] Plan markers in all 3 files
- [ ] Requirement markers present
- [ ] TypeScript compiles without errors

### Deferred Implementation Detection

```bash
# Verify NO LOGIC added to tryFailover yet
grep -A 10 "tryFailover(context" packages/cli/src/auth/BucketFailoverHandlerImpl.ts | grep -E "(if|for|while|switch)"
# Expected: Only existing logic (no new control flow)
```

### Semantic Verification Checklist

**Type Safety Verification**:

1. **BucketFailureReason type works**:
   - [ ] Opened errors.ts, verified type definition matches pseudocode
   - [ ] Attempted assignment: `let reason: BucketFailureReason = "invalid"`
   - [ ] Verified TypeScript error (invalid value)
   - [ ] Attempted valid assignment: `let reason: BucketFailureReason = "quota-exhausted"`
   - [ ] Verified TypeScript accepts it

2. **FailoverContext type works**:
   - [ ] Opened config.ts, verified interface definition
   - [ ] Verified triggeringStatus field is optional (?)
   - [ ] Verified type is `number | undefined`

3. **No circular imports**:
   - [ ] config.ts imports from errors.ts
   - [ ] errors.ts does NOT import from config.ts
   - [ ] Verified no circular dependency warnings in build

4. **Backward compatibility**:
   - [ ] tryFailover() still works when called without parameter
   - [ ] Existing call sites compile without changes

5. **What's MISSING?**
   - [ ] (list any issues)

## Success Criteria

- TypeScript compiles without errors
- BucketFailureReason type exported and usable
- FailoverContext interface defined
- tryFailover signature updated (optional parameter)
- No circular imports
- No logic changes yet (stub only)

## Failure Recovery

If this phase fails:

1. Rollback: `git checkout -- packages/core/src/providers/errors.ts packages/core/src/config/config.ts packages/cli/src/auth/BucketFailoverHandlerImpl.ts`
2. Fix type definitions
3. Re-run TypeScript compilation
4. Re-execute phase 03

## Phase Completion Marker

Create: `project-plans/issue1598/.completed/P03.md`

Contents:

```markdown
Phase: P03
Completed: [timestamp]
Files Created: None (types only)
Files Modified:
  - packages/core/src/providers/errors.ts (+10 lines)
  - packages/core/src/config/config.ts (+15 lines)
  - packages/cli/src/auth/BucketFailoverHandlerImpl.ts (+5 lines signature)
Verification:
  - TypeScript compiles: YES
  - No circular imports: YES
  - Plan markers: 3/3 present
  - Requirement markers: 3/3 present
  - No logic added: YES
```
