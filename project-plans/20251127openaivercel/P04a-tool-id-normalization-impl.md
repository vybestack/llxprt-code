# Phase 4a: Tool ID Normalization Implementation (TDD GREEN)

## Phase ID

`PLAN-20251127-OPENAIVERCEL.P04a`

## Prerequisites

- Required: Phase 4 completed
- Verification: `npm run test -- packages/core/src/providers/openai-vercel/__tests__/toolIdNormalization.test.ts` fails with expected errors
- Expected files from previous phase: `toolIdNormalization.test.ts`
- Preflight verification: Phase 0.5 MUST be completed before any implementation phase

## Overview

This phase implements the tool ID normalization utility functions to make all tests from Phase 4 pass. Following TDD GREEN phase, we write only enough code to satisfy the failing tests.

## Requirements Implemented (Expanded)

### REQ-OAV-004: Tool ID Normalization

**Full Text**: Tool IDs must be normalized between internal history format and OpenAI API format
**Implementation**:
- Create `normalizeToOpenAIToolId` function
- Create `normalizeToHistoryToolId` function
- Ensure round-trip conversion preserves IDs

## Pseudocode Reference

Implementation follows `analysis/pseudocode/001-tool-id-normalization.md`:
- **normalizeToOpenAIToolId**: Per pseudocode lines 001-021
- **normalizeToHistoryToolId**: Per pseudocode lines 030-050
- **Round-trip invariant**: Per pseudocode lines 060-065
- **Edge cases**: Per pseudocode lines 070-080

## Implementation Code

### File: `packages/core/src/providers/openai-vercel/utils.ts`

```typescript
// @plan:PLAN-20251127-OPENAIVERCEL.P04a
// @requirement:REQ-OAV-004
// @pseudocode:001-tool-id-normalization.md lines 001-080

/**
 * Normalizes any tool ID format to OpenAI-compatible format (call_* prefix).
 * 
 * Per pseudocode lines 001-021:
 * - IDs already in call_ format pass through unchanged (lines 003-004)
 * - hist_tool_ prefix is replaced with call_ (lines 008-010)
 * - toolu_ prefix is replaced with call_ (lines 014-016)
 * - Unknown formats get call_ prepended (lines 019-020)
 * 
 * @param id - Tool ID in any format (hist_tool_, call_, toolu_, or unknown)
 * @returns Tool ID with call_ prefix
 */
export function normalizeToOpenAIToolId(id: string): string {
  // Per pseudocode lines 003-004: Already in OpenAI format - return unchanged
  if (id.startsWith('call_')) {
    return id;
  }
  
  // Per pseudocode lines 008-010: Convert from history format
  if (id.startsWith('hist_tool_')) {
    const uuid = id.slice('hist_tool_'.length);
    return 'call_' + uuid;
  }
  
  // Per pseudocode lines 014-016: Convert from Anthropic format
  if (id.startsWith('toolu_')) {
    const uuid = id.slice('toolu_'.length);
    return 'call_' + uuid;
  }
  
  // Per pseudocode lines 019-020: Unknown format - prefix with call_
  return 'call_' + id;
}

/**
 * Normalizes any tool ID format to internal history format (hist_tool_* prefix).
 * 
 * Per pseudocode lines 030-050:
 * - IDs already in hist_tool_ format pass through unchanged (lines 032-033)
 * - call_ prefix is replaced with hist_tool_ (lines 037-039)
 * - toolu_ prefix is replaced with hist_tool_ (lines 043-045)
 * - Unknown formats get hist_tool_ prepended (lines 048-049)
 * 
 * @param id - Tool ID in any format (call_, hist_tool_, toolu_, or unknown)
 * @returns Tool ID with hist_tool_ prefix
 */
export function normalizeToHistoryToolId(id: string): string {
  // Per pseudocode lines 032-033: Already in history format - return unchanged
  if (id.startsWith('hist_tool_')) {
    return id;
  }
  
  // Per pseudocode lines 037-039: Convert from OpenAI format
  if (id.startsWith('call_')) {
    const uuid = id.slice('call_'.length);
    return 'hist_tool_' + uuid;
  }
  
  // Per pseudocode lines 043-045: Convert from Anthropic format
  if (id.startsWith('toolu_')) {
    const uuid = id.slice('toolu_'.length);
    return 'hist_tool_' + uuid;
  }
  
  // Per pseudocode lines 048-049: Unknown format - prefix with hist_tool_
  return 'hist_tool_' + id;
}
```

## Verification Commands

### Automated Checks

```bash
# Check plan markers exist
grep -c "@plan:PLAN-20251127-OPENAIVERCEL.P04a" packages/core/src/providers/openai-vercel/utils.ts

# Check pseudocode references
grep "@pseudocode" packages/core/src/providers/openai-vercel/utils.ts

# Run tests (expect PASS - TDD GREEN phase)
npm run test -- packages/core/src/providers/openai-vercel/__tests__/toolIdNormalization.test.ts
```

### Semantic Verification Checklist

Answer these 5 questions to verify the feature actually works:

1. **Does INPUT -> OUTPUT work as specified?**
   - [ ] `hist_tool_abc123` -> `call_abc123` (normalizeToOpenAIToolId)
   - [ ] `call_abc123` -> `hist_tool_abc123` (normalizeToHistoryToolId)

2. **Can I trigger this behavior manually?**
   - [ ] Write a simple script that imports and calls the functions
   - [ ] Verify output matches expected format

3. **What happens with edge cases?**
   - [ ] Empty string: produces `call_` or `hist_tool_`
   - [ ] Already-normalized ID: passes through unchanged
   - [ ] Unknown format: gets appropriate prefix

4. **Does round-trip conversion preserve the ID?**
   - [ ] `call_x` -> `hist_tool_x` -> `call_x` (returns original)
   - [ ] `hist_tool_x` -> `call_x` -> `hist_tool_x` (returns original)

5. **Does this integrate with the rest of the system?**
   - [ ] Functions are exported from utils.ts
   - [ ] Can be imported by OpenAIVercelProvider

### Structural Verification Checklist

- [ ] File created at correct path
- [ ] Plan markers present (`@plan:PLAN-20251127-OPENAIVERCEL.P04a`)
- [ ] Requirement markers present (`@requirement:REQ-OAV-004`)
- [ ] Pseudocode references present (`@pseudocode:001-tool-id-normalization.md`)
- [ ] All P04 tests PASS
- [ ] No deferred implementation markers

## Success Criteria

- All tool ID normalization tests from P04 PASS
- Both functions are exported from utils.ts
- Functions handle all documented edge cases
- Type checking passes (`npm run typecheck`)

## Fraud Prevention Checklist (TDD GREEN Phase)

Before marking this phase complete, verify:

- [ ] Implementation is MINIMAL to pass tests (no extra features)
- [ ] All P04 tests now PASS (TDD Green)
- [ ] No implementation code was written BEFORE tests
- [ ] No logic that isn't covered by a test
- [ ] Type checking passes

### Anti-Pattern Detection

```bash
# Check for deferred implementation markers
grep -rn -E "(TODO|FIXME|HACK|STUB|XXX|TEMPORARY|TEMP|WIP)" packages/core/src/providers/openai-vercel/utils.ts
# Expected: No matches

# Check for cop-out comments
grep -rn -E "(in a real|in production|ideally|for now|placeholder)" packages/core/src/providers/openai-vercel/utils.ts
# Expected: No matches

# Verify tests pass
npm run test -- packages/core/src/providers/openai-vercel/__tests__/toolIdNormalization.test.ts
# Expected: All pass
```

## Failure Recovery

If this phase fails:
1. Review test error messages
2. Check string manipulation logic
3. Verify prefix detection with startsWith
4. Update implementation to match test expectations

## Related Files

- `packages/core/src/providers/openai-vercel/__tests__/toolIdNormalization.test.ts`
- `analysis/pseudocode/001-tool-id-normalization.md`

## Phase State Tracking

**Phase State**: `NOT_STARTED` | `IN_PROGRESS` | `BLOCKED` | `COMPLETED`

**Current State**: `NOT_STARTED`

**State Transitions**:
- [ ] NOT_STARTED -> IN_PROGRESS: When implementation begins
- [ ] IN_PROGRESS -> BLOCKED: If unexpected test failures
- [ ] IN_PROGRESS -> COMPLETED: When all P04 tests PASS (TDD Green)
- [ ] BLOCKED -> IN_PROGRESS: After issues resolved

## Phase Completion Marker

Create: `project-plans/20251127openaivercel/.completed/P04a.md`
Contents:

```markdown
Phase: P04a
Completed: YYYY-MM-DD HH:MM
Files Created:
- packages/core/src/providers/openai-vercel/utils.ts
Tests Passing: [count from P04]
Test Run Output: [paste showing all P04 tests PASS]
Semantic Verification: [all 5 questions answered YES]
Fraud Prevention Checklist: [all items checked]
```
