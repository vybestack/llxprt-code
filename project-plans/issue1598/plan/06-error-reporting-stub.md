# Phase 06: Error Reporting Stub

## Phase ID

`PLAN-20260223-ISSUE1598.P06`

## Prerequisites

- Required: Phase 05a completed
- Verification: Classification implementation complete

## Requirements Implemented (Expanded)

### REQ-1598-ER02: bucketFailureReasons Property

**Full Text**: The `AllBucketsExhaustedError` class shall include a `bucketFailureReasons` property with type `Record<string, BucketFailureReason>`.

**Behavior**:
- GIVEN: AllBucketsExhaustedError is constructed
- WHEN: Error object accessed
- THEN: bucketFailureReasons property exists with structured reasons

**Why This Matters**: Enables programmatic error analysis — callers can inspect why each bucket failed.

### REQ-1598-ER03: Optional Parameter

**Full Text**: The `AllBucketsExhaustedError` constructor shall accept `bucketFailureReasons` as an optional parameter, defaulting to an empty record if not provided.

**Behavior**:
- GIVEN: Existing code constructs AllBucketsExhaustedError without reasons
- WHEN: Constructor called with 3 parameters (old signature)
- THEN: Error created with empty bucketFailureReasons (backward compatible)

**Why This Matters**: Existing call sites continue to work without modification.

### REQ-1598-IC01: getLastFailoverReasons Method

**Full Text**: The `BucketFailoverHandler` interface shall define an optional method `getLastFailoverReasons?(): Record<string, BucketFailureReason>`.

**Behavior**:
- GIVEN: BucketFailoverHandler interface defined
- WHEN: Implementation provides getLastFailoverReasons()
- THEN: Method returns classification results from last tryFailover()

**Why This Matters**: Enables RetryOrchestrator to retrieve reasons for error reporting without coupling.

## Implementation Tasks

### Files to Modify

- `packages/core/src/providers/errors.ts`
  - UPDATE: AllBucketsExhaustedError constructor to accept optional 4th parameter
  - ADD: bucketFailureReasons property
  - MUST include: `@plan:PLAN-20260223-ISSUE1598.P06`
  - MUST include: `@requirement:REQ-1598-ER02, ER03`
  - MUST include: `@pseudocode error-reporting.md lines 10-40`

- `packages/core/src/config/config.ts`
  - UPDATE: BucketFailoverHandler interface
  - ADD: `getLastFailoverReasons?(): Record<string, BucketFailureReason>`
  - MUST include: `@plan:PLAN-20260223-ISSUE1598.P06`
  - MUST include: `@requirement:REQ-1598-IC01`

- `packages/cli/src/auth/BucketFailoverHandlerImpl.ts`
  - ADD: `getLastFailoverReasons(): Record<string, BucketFailureReason>` method (stub implementation)
  - MUST include: `@plan:PLAN-20260223-ISSUE1598.P06`
  - MUST include: `@requirement:REQ-1598-IC02`
  - MUST include: `@pseudocode error-reporting.md (usage section)`

### Required Code Markers

```typescript
/**
 * @plan PLAN-20260223-ISSUE1598.P06
 * @requirement REQ-1598-ER02, ER03
 * @pseudocode error-reporting.md lines 15-33
 */
constructor(
  providerName: string,
  buckets: string[],
  lastError: Error,
  bucketFailureReasons?: Record<string, BucketFailureReason>
) {
  // Implementation matching pseudocode
}
```

## Verification Commands

### Automated Checks

```bash
# Check plan markers
grep -r "@plan:PLAN-20260223-ISSUE1598.P06" packages/ | wc -l
# Expected: 3+ occurrences

# TypeScript compilation
npm run typecheck
# Expected: No errors

# Run tests
npm test
# Expected: All pass (no logic changes yet)
```

### Structural Verification Checklist

- [ ] AllBucketsExhaustedError constructor updated (4 parameters)
- [ ] bucketFailureReasons property added
- [ ] getLastFailoverReasons() method added to interface (optional)
- [ ] getLastFailoverReasons() stub method added to BucketFailoverHandlerImpl
- [ ] Plan markers in all 3 files
- [ ] TypeScript compiles
- [ ] Tests pass

### Deferred Implementation Detection

```bash
# Verify getLastFailoverReasons returns placeholder
grep -A 3 "getLastFailoverReasons" packages/cli/src/auth/BucketFailoverHandlerImpl.ts | grep "return"
# Expected: "return { ...this.lastFailoverReasons }" or similar
```

### Semantic Verification Checklist

1. **Backward compatibility works**:
   - [ ] Attempted construction with 3 parameters
   - [ ] Verified error object created without crash
   - [ ] Verified bucketFailureReasons defaults to {}

2. **Optional method works**:
   - [ ] Interface compiles with optional method
   - [ ] Implementation provides method
   - [ ] Method can be called with optional chaining

3. **No breaking changes**:
   - [ ] Existing AllBucketsExhaustedError call sites still compile
   - [ ] Existing BucketFailoverHandler implementations still compile

4. **Ready for TDD**:
   - [ ] Types exist and are correct
   - [ ] Stub implementation returns sensible default

## Success Criteria

- AllBucketsExhaustedError constructor accepts 4 parameters
- bucketFailureReasons property exists
- getLastFailoverReasons() method defined in interface and implementation
- TypeScript compiles
- Tests pass
- Backward compatible

## Failure Recovery

If phase fails:

1. Rollback: `git checkout -- packages/core/src/providers/errors.ts packages/core/src/config/config.ts packages/cli/src/auth/BucketFailoverHandlerImpl.ts`
2. Fix type definitions
3. Re-run verification
4. Re-execute phase 06

## Phase Completion Marker

Create: `project-plans/issue1598/.completed/P06.md`

```markdown
Phase: P06
Completed: [timestamp]
Files Modified:
  - packages/core/src/providers/errors.ts (+15 lines)
  - packages/core/src/config/config.ts (+5 lines)
  - packages/cli/src/auth/BucketFailoverHandlerImpl.ts (+10 lines stub)
Verification:
  - TypeScript: OK
  - Tests: PASS
  - Backward compatible: YES
Ready for P07: YES
```
