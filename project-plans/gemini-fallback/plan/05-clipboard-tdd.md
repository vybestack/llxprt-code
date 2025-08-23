# Plan: Gemini OAuth Fallback

Plan ID: PLAN-20250822-GEMINIFALLBACK
Generated: 2025-08-22
Total Phases: 16
Requirements: REQ-001

# Phase 05: Clipboard Functionality TDD

## Phase ID

`PLAN-20250822-GEMINIFALLBACK.P05`

## Prerequisites

- Required: Phase 04 completed
- Verification: `grep -r "@plan:PLAN-20250822-GEMINIFALLBACK.P04" .`
- Expected files from previous phase:
  - `packages/core/src/services/ClipboardService.ts`
  - `packages/core/src/services/ClipboardService.test.ts`

## Implementation Tasks

### Files to Modify

- `packages/core/src/services/ClipboardService.test.ts`
  - Line [N]: Add comprehensive behavioral tests for clipboard operations (REQ-001.1)
  - Line [N]: Add cross-platform tests for pbcopy, xclip, wl-clipboard, and clip (REQ-001.2)
  - Line [N]: Add fallback behavior tests when clipboard utilities are unavailable (REQ-001.3)
  - ADD comment: `@plan:PLAN-20250822-GEMINIFALLBACK.P05`
  - Implements: `@requirement:REQ-001.1`
  - Implements: `@requirement:REQ-001.2`
  - Implements: `@requirement:REQ-001.3`

## Required Code Markers

Every test created in this phase MUST include:

```typescript
/**
 * @plan PLAN-20250822-GEMINIFALLBACK.P05
 * @requirement REQ-001.1
 * @pseudocode lines 29-37
 */
```
or
```typescript
/**
 * @plan PLAN-20250822-GEMINIFALLBACK.P05
 * @requirement REQ-001.2
 * @pseudocode lines 32-34
 */
```
or
```typescript
/**
 * @plan PLAN-20250822-GEMINIFALLBACK.P05
 * @requirement REQ-001.3
 * @pseudocode lines 20-26
 */
```

## Implementation Requirements

Write comprehensive BEHAVIORAL tests for clipboard functionality based on:
- specification.md requirements [REQ-001]
- analysis/pseudocode/oauth-flow.md lines 29-37

### Tests to Create

1. `should copy OAuth URL to clipboard cleanly without extra characters` - Tests that the OAuth URL is copied to clipboard without any decoration characters (REQ-001.1)

2. `should detect and use correct clipboard utility for macOS (pbcopy)` - Tests that on macOS systems, pbcopy is used for clipboard operations (REQ-001.2)

3. `should detect and use correct clipboard utility for Linux X11 (xclip)` - Tests that on Linux with X11, xclip is used for clipboard operations (REQ-001.2)

4. `should detect and use correct clipboard utility for Linux Wayland (wl-copy)` - Tests that on Linux with Wayland, wl-copy is used for clipboard operations (REQ-001.2)

5. `should detect and use correct clipboard utility for Windows (clip)` - Tests that on Windows systems, clip is used for clipboard operations (REQ-001.2)

6. `should handle clipboard copy failure gracefully with fallback to console` - Tests that when clipboard copy fails, the system falls back properly to console display (REQ-001.3)

7. `should provide clean console output when clipboard fails` - Tests that the console URL display has no wrapping issues or decoration characters (REQ-001.3)

Create 7 BEHAVIORAL tests covering:
- Input → Output transformations for each requirement
- Cross-platform clipboard behavior testing
- Error conditions with specific error types/messages
- Integration with OAuth flow
- Fallback behavior verification

Include 30% PROPERTY-BASED tests:
```typescript
test.prop([fc.string()])('handles any valid URL string', (url) => {
  // Property-based test implementation
});
```

## Verification Commands

### Automated Checks

```bash
# Check plan markers exist
grep -r "@plan:PLAN-20250822-GEMINIFALLBACK.P05" . | wc -l
# Expected: 7+ occurrences

# Check requirements covered
grep -r "@requirement:REQ-001" packages/core/src/services/ClipboardService.test.ts | wc -l
# Expected: 3+ occurrences

# Verify behavioral assertions
grep -r "toBe\|toEqual\|toMatch\|toContain" packages/core/src/services/ClipboardService.test.ts | wc -l
# Expected: 10+ behavioral assertions

# Check for structure-only testing
grep -r "toHaveProperty\|toBeDefined\|toBeUndefined" packages/core/src/services/ClipboardService.test.ts
# Should only find tests with specific value assertions

# Run tests - should fail naturally
npm test -- packages/core/src/services/ClipboardService.test.ts 2>&1 | head -20
# Should see: "Cannot read property 'X' of undefined" or similar natural failures
```

### Manual Verification Checklist

- [ ] Previous phase markers present (clipboard stub)
- [ ] All tests follow behavioral pattern (no mocks)
- [ ] All tests tagged with plan and requirement IDs
- [ ] Tests include provider-specific verification (REQ-001.1)
- [ ] Tests cover all platforms (REQ-001.2)
- [ ] Tests verify fallback behavior when clipboard fails (REQ-001.3)
- [ ] At least 30% of tests are property-based

## Success Criteria

- 7 tests created for clipboard functionality
- All tests tagged with P05 marker
- Tests fail with natural error messages (not stub-specific messages)
- Tests follow behavior-driven approach with actual input/output assertions
- No reverse testing (tests for NotYetImplemented) patterns
- No mock theater (tests that only verify mocks were called)