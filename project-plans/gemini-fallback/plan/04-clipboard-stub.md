# Plan: Gemini OAuth Fallback

Plan ID: PLAN-20250822-GEMINIFALLBACK
Generated: 2025-08-22
Total Phases: 16
Requirements: REQ-001, REQ-002, REQ-003, REQ-004, REQ-005, REQ-006

# Phase 04: Clipboard Functionality Stub

## Phase ID

`PLAN-20250822-GEMINIFALLBACK.P04`

## Prerequisites

- Required: Phase 03 completed
- Verification: `grep -r "@plan:PLAN-20250822-GEMINIFALLBACK.P03" .`
- Expected files from previous phase: 
  - `analysis/pseudocode/oauth-flow.md`

## Implementation Tasks

### Files to Create

- `packages/core/src/services/ClipboardService.ts` - Cross-platform clipboard utility wrapper
  - MUST include: `@plan:PLAN-20250822-GEMINIFALLBACK.P04`
  - MUST include: `@requirement:REQ-001.1`
  - MUST include: `@requirement:REQ-001.2`
  - MUST include: `@requirement:REQ-001.3`

- `packages/core/src/services/ClipboardService.test.ts` - Unit tests for clipboard functionality
  - MUST include: `@plan:PLAN-20250822-GEMINIFALLBACK.P04`
  - MUST include: `@requirement:REQ-001.1`
  - MUST include: `@requirement:REQ-001.2`
  - MUST include: `@requirement:REQ-001.3`

### Files to Modify

- `packages/core/src/providers/gemini/GeminiProvider.ts`
  - Line [N]: Add import for ClipboardService
  - ADD comment: `@plan:PLAN-20250822-GEMINIFALLBACK.P04`
  - Implements: `@requirement:REQ-001.1`
  - Implements: `@requirement:REQ-001.2`
  - Implements: `@requirement:REQ-001.3`

- `packages/core/src/code_assist/oauth2.ts`
  - Line [N]: Add import for ClipboardService
  - Line [N]: Modify OAuth URL display to work with clipboard functionality
  - ADD comment: `@plan:PLAN-20250822-GEMINIFALLBACK.P04`
  - Implements: `@requirement:REQ-001.3`

## Required Code Markers

Every function/class/test created in this phase MUST include:

```typescript
/**
 * @plan PLAN-20250822-GEMINIFALLBACK.P04
 * @requirement REQ-001.1, REQ-001.2, REQ-001.3
 * @pseudocode lines 29-37
 */
```

## Verification Commands

### Automated Checks

```bash
# Check plan markers exist
grep -r "@plan:PLAN-20250822-GEMINIFALLBACK.P04" . | wc -l
# Expected: 4+ occurrences

# Check requirements covered
grep -r "@requirement:REQ-001" packages/core/src/services/ClipboardService* | wc -l
# Expected: 3+ occurrences

# Compilation check
npm run typecheck
# Expected: No TypeScript errors
```

### Manual Verification Checklist

- [ ] Phase 03 markers present (pseudocode)
- [ ] ClipboardService file created with basic structure
- [ ] ClipboardService.test.ts file created with basic test structure
- [ ] GeminiProvider imports ClipboardService
- [ ] GeminiProvider modified to work with clipboard functionality
- [ ] oauth2.ts imports ClipboardService
- [ ] oauth2.ts modified for fallback behavior
- [ ] All files tagged with plan and requirement IDs
- [ ] TypeScript compiles without errors

## Success Criteria

- All verification commands return expected results
- No phases skipped in sequence
- Plan markers traceable in codebase
- Files compile with strict TypeScript
- ClipboardService class with basic structure