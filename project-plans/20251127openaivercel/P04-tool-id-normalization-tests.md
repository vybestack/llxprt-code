# Phase 4: Tool ID Normalization TDD Tests

## Phase ID

`PLAN-20251127-OPENAIVERCEL.P04`

## Prerequisites

- Required: Phase 3 completed
- Verification: `npm run test -- packages/core/src/providers/openai-vercel/__tests__/providerRegistration.test.ts` passes
- Expected files from previous phase: `OpenAIVercelProvider.ts`, `index.ts`
- Preflight verification: Phase 0.5 MUST be completed before any implementation phase

## Overview

This phase creates failing tests for tool ID normalization functions. The Vercel AI SDK requires OpenAI-compatible tool call IDs (prefixed with `call_`), but our history system uses `hist_tool_` prefixed IDs. These utility functions handle the bidirectional conversion.

## Requirements Implemented (Expanded)

### REQ-OAV-006: Tool Calling Support (Partial)

**Full Text**: Must support tool/function calling with proper ID normalization
**Behavior**:
- GIVEN: A tool call ID from history (e.g., `hist_tool_abc123`)
- WHEN: Converting for OpenAI API
- THEN: ID is normalized to OpenAI format (e.g., `call_abc123`)

- GIVEN: A tool call ID from OpenAI API (e.g., `call_xyz789`)
- WHEN: Converting back to history format
- THEN: ID is normalized to history format (e.g., `hist_tool_xyz789`)

**Test Cases**:
1. `hist_tool_` prefix → `call_` prefix
2. `toolu_` prefix (Anthropic) → `call_` prefix
3. `call_` prefix stays unchanged
4. Unknown formats get `call_` prefix
5. Reverse conversion: `call_` → `hist_tool_`

## Pseudocode Reference

Tests verify behavior defined in `analysis/pseudocode/001-tool-id-normalization.md`:
- **normalizeToOpenAIToolId**: Lines 001-021
- **normalizeToHistoryToolId**: Lines 030-050
- **Round-trip invariant**: Lines 060-065
- **Edge cases**: Lines 070-080

## Test Code

### File: `packages/core/src/providers/openai-vercel/__tests__/toolIdNormalization.test.ts`

```typescript
// @plan:PLAN-20251127-OPENAIVERCEL.P04
// @requirement:REQ-OAV-004
// @pseudocode:001-tool-id-normalization.md

import { describe, it, expect } from 'vitest';
import { fc, test } from '@fast-check/vitest';
import {
  normalizeToOpenAIToolId,
  normalizeToHistoryToolId,
} from '../utils';

describe('Tool ID Normalization', () => {
  describe('normalizeToOpenAIToolId', () => {
    // Per pseudocode lines 008-010: hist_tool_ prefix conversion
    it('should convert hist_tool_ prefix to call_ prefix', () => {
      expect(normalizeToOpenAIToolId('hist_tool_abc123')).toBe('call_abc123');
    });

    // Per pseudocode lines 014-016: toolu_ prefix conversion
    it('should convert toolu_ prefix to call_ prefix', () => {
      expect(normalizeToOpenAIToolId('toolu_xyz789')).toBe('call_xyz789');
    });

    // Per pseudocode lines 003-004: already in format passthrough
    it('should keep call_ prefix unchanged', () => {
      expect(normalizeToOpenAIToolId('call_existing')).toBe('call_existing');
    });

    // Per pseudocode lines 019-020: unknown format handling
    it('should add call_ prefix to unknown formats', () => {
      expect(normalizeToOpenAIToolId('random_id_123')).toBe('call_random_id_123');
    });

    // Per pseudocode edge case line 071
    it('should handle empty string', () => {
      expect(normalizeToOpenAIToolId('')).toBe('call_');
    });

    // Per pseudocode edge case lines 079-080
    it('should handle IDs with special characters', () => {
      expect(normalizeToOpenAIToolId('hist_tool_abc-123_def')).toBe('call_abc-123_def');
    });
  });

  describe('normalizeToHistoryToolId', () => {
    // Per pseudocode lines 037-039: call_ prefix conversion
    it('should convert call_ prefix to hist_tool_ prefix', () => {
      expect(normalizeToHistoryToolId('call_abc123')).toBe('hist_tool_abc123');
    });

    // Per pseudocode lines 032-033: already in format passthrough
    it('should keep hist_tool_ prefix unchanged', () => {
      expect(normalizeToHistoryToolId('hist_tool_existing')).toBe('hist_tool_existing');
    });

    // Per pseudocode lines 048-049: unknown format handling
    it('should add hist_tool_ prefix to unknown formats', () => {
      expect(normalizeToHistoryToolId('random_id_456')).toBe('hist_tool_random_id_456');
    });

    // Per pseudocode lines 043-045: toolu_ prefix conversion
    it('should handle toolu_ prefix', () => {
      expect(normalizeToHistoryToolId('toolu_anthropic')).toBe('hist_tool_anthropic');
    });

    // Per pseudocode edge case line 072
    it('should handle empty string', () => {
      expect(normalizeToHistoryToolId('')).toBe('hist_tool_');
    });
  });

  describe('Round-trip conversion (Pseudocode lines 060-065)', () => {
    it('should preserve ID through OpenAI -> History -> OpenAI', () => {
      const original = 'call_test123';
      const toHistory = normalizeToHistoryToolId(original);
      const backToOpenAI = normalizeToOpenAIToolId(toHistory);
      expect(backToOpenAI).toBe(original);
    });

    it('should preserve ID through History -> OpenAI -> History', () => {
      const original = 'hist_tool_test456';
      const toOpenAI = normalizeToOpenAIToolId(original);
      const backToHistory = normalizeToHistoryToolId(toOpenAI);
      expect(backToHistory).toBe(original);
    });
    
    // Property-based test: Round-trip invariant for any UUID
    test.prop([fc.uuid()])('round-trip preserves call_ IDs for any UUID', (uuid) => {
      const callId = `call_${uuid}`;
      const toHistory = normalizeToHistoryToolId(callId);
      const backToCall = normalizeToOpenAIToolId(toHistory);
      expect(backToCall).toBe(callId);
    });
    
    // Property-based test: Round-trip invariant for hist_tool_ IDs
    test.prop([fc.uuid()])('round-trip preserves hist_tool_ IDs for any UUID', (uuid) => {
      const histId = `hist_tool_${uuid}`;
      const toCall = normalizeToOpenAIToolId(histId);
      const backToHist = normalizeToHistoryToolId(toCall);
      expect(backToHist).toBe(histId);
    });
  });
  
  describe('Property-based tests (30% coverage)', () => {
    // Property: Output always starts with call_
    test.prop([fc.string()])('normalizeToOpenAIToolId always produces call_ prefix', (input) => {
      const result = normalizeToOpenAIToolId(input);
      expect(result.startsWith('call_')).toBe(true);
    });
    
    // Property: Output always starts with hist_tool_
    test.prop([fc.string()])('normalizeToHistoryToolId always produces hist_tool_ prefix', (input) => {
      const result = normalizeToHistoryToolId(input);
      expect(result.startsWith('hist_tool_')).toBe(true);
    });
  });
});
```

## Verification Commands

### Automated Checks

```bash
# Verify test file exists
ls -la packages/core/src/providers/openai-vercel/__tests__/toolIdNormalization.test.ts

# Check for plan markers
grep "@plan:PLAN-20251127-OPENAIVERCEL.P04" packages/core/src/providers/openai-vercel/__tests__/toolIdNormalization.test.ts

# Check for requirement markers
grep "@req:REQ-OAV-006" packages/core/src/providers/openai-vercel/__tests__/toolIdNormalization.test.ts

# Run tests (expect FAIL - TDD RED phase)
npm run test -- packages/core/src/providers/openai-vercel/__tests__/toolIdNormalization.test.ts
```

### Structural Verification Checklist

- [ ] Test file created
- [ ] Plan markers present
- [ ] Requirement markers present
- [ ] Tests cover both directions of normalization
- [ ] Tests cover edge cases
- [ ] Tests FAIL (because implementation doesn't exist yet)

## Success Criteria

- Tests exist and are properly structured
- Tests FAIL because normalizeToOpenAIToolId/normalizeToHistoryToolId don't exist
- Test names clearly describe expected behavior

## Fraud Prevention Checklist (TDD RED Phase)

Before marking this phase complete, verify:

- [ ] Tests are written BEFORE implementation (TDD Red)
- [ ] Tests import from `../utils` which DON'T EXIST YET
- [ ] Running tests produces FAILURE (not error from missing imports in test setup)
- [ ] Tests define BEHAVIOR, not implementation details
- [ ] Tests cover edge cases (empty string, unknown formats)
- [ ] Tests verify round-trip conversion works
- [ ] No "always pass" tests

### Anti-Pattern Detection

```bash
# Check for stub tests that always pass
grep -n "expect(true)" packages/core/src/providers/openai-vercel/__tests__/toolIdNormalization.test.ts
# Expected: No matches

# Check for tests without assertions
grep -c "expect(" packages/core/src/providers/openai-vercel/__tests__/toolIdNormalization.test.ts
# Expected: Multiple matches (at least one per test)

# Verify tests fail as expected
npm run test -- packages/core/src/providers/openai-vercel/__tests__/toolIdNormalization.test.ts 2>&1 | head -20
# Expected: Module not found or function not exported errors
```

## Failure Recovery

If this phase fails:
1. `rm packages/core/src/providers/openai-vercel/__tests__/toolIdNormalization.test.ts`
2. Review test patterns from OpenAIProvider tests
3. Re-create test file with corrected imports

## Related Files

- `packages/core/src/providers/openai-vercel/utils.ts` (to be created)
- `packages/core/src/providers/openai/OpenAIProvider.ts` (reference for patterns)

## Phase State Tracking

**Phase State**: `NOT_STARTED` | `IN_PROGRESS` | `BLOCKED` | `COMPLETED`

**Current State**: `NOT_STARTED`

**State Transitions**:
- [ ] NOT_STARTED → IN_PROGRESS: When test file creation begins
- [ ] IN_PROGRESS → BLOCKED: If test infrastructure issues found
- [ ] IN_PROGRESS → COMPLETED: When tests exist and FAIL correctly (TDD Red)
- [ ] BLOCKED → IN_PROGRESS: After infrastructure issues resolved

## Phase Completion Marker

Create: `project-plans/20251127openaivercel/.completed/P04.md`
Contents:

```markdown
Phase: P04
Completed: YYYY-MM-DD HH:MM
Files Created:
- packages/core/src/providers/openai-vercel/__tests__/toolIdNormalization.test.ts
Tests Added: [count]
Test Run Output: [paste showing tests FAIL as expected]
Fraud Prevention Checklist: [all items checked]
```
