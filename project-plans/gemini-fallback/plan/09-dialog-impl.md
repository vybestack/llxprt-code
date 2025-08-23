# Plan: Gemini OAuth Fallback

Plan ID: PLAN-20250822-GEMINIFALLBACK
Generated: 2025-08-22
Total Phases: 16
Requirements: REQ-002, REQ-006

# Phase 09: OAuth Code Dialog Implementation

## Phase ID

`PLAN-20250822-GEMINIFALLBACK.P09`

## Prerequisites

- Required: Phase 08 completed
- Verification: `grep -r "@plan:PLAN-20250822-GEMINIFALLBACK.P08" .`
- Expected files from previous phase:
  - `packages/cli/src/ui/components/OAuthCodeDialog.test.tsx` with behavioral tests

## Implementation Tasks

### Files to Modify

- `packages/cli/src/ui/components/OAuthCodeDialog.tsx`
  - Line [N]: Implement provider-specific messaging for Gemini OAuth flow
  - Line [N]: Ensure existing Anthropic/Qwen messaging continues to work
  - Line [N]: Preserve security-focused paste-only input behavior
  - ADD comment: `@plan:PLAN-20250822-GEMINIFALLBACK.P09`
  - Implements: `@requirement:REQ-002.1`
  - Implements: `@requirement:REQ-006.2`

## Required Code Markers

Every function created in this phase MUST include:

```typescript
/**
 * @plan PLAN-20250822-GEMINIFALLBACK.P09
 * @requirement REQ-002.1
 * @pseudocode lines 38-45
 */
```
or
```typescript
/**
 * @plan PLAN-20250822-GEMINIFALLBACK.P09
 * @requirement REQ-006.2
 * @pseudocode lines 52-58
 */
```

## Implementation Requirements

Implement OAuth code dialog to make ALL tests pass based on requirements from specification.md and pseudocode from analysis/pseudocode/oauth-flow.md:

### Implementation to Follow Pseudocode

Follow pseudocode EXACTLY from analysis/pseudocode/oauth-flow.md:

- Line 38: FUNCTION handleOAuthCodeDialog(provider, onClose, onSubmit)
- Line 39: RENDER dialog component with provider-specific instructions
- Line 40: IF provider === 'gemini'
- Line 41: DISPLAY instructions about clipboard copy and browser paste
- Line 42: ELSE
- Line 43: DISPLAY standard instructions for authorize in browser
- Line 44: END IF
- Line 46: HANDLE input events:
- Line 47: IF key is Escape
- Line 48: CALL onClose() 
- Line 49: RETURN
- Line 50: END IF
- Line 52: IF key is Return
- Line 53: IF code input is valid
- Line 54: CALL onSubmit(code)
- Line 55: CALL onClose()
- Line 56: END IF
- Line 57: RETURN
- Line 58: END IF
- Line 60: IF key is paste operation
- Line 61: FILTER paste content to valid OAuth code characters
- Line 62: UPDATE code state with filtered content
- Line 63: RETURN
- Line 64: END IF

Requirements:
1. Do NOT modify any existing tests
2. UPDATE existing files (no new versions)
3. Implement EXACTLY what pseudocode specifies
4. Reference pseudocode line numbers in comments
5. All tests must pass
6. No console.log or debug code
7. No TODO comments

### Implementation Details

OAuth Code Dialog Enhancement Implementation:
- Implement provider-specific messaging function to return appropriate instructions
- For Gemini provider, return instructions about clipboard copy and browser paste
- For Anthropic/Qwen providers, return standard authorization instructions
- Maintain paste-only input field for security (no typed character input)
- Keep existing Escape key handling for dialog cancellation
- Keep existing Return key handling for code submission
- Implement character filtering for pasted verification codes

### Verification Commands

```bash
# Check plan markers exist
grep -r "@plan:PLAN-20250822-GEMINIFALLBACK.P09" . | wc -l
# Expected: 2+ occurrences

# Check requirements covered
grep -r "@requirement:REQ-002.1\|@requirement:REQ-006.2" packages/cli/src/ui/components/OAuthCodeDialog.tsx | wc -l
# Expected: 2 occurrences

# All tests pass
npm test -- packages/cli/src/ui/components/OAuthCodeDialog.test.tsx
# Expected: All tests pass

# No test modifications
git diff test/ | grep -E "^[+-]" | grep -v "^[+-]{3}" && echo "FAIL: Tests modified"

# Verify pseudocode was followed
# Checking implementation against lines 38-65 in analysis/pseudocode/oauth-flow.md

# No debug code
grep -r "console\.\|TODO\|FIXME\|XXX" packages/cli/src/ui/components/OAuthCodeDialog.tsx && echo "FAIL: Debug code found"

# No duplicate files
find packages/cli/src/ui/components -name "*V2*" -o -name "*Copy*" && echo "FAIL: Duplicate versions found"
```

## Manual Verification Checklist

- [ ] Previous phase markers present (OAuth code dialog TDD)
- [ ] All TDD tests pass after implementation
- [ ] Provider-specific messaging implemented for Gemini flow
- [ ] Existing provider messaging preserved
- [ ] Paste-only input behavior maintained
- [ ] Escape key handling preserved
- [ ] Return key handling preserved
- [ ] Character filtering for pasted content implemented
- [ ] No test modifications made during implementation
- [ ] Files tagged with plan and requirement IDs
- [ ] Implementation follows pseudocode exactly

## Success Criteria

- All OAuth code dialog tests pass
- Implementation follows pseudocode exactly by line number
- Provider-specific instructions display correctly
- Security-focused paste-only input field preserved
- Dialog interaction behavior works properly
- No unnecessary console output, debug code, or TODO comments