# Phase 08: Error Reporting Implementation

## Phase ID

`PLAN-20260223-ISSUE1598.P08`

## Prerequisites

- Required: Phase 07a completed
- Verification: Error reporting tests exist and fail

## Requirements Implemented (Expanded)

### REQ-1598-ER01: Construct Error with Reasons

**Full Text**: When `tryFailover()` returns `false`, the system shall construct `AllBucketsExhaustedError` with `bucketFailureReasons` from `getLastFailoverReasons()`.

**Behavior**:
- GIVEN: tryFailover() has attempted all buckets and returns false
- WHEN: RetryOrchestrator handles the exhaustion case
- THEN: AllBucketsExhaustedError is constructed with bucketFailureReasons from getLastFailoverReasons()

**Why This Matters**: Provides detailed diagnostics to aid debugging when all buckets fail. Users and operators can see exactly why each bucket was unavailable.

### REQ-1598-ER02: Error Class Property

**Full Text**: The `AllBucketsExhaustedError` class shall include a `bucketFailureReasons` property with type `Record<string, BucketFailureReason>`.

**Behavior**:
- GIVEN: AllBucketsExhaustedError is thrown
- WHEN: Error handler accesses bucketFailureReasons property
- THEN: Property contains a record mapping bucket names to failure reasons

**Why This Matters**: Structured error reporting enables programmatic error analysis. This is a NEW property added to the existing error class for enhanced observability.

### REQ-1598-ER03: Backward Compatible Constructor

**Full Text**: The `AllBucketsExhaustedError` constructor shall accept `bucketFailureReasons` as an optional parameter, defaulting to an empty record if not provided.

**Behavior**:
- GIVEN: Existing code constructs AllBucketsExhaustedError with 3 parameters
- WHEN: Constructor is called without bucketFailureReasons
- THEN: bucketFailureReasons property defaults to empty object {}

**Why This Matters**: Backward compatibility with existing call sites that don't provide reasons. Ensures no breaking changes to error construction.

### REQ-1598-ER04: Enhanced Error Message

**Full Text**: The `AllBucketsExhaustedError.message` property shall include a human-readable summary of bucket failure reasons when available.

**Behavior**:
- GIVEN: AllBucketsExhaustedError constructed with bucketFailureReasons
- WHEN: Error message is formatted
- THEN: Message includes provider, attempted buckets, and per-bucket failure reasons

**Why This Matters**: Improves error readability for operators. A glance at the error message reveals the complete failure state without needing to inspect structured properties.

### REQ-1598-IC02: getLastFailoverReasons Method

**Full Text**: The `BucketFailoverHandler` interface shall define a `getLastFailoverReasons()` method returning `Record<string, BucketFailureReason>`.

**Behavior**:
- GIVEN: tryFailover() has completed classification
- WHEN: Caller invokes getLastFailoverReasons()
- THEN: Method returns shallow copy of lastFailoverReasons

**Why This Matters**: Exposes classification results to RetryOrchestrator for error construction. Shallow copy prevents external mutations of internal state.

## Implementation Tasks

### Files to Create

(None — this phase modifies existing files only)

### Files to Modify

- `packages/core/src/providers/errors.ts`
  - COMPLETE: AllBucketsExhaustedError implementation
  - Constructor logic, message construction, property assignment
  - MUST include: `@plan:PLAN-20260223-ISSUE1598.P08`
  - MUST include: `@pseudocode error-reporting.md lines 10-40`

- `packages/cli/src/auth/BucketFailoverHandlerImpl.ts`
  - COMPLETE: getLastFailoverReasons() implementation
  - Return shallow copy of lastFailoverReasons
  - MUST include: `@plan:PLAN-20260223-ISSUE1598.P08`
  - MUST include: `@pseudocode error-reporting.md (usage section)`

### Required Code Markers

```typescript
/**
 * @plan PLAN-20260223-ISSUE1598.P08
 * @requirement REQ-1598-IC02
 * @pseudocode error-reporting.md (getLastFailoverReasons usage)
 */
getLastFailoverReasons(): Record<string, BucketFailureReason> {
  return { ...this.lastFailoverReasons };
}
```

## Verification Commands

```bash
# Check markers
grep -r "@plan:PLAN-20260223-ISSUE1598.P08" packages/ | wc -l
# Expected: 2+

# Run error reporting tests - should pass
npm test -- errors.test.ts
# Expected: All pass

# Run full suite
npm test
# Expected: All pass
```

### Deferred Implementation Detection

```bash
# No TODOs in error reporting code
grep -n "TODO\|FIXME" packages/core/src/providers/errors.ts
# Expected: No matches (or only unrelated)
```

### Semantic Verification Checklist

1. **AllBucketsExhaustedError works**:
   - [ ] Constructed with 3 params → bucketFailureReasons = {}
   - [ ] Constructed with 4 params → bucketFailureReasons populated
   - [ ] Message includes provider name and bucket list

2. **getLastFailoverReasons works**:
   - [ ] Returns shallow copy (mutations don't affect internal state)
   - [ ] Returns empty {} when no failover attempted yet
   - [ ] Returns populated reasons after tryFailover()

3. **Tests pass**:
   - [ ] All 5+ error reporting tests pass
   - [ ] No regressions in full suite

## Success Criteria

- AllBucketsExhaustedError implementation complete
- getLastFailoverReasons() returns shallow copy
- All error reporting tests pass
- Full test suite passes

## Failure Recovery

If tests fail:

1. Review pseudocode error-reporting.md
2. Compare implementation with pseudocode lines
3. Fix discrepancies
4. Re-run tests

## Phase Completion Marker

Create: `project-plans/issue1598/.completed/P08.md`

```markdown
Phase: P08
Completed: [timestamp]
Tests: 5/5 pass
Implementation: Complete
Ready for P09: YES
```
