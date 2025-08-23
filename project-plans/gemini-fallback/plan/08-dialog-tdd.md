# Plan: Gemini OAuth Fallback

Plan ID: PLAN-20250822-GEMINIFALLBACK
Generated: 2025-08-22
Total Phases: 16
Requirements: REQ-002, REQ-006

# Phase 08: OAuth Code Dialog TDD

## Phase ID

`PLAN-20250822-GEMINIFALLBACK.P08`

## Prerequisites

- Required: Phase 07 completed
- Verification: `grep -r "@plan:PLAN-20250822-GEMINIFALLBACK.P07" .`
- Expected files from previous phase:
  - `packages/cli/src/ui/components/OAuthCodeDialog.tsx` with provider-specific messaging

## Implementation Tasks

### Files to Modify

- `packages/cli/src/ui/components/OAuthCodeDialog.test.tsx`
  - Line [N]: Add tests for provider-specific instructions for Gemini (REQ-002.1)
  - Line [N]: Add tests for paste-only input field (REQ-002.2, REQ-006.3)
  - Line [N]: Add tests for Escape key handling (REQ-002.3)
  - Line [N]: Add tests for normal Anthropic/Qwen behavior to ensure no regression
  - ADD comment: `@plan:PLAN-20250822-GEMINIFALLBACK.P08`
  - Implements: `@requirement:REQ-002.1`
  - Implements: `@requirement:REQ-002.2`
  - Implements: `@requirement:REQ-002.3`
  - Implements: `@requirement:REQ-006.3`

## Required Code Markers

Every test created in this phase MUST include:

```typescript
/**
 * @plan PLAN-20250822-GEMINIFALLBACK.P08
 * @requirement REQ-002.1
 * @pseudocode lines 38-45, 60-65
 */
```
or
```typescript
/**
 * @plan PLAN-20250822-GEMINIFALLBACK.P08
 * @requirement REQ-002.2, REQ-006.3
 * @pseudocode lines 46-65
 */
```
or
```typescript
/**
 * @plan PLAN-20250822-GEMINIFALLBACK.P08
 * @requirement REQ-002.3
 * @pseudocode lines 47-49
 */
```

## Implementation Requirements

Write comprehensive BEHAVIORAL tests for OAuth code dialog based on:
- specification.md requirements [REQ-002, REQ-006]
- analysis/pseudocode/oauth-flow.md lines 38-66

### Tests to Create

1. `should display provider-specific instructions for Gemini OAuth flow` - Tests that the dialog shows appropriate instructions for Gemini provider (REQ-002.1)

2. `should display provider-specific instructions for Anthropic OAuth flow` - Tests that the dialog continues to show appropriate instructions for Anthropic provider (REQ-002.1)

3. `should display provider-specific instructions for Qwen OAuth flow` - Tests that the dialog continues to show appropriate instructions for Qwen provider (REQ-002.1)

4. `should accept only pasted input for security code entry` - Tests that the input field only accepts pasted content, not typed characters (REQ-002.2, REQ-006.3)

5. `should close dialog when Escape key is pressed` - Tests that the dialog properly handles cancellation with Escape key (REQ-002.3)

6. `should submit verification code when Return key is pressed` - Tests that the dialog properly handles code submission (REQ-006.2)

7. `should filter invalid characters from pasted verification code` - Tests that only valid OAuth code characters are preserved when pasting (REQ-006.1)

Create 7 BEHAVIORAL tests covering:
- Input → Output transformations for each requirement
- Provider-specific messaging
- Security-focused input handling
- Dialog interaction flows

Include 30% PROPERTY-BASED tests:
```typescript
test.prop([fc.string()])('filters any pasted text to valid OAuth characters', (pastedText) => {
  // Property-based test implementation
});
```

## Verification Commands

### Automated Checks

```bash
# Check plan markers exist
grep -r "@plan:PLAN-20250822-GEMINIFALLBACK.P08" . | wc -l
# Expected: 7+ occurrences

# Check requirements covered
grep -r "@requirement:REQ-002\|@requirement:REQ-006" packages/cli/src/ui/components/OAuthCodeDialog.test.tsx | wc -l
# Expected: 5+ occurrences

# Verify behavioral assertions
grep -r "toBe\|toEqual\|toMatch\|toContain" packages/cli/src/ui/components/OAuthCodeDialog.test.tsx | wc -l
# Expected: 10+ behavioral assertions

# Check for structure-only testing
grep -r "toHaveProperty\|toBeDefined\|toBeUndefined" packages/cli/src/ui/components/OAuthCodeDialog.test.tsx
# Should only find tests with specific value assertions

# Run tests - should fail naturally
npm test -- packages/cli/src/ui/components/OAuthCodeDialog.test.tsx 2>&1 | head -20
# Should see: "Cannot read property 'X' of undefined" or similar natural failures
```

### Manual Verification Checklist

- [ ] Previous phase markers present (OAuth code dialog stub)
- [ ] All tests follow behavioral pattern (no mocks)
- [ ] All tests tagged with plan and requirement IDs
- [ ] Tests verify provider-specific instructions for all providers
- [ ] Tests verify paste-only input behavior (REQ-002.2, REQ-006.3)
- [ ] Tests verify Escape key handling (REQ-002.3)
- [ ] At least 30% of tests are property-based

## Success Criteria

- 7 tests created for OAuth code dialog functionality
- All tests tagged with P08 marker
- Tests fail with natural error messages (not stub-specific messages)
- Tests follow behavior-driven approach with actual input/output assertions
- No reverse testing (tests for NotYetImplemented) patterns
- No mock theater (tests that only verify mocks were called)
- Tests verify both Gemini-specific and existing provider behaviors