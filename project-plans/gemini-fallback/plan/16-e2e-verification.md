# Plan: Gemini OAuth Fallback

Plan ID: PLAN-20250822-GEMINIFALLBACK
Generated: 2025-08-22
Total Phases: 16
Requirements: REQ-001, REQ-002, REQ-003, REQ-004, REQ-005, REQ-006

# Phase 16: End-to-End Verification

## Phase ID

`PLAN-20250822-GEMINIFALLBACK.P16`

## Prerequisites

- Required: Phase 15 completed
- Verification: `grep -r "@plan:PLAN-20250822-GEMINIFALLBACK.P15" .`
- Expected files from previous phase:
  - Fully integrated implementation with all components working together

## Implementation Tasks

### Files to Create

- `packages/core/src/providers/gemini/GeminiProvider.e2e.test.ts` - End-to-end tests for Gemini OAuth flow
  - MUST include: `@plan:PLAN-20250822-GEMINIFALLBACK.P16`
  - MUST include: `@requirement:REQ-005.1`
  - MUST include: `@requirement:REQ-005.2`
  - MUST include: `@requirement:REQ-005.3`

- `packages/cli/src/ui/App.e2e.test.tsx` - End-to-end tests for CLI UI OAuth flow
  - MUST include: `@plan:PLAN-20250822-GEMINIFALLBACK.P16`
  - MUST include: `@requirement:REQ-006.1`
  - MUST include: `@requirement:REQ-006.2`
  - MUST include: `@requirement:REQ-006.3`

### Files to Modify

- `packages/core/src/code_assist/oauth2.e2e.test.ts`
  - Line [N]: Add end-to-end tests for clipboard integration in OAuth flow
  - ADD comment: `@plan:PLAN-20250822-GEMINIFALLBACK.P16`
  - Implements: `@requirement:REQ-005.1`
  - Implements: `@requirement:REQ-005.3`

## Required Code Markers

Every test created in this phase MUST include:

```typescript
/**
 * @plan PLAN-20250822-GEMINIFALLBACK.P16
 * @requirement REQ-005.1
 */
```
or
```typescript
/**
 * @plan PLAN-20250822-GEMINIFALLBACK.P16
 * @requirement REQ-005.2
 */
```
or
```typescript
/**
 * @plan PLAN-20250822-GEMINIFALLBACK.P16
 * @requirement REQ-005.3
 */
```
or
```typescript
/**
 * @plan PLAN-20250822-GEMINIFALLBACK.P16
 * @requirement REQ-006.1
 */
```
or
```typescript
/**
 * @plan PLAN-20250822-GEMINIFALLBACK.P16
 * @requirement REQ-006.2
 */
```
or
```typescript
/**
 * @plan PLAN-20250822-GEMINIFALLBACK.P16
 * @requirement REQ-006.3
 */
```

## Implementation Requirements

Write comprehensive END-TO-END tests to verify integrated functionality based on:
- specification.md requirements [REQ-005, REQ-006]
- analysis/pseudocode/oauth-flow.md lines 1-75

### Tests to Create

**GeminiProvider E2E Tests:**

1. `should complete full OAuth flow with clipboard copy when browser fails` - Tests the integrated behavior of Gemini provider with clipboard service (REQ-005.1)

2. `should handle invalid verification codes gracefully with error messaging` - Tests error handling for invalid codes in complete flow (REQ-005.1)

3. `should properly cancel OAuth flow when user presses Escape key` - Tests cancellation handling in complete flow (REQ-005.2)

**App UI E2E Tests:**

4. `should display clear user instructions for clipboard copy behavior` - Tests that the UI clearly informs users about clipboard actions (REQ-006.1)

5. `should guide users through the complete OAuth authentication process` - Tests that the UI provides step-by-step guidance (REQ-006.2)

6. `should ensure security by accepting only pasted verification codes` - Tests that security restrictions are properly maintained in UI (REQ-006.3)

**OAuth2 E2E Tests:**

7. `should coordinate between provider, clipboard service, and UI components` - Tests integration between all components (REQ-005.3)

Create 7 END-TO-END tests covering:
- Complete integrated flows with all components
- Error conditions in integrated context
- User experience validation
- Security behavior verification

Include 30% PROPERTY-BASED tests:
```typescript
test.prop([fc.string(), fc.string(), fc.boolean()])(
  'handles OAuth flow with any valid URL and code combination',
  (authUrl, verificationCode, clipboardAvailable) => {
    // Property-based test implementation
  }
);
```

## Verification Commands

### Automated Checks

```bash
# Check plan markers exist
grep -r "@plan:PLAN-20250822-GEMINIFALLBACK.P16" . | wc -l
# Expected: 7+ occurrences

# Check requirements covered
grep -r "@requirement:REQ-005\|@requirement:REQ-006" . | wc -l
# Expected: 6+ occurrences

# Verify behavioral assertions
grep -r "toBe\|toEqual\|toMatch\|toContain" packages/core/src/providers/gemini/GeminiProvider.e2e.test.ts packages/cli/src/ui/App.e2e.test.tsx packages/core/src/code_assist/oauth2.e2e.test.ts | wc -l
# Expected: 15+ behavioral assertions

# Check for structure-only testing
grep -r "toHaveProperty\|toBeDefined\|toBeUndefined" packages/core/src/providers/gemini/GeminiProvider.e2e.test.ts packages/cli/src/ui/App.e2e.test.tsx packages/core/src/code_assist/oauth2.e2e.test.ts
# Should only find tests with specific value assertions

# Run end-to-end tests
npm test -- --grep "e2e"
# Expected: All tests pass

# Run mutation testing on integration points
npx stryker run --mutate "packages/core/src/code_assist/oauth2.ts,packages/cli/src/ui/App.tsx,packages/cli/src/ui/components/OAuthCodeDialog.tsx,packages/core/src/services/ClipboardService.ts,packages/core/src/providers/gemini/GeminiProvider.ts"
MUTATION_SCORE=$(jq -r '.metrics.mutationScore' .stryker-tmp/reports/mutation-report.json)
if (( $(echo "$MUTATION_SCORE < 80" | bc -l) )); then
  echo "FAIL: Mutation score only $MUTATION_SCORE% (minimum 80%)"
  exit 1
fi

# Verify integration between components
# Tests should verify:
# - Clipboard service integrates with GeminiProvider OAuth flow
# - OAuthCodeDialog displays correct provider-specific instructions
# - App UI correctly detects and displays OAuth state for Gemini provider
# - All components work together in integrated flows
```

### Manual Verification Checklist

- [ ] Previous phase markers present (integration implementation)
- [ ] All E2E tests follow behavioral pattern (no mocks)
- [ ] All tests tagged with plan and requirement IDs
- [ ] Tests verify full integrated OAuth flow (REQ-005.1, REQ-005.3)
- [ ] Tests verify error handling in integrated flows (REQ-005.1)
- [ ] Tests verify user cancellation behavior (REQ-005.2)
- [ ] Tests verify clear user instructions (REQ-006.1, REQ-006.2)
- [ ] Tests verify paste-only security behavior (REQ-006.3)
- [ ] At least 30% of tests are property-based
- [ ] Mutation testing score >= 80%

## Success Criteria

- 7 E2E tests created covering integrated functionality
- All tests tagged with P16 marker
- Tests verify cross-component integration flows
- Tests follow behavior-driven approach with actual input/output assertions
- No mock theater (tests that only verify mocks were called)
- No reverse testing patterns
- Mutation testing score >= 80%