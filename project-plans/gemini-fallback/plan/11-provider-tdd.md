# Plan: Gemini OAuth Fallback

Plan ID: PLAN-20250822-GEMINIFALLBACK
Generated: 2025-08-22
Total Phases: 16
Requirements: REQ-003

# Phase 11: Global State Management TDD

## Phase ID

`PLAN-20250822-GEMINIFALLBACK.P11`

## Prerequisites

- Required: Phase 10 completed
- Verification: `grep -r "@plan:PLAN-20250822-GEMINIFALLBACK.P10" .`
- Expected files from previous phase:
  - `packages/core/src/providers/gemini/GeminiProvider.ts` with global state implementation

## Implementation Tasks

### Files to Modify

- `packages/core/src/providers/gemini/GeminiProvider.test.ts`
  - Line [N]: Add tests for setting `__oauth_needs_code = true` (REQ-003.1)
  - Line [N]: Add tests for setting `__oauth_provider = 'gemini'` (REQ-003.2)
  - Line [N]: Add tests for state reset after authentication completion (REQ-003.3)
  - Line [N]: Add tests for state reset after cancellation (REQ-003.3)
  - ADD comment: `@plan:PLAN-20250822-GEMINIFALLBACK.P11`
  - Implements: `@requirement:REQ-003.1`
  - Implements: `@requirement:REQ-003.2`
  - Implements: `@requirement:REQ-003.3`

## Required Code Markers

Every test created in this phase MUST include:

```typescript
/**
 * @plan PLAN-20250822-GEMINIFALLBACK.P11
 * @requirement REQ-003.1
 * @pseudocode lines 13-14
 */
```
or
```typescript
/**
 * @plan PLAN-20250822-GEMINIFALLBACK.P11
 * @requirement REQ-003.2
 * @pseudocode lines 13-14
 */
```
or
```typescript
/**
 * @plan PLAN-20250822-GEMINIFALLBACK.P11
 * @requirement REQ-003.3
 * @pseudocode lines 17-18, 25-26
 */
```

## Implementation Requirements

Write comprehensive BEHAVIORAL tests for global state management based on:
- specification.md requirements [REQ-003]
- analysis/pseudocode/oauth-flow.md lines 12-18 and 21-26

### Tests to Create

1. `should set __oauth_needs_code to true when OAuth flow requires user input` - Tests that the provider properly signals when OAuth code is needed (REQ-003.1)

2. `should set __oauth_provider to 'gemini' for provider identification` - Tests that the provider correctly identifies itself in global state (REQ-003.2)

3. `should reset global state variables after successful authentication` - Tests that state is cleared when authentication completes (REQ-003.3)

4. `should reset global state variables after OAuth flow cancellation` - Tests that state is cleared when user cancels authentication (REQ-003.3)

5. `should maintain global state during active OAuth flow` - Tests that state persists while waiting for verification code (behavioral)

6. `should not interfere with other provider OAuth flows` - Tests that Gemini state changes don't affect other providers (REQ-003.1)

7. `should handle concurrent OAuth requests from different providers` - Tests for multiple provider OAuth flows (REQ-003.1, REQ-003.2)

Create 7 BEHAVIORAL tests covering:
- Input → Output transformations for each requirement
- Global state manipulation and verification
- Integration with OAuth flow lifecycle
- Concurrent execution cases

Include 30% PROPERTY-BASED tests:
```typescript
test.prop([fc.boolean()])('correctly manages global state regardless of initial conditions', (initialState) => {
  // Property-based test implementation
});
```

## Verification Commands

### Automated Checks

```bash
# Check plan markers exist
grep -r "@plan:PLAN-20250822-GEMINIFALLBACK.P11" . | wc -l
# Expected: 7+ occurrences

# Check requirements covered
grep -r "@requirement:REQ-003" packages/core/src/providers/gemini/GeminiProvider.test.ts | wc -l
# Expected: 3+ occurrences

# Verify behavioral assertions
grep -r "toBe\|toEqual\|toMatch\|toContain" packages/core/src/providers/gemini/GeminiProvider.test.ts | wc -l
# Expected: 10+ behavioral assertions

# Check for structure-only testing
grep -r "toHaveProperty\|toBeDefined\|toBeUndefined" packages/core/src/providers/gemini/GeminiProvider.test.ts
# Should only find tests with specific value assertions

# Run tests - should fail naturally
npm test -- packages/core/src/providers/gemini/GeminiProvider.test.ts 2>&1 | head -20
# Should see: "Cannot read property 'X' of undefined" or similar natural failures
```

### Manual Verification Checklist

- [ ] Previous phase markers present (provider stub)
- [ ] All tests follow behavioral pattern (no mocks)
- [ ] All tests tagged with plan and requirement IDs
- [ ] Tests verify proper state setting (REQ-003.1, REQ-003.2)
- [ ] Tests verify state reset behavior (REQ-003.3)
- [ ] Tests verify concurrent OAuth flow handling
- [ ] At least 30% of tests are property-based

## Success Criteria

- 7 tests created for global state management functionality
- All tests tagged with P11 marker
- Tests fail with natural error messages (not stub-specific messages)
- Tests follow behavior-driven approach with actual input/output assertions
- No reverse testing (tests for NotYetImplemented) patterns
- No mock theater (tests that only verify mocks were called)