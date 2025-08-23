# Plan: Gemini OAuth Fallback

Plan ID: PLAN-20250822-GEMINIFALLBACK
Generated: 2025-08-22
Total Phases: 16
Requirements: REQ-003

# Phase 12: Global State Management Implementation

## Phase ID

`PLAN-20250822-GEMINIFALLBACK.P12`

## Prerequisites

- Required: Phase 11 completed
- Verification: `grep -r "@plan:PLAN-20250822-GEMINIFALLBACK.P11" .`
- Expected files from previous phase:
  - `packages/core/src/providers/gemini/GeminiProvider.test.ts` with behavioral tests

## Implementation Tasks

### Files to Modify

- `packages/core/src/providers/gemini/GeminiProvider.ts`
  - Line [N]: Implement setting of `__oauth_needs_code = true` when OAuth flow requires user input
  - Line [N]: Implement setting of `__oauth_provider = 'gemini'` for provider identification
  - Line [N]: Implement state reset after successful authentication
  - Line [N]: Implement state reset after OAuth flow cancellation
  - ADD comment: `@plan:PLAN-20250822-GEMINIFALLBACK.P12`
  - Implements: `@requirement:REQ-003.1`
  - Implements: `@requirement:REQ-003.2`
  - Implements: `@requirement:REQ-003.3`

## Required Code Markers

Every function created in this phase MUST include:

```typescript
/**
 * @plan PLAN-20250822-GEMINIFALLBACK.P12
 * @requirement REQ-003.1
 * @pseudocode lines 13, 21
 */
```
or
```typescript
/**
 * @plan PLAN-20250822-GEMINIFALLBACK.P12
 * @requirement REQ-003.2
 * @pseudocode lines 14, 22
 */
```
or
```typescript
/**
 * @plan PLAN-20250822-GEMINIFALLBACK.P12
 * @requirement REQ-003.3
 * @pseudocode lines 17-18, 25-26
 */
```

## Implementation Requirements

Implement global state management to make ALL tests pass based on requirements from specification.md and pseudocode from analysis/pseudocode/oauth-flow.md:

### Implementation to Follow Pseudocode

Follow pseudocode EXACTLY from analysis/pseudocode/oauth-flow.md:

- Line 13: SET global var __oauth_needs_code = true
- Line 14: SET global var __oauth_provider = 'gemini'
- Line 17: RESET global state variables
- Line 18: RETURN authenticated client
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

Global State Management Implementation:
- When initiating OAuth flow and browser opening fails, set `__oauth_needs_code = true`
- When initiating OAuth flow, set `__oauth_provider = 'gemini'`
- After successful authentication, reset global state variables to initial values
- After OAuth flow cancellation, reset global state variables to initial values
- Ensure state persistence during active flow (while waiting for verification code)
- Ensure no interference with other provider OAuth flows

### Verification Commands

```bash
# Check plan markers exist
grep -r "@plan:PLAN-20250822-GEMINIFALLBACK.P12" . | wc -l
# Expected: 3+ occurrences

# Check requirements covered
grep -r "@requirement:REQ-003" packages/core/src/providers/gemini/GeminiProvider.ts | wc -l
# Expected: 3+ occurrences

# All tests pass
npm test -- packages/core/src/providers/gemini/GeminiProvider.test.ts
# Expected: All tests pass

# No test modifications
git diff test/ | grep -E "^[+-]" | grep -v "^[+-]{3}" && echo "FAIL: Tests modified"

# Verify pseudocode was followed
# Checking implementation against lines 12-18 and 21-26 in analysis/pseudocode/oauth-flow.md

# No debug code
grep -r "console\.\|TODO\|FIXME\|XXX" packages/core/src/providers/gemini/GeminiProvider.ts && echo "FAIL: Debug code found"

# No duplicate files
find packages/core/src/providers/gemini -name "*V2*" -o -name "*Copy*" && echo "FAIL: Duplicate versions found"
```

## Manual Verification Checklist

- [ ] Previous phase markers present (provider TDD)
- [ ] All TDD tests pass after implementation
- [ ] Global state setting implemented for OAuth initiation
- [ ] Global state reset implemented for successful authentication
- [ ] Global state reset implemented for OAuth cancellation
- [ ] No test modifications made during implementation
- [ ] Files tagged with plan and requirement IDs
- [ ] Implementation follows pseudocode exactly

## Success Criteria

- All global state management tests pass
- Implementation follows pseudocode exactly by line number
- Global state variables properly set and reset
- No interference with other providers' OAuth flows
- No unnecessary console output, debug code, or TODO comments