# Phase 04: Classification TDD

## Phase ID

`PLAN-20260223-ISSUE1598.P04`

## Prerequisites

- Required: Phase 03a completed
- Verification: Phase 03 types exist and compile

## Requirements Implemented (Expanded)

This phase creates FAILING tests for bucket classification. Tests will fail naturally (not with NotYetImplemented checks).

### REQ-1598-CL01: 429 Classification

**Full Text**: When `tryFailover(context?)` is called and `context.triggeringStatus === 429`, the system shall classify the triggering bucket as `quota-exhausted`.

**Behavior**:
- GIVEN: API returns 429 rate limit error
- WHEN: tryFailover called with context containing 429 status
- THEN: Bucket classified as "quota-exhausted" in lastFailoverReasons

**Why This Matters**: 429 responses are unambiguous rate limiting — classification enables proper error reporting and prevents useless reauth attempts.

### REQ-1598-CL02: Expired + Refresh Failed

**Full Text**: When `tryFailover(context?)` is called and the triggering bucket's token is expired and refresh fails, the system shall classify the bucket as `expired-refresh-failed` and log the refresh error.

**Behavior**:
- GIVEN: Current bucket has expired token
- WHEN: tryFailover called AND refresh attempt fails
- THEN: Bucket classified as "expired-refresh-failed" AND error logged

**Why This Matters**: Distinguishes between quota issues and auth issues — enables reauth attempt in Pass 3.

### REQ-1598-CL03: No Token

**Full Text**: When `tryFailover(context?)` is called and `getOAuthToken` returns `null` for the triggering bucket, the system shall classify the bucket as `no-token`.

**Behavior**:
- GIVEN: Token store returns null for bucket
- WHEN: tryFailover called
- THEN: Bucket classified as "no-token"

**Why This Matters**: Missing tokens need foreground reauth, not just refresh.

### REQ-1598-CL04: Token Store Read Error

**Full Text**: When `tryFailover(context?)` is called and `getOAuthToken` throws an exception for the triggering bucket, the system shall log the exception and classify the bucket as `no-token`.

**Behavior**:
- GIVEN: Token store read throws exception
- WHEN: tryFailover called
- THEN: Exception logged AND bucket classified as "no-token"

**Why This Matters**: Read errors may be transient — classify as recoverable via reauth.

### REQ-1598-CL07: Non-429 Expired Refresh Success

**Full Text**: When `tryFailover(context?)` is called without a 429 status, refresh is attempted, and refresh succeeds in pass 1, the system shall return `true` immediately without proceeding to pass 2.

**Behavior**:
- GIVEN: API error (non-429) with expired token
- WHEN: tryFailover called AND Pass 1 refresh succeeds
- THEN: Return true immediately (current bucket recovered, no failover needed)

**Why This Matters**: Successful refresh means no failover needed — saves time and complexity.

## Implementation Tasks

### Files to Create

- `packages/cli/src/auth/BucketFailoverHandlerImpl.test.ts` (UPDATE EXISTING FILE)
  - ADD test suite: "Classification accuracy"
  - Tests:
    - `should classify 429 as quota-exhausted`
    - `should classify expired+refresh-failed as expired-refresh-failed`
    - `should return true immediately when refresh succeeds in pass 1`
    - `should classify null token as no-token`
    - `should classify token-store error as no-token and log warning`
  - MUST include: `@plan:PLAN-20260223-ISSUE1598.P04`
  - MUST include: `@requirement:REQ-1598-CL[01-04,07]`
  - MUST include: `@pseudocode bucket-classification.md lines X-Y`

### Required Code Markers

```typescript
describe('Classification accuracy @plan:PLAN-20260223-ISSUE1598.P04', () => {
  /**
   * @requirement REQ-1598-CL01
   * @pseudocode bucket-classification.md lines 8-10
   */
  it('should classify 429 as quota-exhausted', async () => {
    // Arrange: Set up handler with mock OAuthManager
    // Act: Call tryFailover with context.triggeringStatus = 429
    // Assert: lastFailoverReasons[bucket] === "quota-exhausted"
  });
});
```

## Verification Commands

### Automated Checks

```bash
# Check plan markers
grep -r "@plan:PLAN-20260223-ISSUE1598.P04" packages/cli/src/auth/ | wc -l
# Expected: 5+ occurrences

# Run tests (will fail naturally)
npm test -- BucketFailoverHandlerImpl.test.ts
# Expected: Tests exist but fail (no implementation yet)
```

### Structural Verification Checklist

- [ ] Phase 03a completion marker exists
- [ ] 5+ tests added to BucketFailoverHandlerImpl.test.ts
- [ ] All tests tagged with @plan marker
- [ ] All tests tagged with @requirement marker
- [ ] All tests reference @pseudocode lines
- [ ] Tests follow behavioral pattern (no mock theater)

### Deferred Implementation Detection

```bash
# Verify tests DON'T use NotYetImplemented checks
grep -r "NotYetImplemented\|NotImplemented\|pending\|skip" packages/cli/src/auth/BucketFailoverHandlerImpl.test.ts
# Expected: No matches
```

### Semantic Verification Checklist

**Test Quality Questions**:

1. **Do tests verify actual classification?**
   - [ ] Each test calls tryFailover()
   - [ ] Each test calls getLastFailoverReasons()
   - [ ] Each test asserts on actual reason value

2. **Will tests fail naturally?**
   - [ ] Ran `npm test -- BucketFailoverHandlerImpl.test.ts`
   - [ ] Tests fail with "expected 'quota-exhausted', got undefined" (or similar)
   - [ ] Tests do NOT fail with "NotYetImplemented"

3. **Are tests behavioral?**
   - [ ] No verification of internal method calls (no mock.verify())
   - [ ] Tests verify outcomes, not how code gets there
   - [ ] Tests use real OAuthManager behavior (or realistic mocks)

4. **Do tests cover edge cases?**
   - [ ] Test for null token
   - [ ] Test for exception during getOAuthToken
   - [ ] Test for successful refresh (early return)

5. **What's MISSING?**
   - [ ] (list gaps)

## Success Criteria

- 5+ classification tests created
- All tests fail naturally (not with NotYetImplemented)
- Tests verify actual classification outcomes
- No mock theater (no verification of mock calls)
- Ready for Phase 05 implementation

## Failure Recovery

If tests don't fail naturally:

1. Remove NotYetImplemented checks
2. Ensure tests call actual methods
3. Ensure assertions check real outcomes
4. Re-run tests

## Phase Completion Marker

Create: `project-plans/issue1598/.completed/P04.md`

```markdown
Phase: P04
Completed: [timestamp]
Tests Added: 5+
Test File: packages/cli/src/auth/BucketFailoverHandlerImpl.test.ts
Tests Fail Naturally: YES
Mock Theater: NO
Requirements Covered: CL01, CL02, CL03, CL04, CL07
Ready for P05: YES
```
