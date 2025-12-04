# Phase 09: OpenAIProvider Reasoning Parsing Stub

## Phase ID

`PLAN-20251202-THINKING.P09`

## Prerequisites

- Required: Phase 08a completed
- Verification: `cat project-plans/20251202thinking/.completed/P08a.md`
- Expected: reasoningUtils fully implemented and tested

## Requirements Implemented (Expanded)

### REQ-THINK-003: OpenAI Provider Parsing

**Full Text**: OpenAIProvider must parse reasoning_content from API responses
**Behavior**:

- GIVEN: API streaming response with `reasoning_content` delta
- WHEN: Parsing the stream
- THEN: Emit ThinkingBlock with sourceField='reasoning_content'

**Why This Matters**: Kimi K2 and other models return reasoning in this field

## Implementation Tasks

### Files to Modify

#### `packages/core/src/providers/openai/OpenAIProvider.ts`

Add two new methods (stubs):

```typescript
/**
 * Parse reasoning_content from streaming delta.
 *
 * @plan PLAN-20251202-THINKING.P09
 * @requirement REQ-THINK-003.1
 * @pseudocode openai-provider-reasoning.md lines 10-24
 */
private parseStreamingReasoningDelta(delta: ChatCompletionChunk.Choice.Delta): IContent | null {
  // STUB: Will be implemented in P11
  return null;
}

/**
 * Parse reasoning_content from non-streaming message.
 *
 * @plan PLAN-20251202-THINKING.P09
 * @requirement REQ-THINK-003.2
 * @pseudocode openai-provider-reasoning.md lines 60-70
 */
private parseNonStreamingReasoning(message: ChatCompletionMessage): ThinkingBlock | null {
  // STUB: Will be implemented in P11
  return null;
}
```

### Integration Points

In `generateChatStream`:

- Identify where deltas are processed
- Add call to `parseStreamingReasoningDelta` BEFORE content handling
- Yield result if not null

In `generateChat` (non-streaming):

- Identify where message is parsed
- Add call to `parseNonStreamingReasoning`
- Include ThinkingBlock in result if present

### Required Import

```typescript
import type { ThinkingBlock } from '../../services/history/IContent.js';
```

## Verification Commands

### Automated Checks

```bash
# Check new methods exist
grep "parseStreamingReasoningDelta" packages/core/src/providers/openai/OpenAIProvider.ts
grep "parseNonStreamingReasoning" packages/core/src/providers/openai/OpenAIProvider.ts

# Check plan markers
grep "@plan.*THINKING.P09" packages/core/src/providers/openai/OpenAIProvider.ts
# Expected: 2+ occurrences

# TypeScript compiles (stubs returning null are valid)
npm run typecheck
```

### Deferred Implementation Detection (MANDATORY)

```bash
# Run ALL of these checks - if ANY match, phase FAILS:

# Check stubs return null with STUB comment
grep -A 3 "parseStreamingReasoningDelta\|parseNonStreamingReasoning" packages/core/src/providers/openai/OpenAIProvider.ts | grep -E "(return null|STUB)"
# Expected: Both methods return null with STUB comment

# Verify no premature implementation in parsing methods
grep -A 10 "parseStreamingReasoningDelta" packages/core/src/providers/openai/OpenAIProvider.ts | grep -E "(reasoning_content|ThinkingBlock)"
# Expected: No implementation logic, just stub

grep -A 10 "parseNonStreamingReasoning" packages/core/src/providers/openai/OpenAIProvider.ts | grep -E "(reasoning_content|ThinkingBlock)"
# Expected: No implementation logic, just stub

# Check for TODO/FIXME markers outside of stub comments
grep -rn -E "(TODO|FIXME|HACK|XXX|TEMPORARY|TEMP|WIP)" packages/core/src/providers/openai/OpenAIProvider.ts | grep -i reason | grep -v "STUB\|Will be implemented"
# Expected: No matches (implementation is P11)
```

### Semantic Verification Checklist (MANDATORY)

**Go beyond markers. Actually verify the behavior exists.**

#### Behavioral Verification Questions (answer ALL before proceeding)

1. **Does the code DO what the requirement says?**
   - [ ] I read REQ-THINK-003.1 and verified parseStreamingReasoningDelta signature accepts delta parameter
   - [ ] I read REQ-THINK-003.2 and verified parseNonStreamingReasoning accepts message parameter
   - [ ] Both stubs return null (not throwing) for graceful degradation
   - [ ] Return types match specification: IContent | null and ThinkingBlock | null

2. **Is this REAL implementation, not placeholder?**
   - [ ] Deferred implementation detection passed - stubs return null with STUB comment
   - [ ] No premature parsing logic (no reasoning_content extraction yet)
   - [ ] No ThinkingBlock construction in stub (that's P11)
   - [ ] STUB comments clearly indicate implementation phase (P11)

3. **Would the test FAIL if implementation was removed?**
   - [ ] Tests will fail when expecting ThinkingBlocks but get null
   - [ ] Tests verify stubs are called but don't yet parse reasoning
   - [ ] Tests prepared to pass in P11 when real implementation added

4. **Is the feature REACHABLE by users?**
   - [ ] Methods are private but called from stream/non-stream handlers
   - [ ] Integration points identified in plan (where to call stubs)
   - [ ] ThinkingBlock type imported from IContent.ts
   - [ ] No compile errors preventing OpenAIProvider from being instantiated

5. **What's MISSING?** (list gaps that need fixing before proceeding)
   - [ ] [gap 1]
   - [ ] [gap 2]

#### Feature Actually Works

```bash
# Manual verification: Show stub methods exist
grep -A 5 "parseStreamingReasoningDelta\|parseNonStreamingReasoning" packages/core/src/providers/openai/OpenAIProvider.ts | head -20
# Expected: Both methods with return null statements

# Verify no premature implementation
grep -A 10 "parseStreamingReasoningDelta\|parseNonStreamingReasoning" packages/core/src/providers/openai/OpenAIProvider.ts | grep -c "reasoning_content"
# Expected: 0 (only in comments, not implementation)
```

#### Stub Quality Verified

- [ ] Both methods have JSDoc with @plan markers
- [ ] Both methods have @requirement markers
- [ ] Both methods have @pseudocode references
- [ ] Stubs are minimalist (just signature + return null)
- [ ] Private methods (will be called by public streaming/non-streaming handlers)

### Structural Verification Checklist

- [ ] parseStreamingReasoningDelta method added
- [ ] parseNonStreamingReasoning method added
- [ ] Both have plan markers
- [ ] Both have requirement markers
- [ ] Both have pseudocode references
- [ ] TypeScript compiles
- [ ] Existing tests still pass

## Success Criteria

- Stub methods exist with correct signatures
- Plan markers present
- TypeScript compiles
- Existing functionality unchanged

## Failure Recovery

If this phase fails:

1. `git checkout -- packages/core/src/providers/openai/OpenAIProvider.ts`
2. Review existing OpenAIProvider structure
3. Re-attempt with corrected approach

## Phase Completion Marker

Create: `project-plans/20251202thinking/.completed/P09.md`
