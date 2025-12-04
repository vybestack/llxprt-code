# Phase 05: ThinkingBlock Implementation

## Phase ID

`PLAN-20251202-THINKING.P05`

## Prerequisites

- Required: Phase 04a completed
- Verification: `cat project-plans/20251202thinking/.completed/P04a.md`

## Requirements Implemented (Expanded)

This phase is a VERIFICATION phase. The actual implementation was done in Phase 03.

### REQ-THINK-001.1: sourceField Property Implementation

**Full Text**: ThinkingBlock interface MUST have sourceField property for round-trip serialization
**Behavior**:

- GIVEN: ThinkingBlock interface enhancement in Phase 03
- WHEN: Creating ThinkingBlock instances
- THEN: sourceField property is available and type-safe

**Why This Matters**: Enables proper round-trip serialization to provider APIs

### REQ-THINK-001.2: signature Property Implementation

**Full Text**: ThinkingBlock interface MUST have signature property for Anthropic extended thinking
**Behavior**:

- GIVEN: ThinkingBlock interface enhancement in Phase 03
- WHEN: Creating ThinkingBlock instances
- THEN: signature property is available and type-safe

**Why This Matters**: Supports Anthropic's extended thinking feature

### Verification: ThinkingBlock interface is complete

The interface modification in Phase 03 IS the implementation. This phase verifies:

1. The interface is correctly defined
2. Tests from Phase 04 pass
3. No additional implementation needed for the interface itself

## Implementation Tasks

### No New Code Required

The ThinkingBlock interface enhancement is complete. This phase confirms:

1. Interface has sourceField property ✓ (from P03)
2. Interface has signature property ✓ (from P03)
3. Tests validate the interface ✓ (from P04)

### Optional: Update JSDoc Comments

If not already done in P03, ensure the interface has proper documentation:

```typescript
/**
 * Represents a thinking/reasoning block from an AI model.
 * Used to capture chain-of-thought reasoning.
 *
 * @plan PLAN-20251202-THINKING.P03
 * @requirement REQ-THINK-001
 */
interface ThinkingBlock {
  /** Block type identifier */
  type: 'thinking';
  /** The reasoning/thinking content */
  thought: string;
  /** Whether to hide this block in UI */
  isHidden?: boolean;
  /**
   * Source field name for round-trip serialization.
   * - 'reasoning_content': OpenAI-compatible APIs (Kimi K2, MiniMax, DeepSeek)
   * - 'thinking': Anthropic
   * - 'thought': Gemini
   */
  sourceField?: 'reasoning_content' | 'thinking' | 'thought';
  /** Signature for Anthropic extended thinking round-trip */
  signature?: string;
}
```

## Verification Commands

### All Prior Phase Checks

```bash
# Run P04 tests
npm test -- --run packages/core/src/services/history/__tests__/ThinkingBlock.test.ts

# Typecheck
npm run typecheck

# Lint
npm run lint
```

**Expected**: All pass

### Deferred Implementation Detection

**Purpose**: Ensure no stub/placeholder code remains after implementation

**Check**: This phase verifies Phase 03's implementation - no stubs should exist in interface definition

**Recovery**: If issues found, return to Phase 03 and complete interface definition

### Semantic Verification Checklist (MANDATORY)

**Behavioral Verification Questions**:

1. **Can I create a ThinkingBlock with sourceField='reasoning_content' and does it compile?**
   - Expected: Yes, TypeScript accepts it without errors

2. **Can I create a ThinkingBlock with all three sourceField values?**
   - Expected: Yes, 'reasoning_content', 'thinking', and 'thought' all compile

3. **Can I create a ThinkingBlock with signature property?**
   - Expected: Yes, TypeScript accepts string signature

4. **Do legacy ThinkingBlocks (without new properties) still compile?**
   - Expected: Yes, backward compatibility maintained

5. **Can I assign ThinkingBlock to ContentBlock union type?**
   - Expected: Yes, no type errors

6. **Do all Phase 04 tests pass?**
   - Expected: Yes, all tests green

## Success Criteria

- All Phase 04 tests pass
- TypeScript compiles
- Linting passes
- Interface is ready for use by reasoningUtils
- All behavioral questions answered "Yes"

## Phase Completion Marker

Create: `project-plans/20251202thinking/.completed/P05.md`
