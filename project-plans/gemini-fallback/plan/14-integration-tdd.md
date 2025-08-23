# Plan: Gemini OAuth Fallback

Plan ID: PLAN-20250822-GEMINIFALLBACK
Generated: 2025-08-22
Total Phases: 16
Requirements: REQ-004

# Phase 14: Integration TDD

## Phase ID

`PLAN-20250822-GEMINIFALLBACK.P14`

## Prerequisites

- Required: Phase 13 completed
- Verification: `grep -r "@plan:PLAN-20250822-GEMINIFALLBACK.P13" .`
- Expected files from previous phase:
  - Updated `packages/core/src/code_assist/oauth2.ts` for clipboard integration
  - Updated `packages/cli/src/ui/App.tsx` for provider state detection

## Implementation Tasks

### Files to Modify

- `packages/core/src/code_assist/oauth2.test.ts`
  - Line [N]: Add tests for clipboard copy behavior in OAuth flow (REQ-004.1)
  - Line [N]: Add tests for fallback to console when clipboard fails (REQ-004.1)
  - ADD comment: `@plan:PLAN-20250822-GEMINIFALLBACK.P14`
  - Implements: `@requirement:REQ-004.1`

- `packages/cli/src/ui/App.test.tsx`
  - Line [N]: Add tests for detecting Gemini provider OAuth state (REQ-004.2)
  - Line [N]: Add tests for displaying OAuthCodeDialog for Gemini provider (REQ-004.2)
  - Line [N]: Add tests ensuring backward compatibility with existing providers (REQ-004.2)
  - ADD comment: `@plan:PLAN-20250822-GEMINIFALLBACK.P14`
  - Implements: `@requirement:REQ-004.2`

## Required Code Markers

Every test created in this phase MUST include:

```typescript
/**
 * @plan PLAN-20250822-GEMINIFALLBACK.P14
 * @requirement REQ-004.1
 * @pseudocode lines 1-28
 */
```
or
```typescript
/**
 * @plan PLAN-20250822-GEMINIFALLBACK.P14
 * @requirement REQ-004.2
 * @pseudocode lines 1-28
 */
```

## Implementation Requirements

Write comprehensive BEHAVIORAL tests for integration based on:
- specification.md requirements [REQ-004]
- analysis/pseudocode/oauth-flow.md lines 1-28

### Tests to Create

1. `should integrate clipboard copy behavior with OAuth flow when browser fails` - Tests that the OAuth flow properly integrates with clipboard functionality (REQ-004.1)

2. `should display clean OAuth URL in console when clipboard utilities are unavailable` - Tests that system falls back properly when clipboard is not available (REQ-004.1)

3. `should detect Gemini provider OAuth state in UI` - Tests that CLI App correctly detects when Gemini provider requires OAuth (REQ-004.2)

4. `should display OAuthCodeDialog when Gemini provider requires authentication` - Tests that the UI properly renders the OAuth dialog (REQ-004.2)

5. `should preserve existing Anthropic provider OAuth behavior` - Tests that existing providers continue to work with no regression (REQ-004.2)

6. `should preserve existing Qwen provider OAuth behavior` - Tests that existing providers continue to work with no regression (REQ-004.2)

7. `should handle OAuth flow completion with Gemini provider integration` - Tests that the complete authentication flow works properly (REQ-004.1, REQ-004.2)

Create 7 BEHAVIORAL tests covering:
- Input → Output transformations for each requirement
- End-to-end integration flows
- Backward compatibility verification
- Cross-component interaction testing

Include 30% PROPERTY-BASED tests:
```typescript
test.prop([fc.string(), fc.boolean()])('integrates clipboard functionality with any valid OAuth URL', (url, clipboardAvailable) => {
  // Property-based test implementation
});
```

## Verification Commands

### Automated Checks

```bash
# Check plan markers exist
grep -r "@plan:PLAN-20250822-GEMINIFALLBACK.P14" . | wc -l
# Expected: 7+ occurrences

# Check requirements covered
grep -r "@requirement:REQ-004" . | wc -l
# Expected: 2+ occurrences

# Verify behavioral assertions
grep -r "toBe\|toEqual\|toMatch\|toContain" packages/core/src/code_assist/oauth2.test.ts packages/cli/src/ui/App.test.tsx | wc -l
# Expected: 10+ behavioral assertions

# Check for structure-only testing
grep -r "toHaveProperty\|toBeDefined\|toBeUndefined" packages/core/src/code_assist/oauth2.test.ts packages/cli/src/ui/App.test.tsx
# Should only find tests with specific value assertions

# Run tests - should fail naturally
npm test -- packages/core/src/code_assist/oauth2.test.ts packages/cli/src/ui/App.test.tsx 2>&1 | head -20
# Should see: "Cannot read property 'X' of undefined" or similar natural failures
```

### Manual Verification Checklist

- [ ] Previous phase markers present (integration stub)
- [ ] All tests follow behavioral pattern (no mocks)
- [ ] All tests tagged with plan and requirement IDs
- [ ] Tests verify OAuth flow integration with clipboard service (REQ-004.1)
- [ ] Tests verify CLI App OAuth state detection (REQ-004.2)
- [ ] Tests preserve backward compatibility with existing providers
- [ ] At least 30% of tests are property-based

## Success Criteria

- 7 tests created for integration functionality
- All tests tagged with P14 marker
- Tests fail with natural error messages (not stub-specific messages)
- Tests follow behavior-driven approach with actual input/output assertions
- No reverse testing (tests for NotYetImplemented) patterns
- No mock theater (tests that only verify mocks were called)
- Integration tests verify end-to-end flows between components