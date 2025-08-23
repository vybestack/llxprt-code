# Plan: Gemini OAuth Fallback

Plan ID: PLAN-20250822-GEMINIFALLBACK
Generated: 2025-08-22
Total Phases: 16
Requirements: REQ-001

# Phase 06: Clipboard Functionality Implementation

## Phase ID

`PLAN-20250822-GEMINIFALLBACK.P06`

## Prerequisites

- Required: Phase 05 completed
- Verification: `grep -r "@plan:PLAN-20250822-GEMINIFALLBACK.P05" .`
- Expected files from previous phase:
  - `packages/core/src/services/ClipboardService.test.ts` with behavioral tests

## Implementation Tasks

### Files to Modify

- `packages/core/src/services/ClipboardService.ts`
  - Line [N]: Implement platform detection logic
  - Line [N]: Implement clipboard copy functionality for macOS (pbcopy)
  - Line [N]: Implement clipboard copy functionality for Linux X11 (xclip)
  - Line [N]: Implement clipboard copy functionality for Linux Wayland (wl-copy)
  - Line [N]: Implement clipboard copy functionality for Windows (clip)
  - Line [N]: Implement fallback behavior to console display
  - ADD comment: `@plan:PLAN-20250822-GEMINIFALLBACK.P06`
  - Implements: `@requirement:REQ-001.1`
  - Implements: `@requirement:REQ-001.2`
  - Implements: `@requirement:REQ-001.3`

## Required Code Markers

Every function created in this phase MUST include:

```typescript
/**
 * @plan PLAN-20250822-GEMINIFALLBACK.P06
 * @requirement REQ-001.1
 * @pseudocode lines 29-30
 */
```
or
```typescript
/**
 * @plan PLAN-20250822-GEMINIFALLBACK.P06
 * @requirement REQ-001.2
 * @pseudocode lines 31-36
 */
```
or
```typescript
/**
 * @plan PLAN-20250822-GEMINIFALLBACK.P06
 * @requirement REQ-001.3
 * @pseudocode lines 11-13, 19-26
 */
```

## Implementation Requirements

Implement clipboard functionality to make ALL tests pass based on requirements from specification.md and pseudocode from analysis/pseudocode/oauth-flow.md:

### Implementation to Follow Pseudocode

Follow pseudocode EXACTLY from analysis/pseudocode/oauth-flow.md:

- Line 29: FUNCTION copyToClipboard(text)
- Line 30: DETECT platform (macOS, Linux, Windows)
- Line 31: SELECT appropriate clipboard utility
- Line 32: macOS: pbcopy
- Line 33: Linux: xclip OR wl-clipboard 
- Line 34: Windows: clip
- Line 35: EXECUTE clipboard utility command with text
- Line 36: RETURN success status

Requirements:
1. Do NOT modify any existing tests
2. UPDATE existing files (no new versions)
3. Implement EXACTLY what pseudocode specifies
4. Reference pseudocode line numbers in comments
5. All tests must pass
6. No console.log or debug code
7. No TODO comments

Platform Detection Implementation:
- macOS: process.platform === 'darwin'
- Linux: process.platform === 'linux' 
- Windows: process.platform === 'win32'

Clipboard Utility Selection:
- macOS: Use pbcopy utility
- Linux X11: Use xclip utility if available
- Linux Wayland: Use wl-copy utility if available
- Windows: Use clip utility

Error Handling Implementation:
- When clipboard utility execution fails:
  - fallback to console display
  - ensure clean formatting without wrapping issues
  - provide clear instructions for manual copying

### Verification Commands

```bash
# Check plan markers exist
grep -r "@plan:PLAN-20250822-GEMINIFALLBACK.P06" . | wc -l
# Expected: 3+ occurrences

# Check requirements covered
grep -r "@requirement:REQ-001" packages/core/src/services/ClipboardService.ts | wc -l
# Expected: 3+ occurrences

# All tests pass
npm test -- packages/core/src/services/ClipboardService.test.ts
# Expected: All tests pass

# No test modifications
git diff test/ | grep -E "^[+-]" | grep -v "^[+-]{3}" && echo "FAIL: Tests modified"

# Verify pseudocode was followed
# Checking implementation against lines 29-36 in analysis/pseudocode/oauth-flow.md

# No debug code
grep -r "console\.\|TODO\|FIXME\|XXX" packages/core/src/services/

# No duplicate files
find packages/core/src/services -name "*V2*" -o -name "*Copy*" && echo "FAIL: Duplicate versions found"
```

## Manual Verification Checklist

- [ ] Previous phase markers present (clipboard TDD)
- [ ] All TDD tests pass after implementation
- [ ] Platform detection implemented correctly
- [ ] Clipboard utility selection and execution implemented
- [ ] Appropriate fallback behavior to console implemented
- [ ] No test modifications made during implementation
- [ ] Files tagged with plan and requirement IDs
- [ ] Implementation follows pseudocode exactly

## Success Criteria

- All clipboard functionality tests pass
- Implementation follows pseudocode exactly by line number
- Cross-platform clipboard copying works
- Fallback to console display works properly when clipboard fails
- No unnecessary console output, debug code, or TODO comments