# Plan: Gemini OAuth Fallback

Plan ID: PLAN-20250822-GEMINIFALLBACK
Generated: 2025-08-22
Total Phases: 16
Requirements: REQ-004

# Phase 15: Integration Implementation

## Phase ID

`PLAN-20250822-GEMINIFALLBACK.P15`

## Prerequisites

- Required: Phase 14 completed
- Verification: `grep -r "@plan:PLAN-20250822-GEMINIFALLBACK.P14" .`
- Expected files from previous phase:
  - Updated tests for integration functionality

## Implementation Tasks

### Files to Modify

- `packages/core/src/code_assist/oauth2.ts`
  - Line [N]: Integrate clipboard copy behavior with OAuth flow
  - Line [N]: Implement fallback to console when clipboard utilities are unavailable
  - ADD comment: `@plan:PLAN-20250822-GEMINIFALLBACK.P15`
  - Implements: `@requirement:REQ-004.1`

- `packages/cli/src/ui/App.tsx`
  - Line [N]: Implement detection of Gemini provider OAuth state
  - Line [N]: Implement rendering of OAuthCodeDialog for Gemini provider
  - ADD comment: `@plan:PLAN-20250822-GEMINIFALLBACK.P15`
  - Implements: `@requirement:REQ-004.2`

## Required Code Markers

Every function created in this phase MUST include:

```typescript
/**
 * @plan PLAN-20250822-GEMINIFALLBACK.P15
 * @requirement REQ-004.1
 * @pseudocode lines 5-10, 19-26
 */
```
or
```typescript
/**
 * @plan PLAN-20250822-GEMINIFALLBACK.P15
 * @requirement REQ-004.2
 * @pseudocode lines 12-18, 21-23
 */
```

## Implementation Requirements

Implement full integration to make ALL tests pass based on requirements from specification.md:

### Implementation to Follow Pseudocode

Follow pseudocode EXACTLY from analysis/pseudocode/oauth-flow.md:

- Line 5: ELSE IF token is 'USE_LOGIN_WITH_GOOGLE'
- Line 6: CALL createCodeAssistContentGenerator() to get authUrl
- Line 7: TRY to open browser with authUrl
- Line 8: CALL openBrowserSecurely(authUrl)
- Line 9: RETURN authenticated client for normal flow
- Line 10: CATCH browser opening error
- Line 11: CALL copyToClipboard(authUrl)
- Line 12: IF clipboard copy succeeds
- Line 13: SET global var __oauth_needs_code = true
- Line 14: SET global var __oauth_provider = 'gemini'
- Line 15: WAIT for verification code submission from dialog
- Line 16: CALL exchangeCodeForTokens(verificationCode)
- Line 17: RESET global state variables
- Line 18: RETURN authenticated client
- Line 19: ELSE
- Line 20: PRINT authUrl to console in clean format
- Line 21: SET global var __oauth_needs_code = true
- Line 22: SET global var __oauth_provider = 'gemini'
- Line 23: WAIT for verification code submission from dialog
- Line 24: CALL exchangeCodeForTokens(verificationCode)
- Line 25: RESET global state variables
- Line 26: RETURN authenticated client

Requirements:
1. Do NOT modify any existing tests
2. UPDATE existing files (no new versions)
3. Implement EXACTLY what pseudocode specifies
4. Reference pseudocode line numbers in comments
5. All tests must pass
6. No console.log or debug code
7. No TODO comments

### Implementation Details

Integration Implementation:
- Modify oauth2.ts to properly integrate clipboard service with OAuth flow
- Ensure clean OAuth URL copying without decoration characters
- Implement proper fallback to console when clipboard fails
- Ensure formatting of console URL is clean and not wrapped across lines
- Modify App.tsx to detect Gemini provider OAuth state correctly
- Ensure OAuthCodeDialog renders properly for Gemini provider authentication
- Preserve backward compatibility with existing Anthropic/Qwen providers

### Verification Commands

```bash
# Check plan markers exist
grep -r "@plan:PLAN-20250822-GEMINIFALLBACK.P15" . | wc -l
# Expected: 3+ occurrences

# Check requirements covered
grep -r "@requirement:REQ-004" . | wc -l
# Expected: 2+ occurrences

# All tests pass
npm test -- packages/core/src/code_assist/oauth2.test.ts packages/cli/src/ui/App.test.tsx
# Expected: All tests pass

# No test modifications
git diff test/ | grep -E "^[+-]" | grep -v "^[+-]{3}" && echo "FAIL: Tests modified"

# Verify pseudocode was followed
# Checking implementation against lines 5-26 in analysis/pseudocode/oauth-flow.md

# No debug code
grep -r "console\.\|TODO\|FIXME\|XXX" packages/core/src/code_assist/oauth2.ts packages/cli/src/ui/App.tsx && echo "FAIL: Debug code found"

# No duplicate files
find packages/core/src/code_assist packages/cli/src/ui -name "*V2*" -o -name "*Copy*" && echo "FAIL: Duplicate versions found"
```

## Manual Verification Checklist

- [ ] Previous phase markers present (integration TDD)
- [ ] All TDD tests pass after implementation
- [ ] OAuth flow properly integrates with clipboard service
- [ ] Clean console fallback behavior implemented when clipboard fails
- [ ] CLI App correctly detects and displays dialog for Gemini provider
- [ ] Backward compatibility with existing providers preserved
- [ ] No test modifications made during implementation
- [ ] Files tagged with plan and requirement IDs
- [ ] Implementation follows pseudocode exactly

## Success Criteria

- All integration tests pass
- Implementation follows pseudocode exactly by line number
- OAuth flow properly integrates clipboard copying
- CLI App correctly handles Gemini provider OAuth state
- No unnecessary console output, debug code, or TODO comments
- Backward compatibility with existing providers maintained