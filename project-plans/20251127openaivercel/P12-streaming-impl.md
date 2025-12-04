# Phase 12: Streaming Generation Implementation (TDD GREEN)

## Phase ID

`PLAN-20251127-OPENAIVERCEL.P12`

## Prerequisites

- Required: Phase 11 completed
- Verification: `npm run test -- packages/core/src/providers/openai-vercel/__tests__/streamingGeneration.test.ts` fails with expected errors
- Expected files from previous phase: `streamingGeneration.test.ts`
- Preflight verification: Phase 0.5 MUST be completed before any implementation phase

## Overview

This phase implements streaming chat completion generation to make all tests from Phase 11 pass.

## Requirements Implemented (Expanded)

### REQ-OAV-008: Streaming Support

**Implementation**:
- Implement generateStreaming method
- Use Vercel AI SDK's streamText function
- Yield text chunks as they arrive
- Yield tool calls when complete
- Include usage metadata at end

## Pseudocode Reference

Implementation follows `analysis/pseudocode/003-streaming-generation.md`:
- **generateStreaming**: Per pseudocode lines 001-042
- **streamTextChunks**: Per pseudocode lines 050-071
- **convertToolCalls**: Per pseudocode lines 080-110
- **createUsageContent**: Per pseudocode lines 120-144

## Implementation Code

### File: `packages/core/src/providers/openai-vercel/OpenAIVercelProvider.ts` (updated generateStreaming)

```typescript
// @plan:PLAN-20251127-OPENAIVERCEL.P12
// @requirement:REQ-OAV-007
// @pseudocode:003-streaming-generation.md lines 001-203

import { streamText } from 'ai';

// Update generateChatCompletion to default to streaming:

async *generateChatCompletion(
  messages: IMessage[],
  options: GenerationOptions
): AsyncIterable<IContent> {
  this.validateConfiguration();

  const openai = this.createOpenAIClient();
  const model = openai(options.model);
  const vercelMessages = this.convertToVercelMessages(messages);

  // Default to streaming if not explicitly disabled
  const useStreaming = options.streaming !== false;

  if (useStreaming) {
    yield* this.generateStreaming(model, vercelMessages, options);
  } else {
    yield* this.generateNonStreaming(model, vercelMessages, options);
  }
}

private async *generateStreaming(
  model: LanguageModel,
  messages: CoreMessage[],
  options: GenerationOptions
): AsyncIterable<IContent> {
  const stream = streamText({
    model,
    messages,
    ...(options.temperature !== undefined && { temperature: options.temperature }),
    ...(options.maxTokens !== undefined && { maxTokens: options.maxTokens }),
    ...(options.tools && { tools: this.convertTools(options.tools) }),
  });

  // Stream text chunks
  for await (const chunk of stream.textStream) {
    if (chunk) {
      yield {
        type: 'text',
        text: chunk,
      };
    }
  }

  // Yield tool calls after text stream completes
  const toolCalls = await stream.toolCalls;
  if (toolCalls && toolCalls.length > 0) {
    for (const toolCall of toolCalls) {
      yield {
        type: 'tool_use',
        id: normalizeToHistoryToolId(toolCall.toolCallId),
        name: toolCall.toolName,
        input: toolCall.args,
      };
    }
  }

  // Yield usage metadata
  const usage = await stream.usage;
  if (usage) {
    yield {
      type: 'usage',
      inputTokens: usage.promptTokens,
      outputTokens: usage.completionTokens,
    };
  }
}
```

## Verification Commands

### Automated Checks

```bash
# Check plan markers exist
grep -c "@plan:PLAN-20251127-OPENAIVERCEL.P12" packages/core/src/providers/openai-vercel/OpenAIVercelProvider.ts

# Run streaming tests (expect PASS - TDD GREEN phase)
npm run test -- packages/core/src/providers/openai-vercel/__tests__/streamingGeneration.test.ts

# Run all provider tests to ensure no regressions
npm run test -- packages/core/src/providers/openai-vercel/
```

### Deferred Implementation Detection

```bash
# Check for TODO/FIXME/HACK markers
grep -rn -E "(TODO|FIXME|HACK|STUB|XXX)" packages/core/src/providers/openai-vercel/OpenAIVercelProvider.ts | grep -v ".test.ts"
# Expected: No matches
```

### Semantic Verification Checklist

- [ ] generateStreaming method fully implemented
- [ ] Text chunks are yielded as they arrive
- [ ] Tool calls are yielded after stream completes
- [ ] Tool call IDs are normalized to history format
- [ ] Usage metadata is yielded at end
- [ ] Streaming is default mode
- [ ] All P11 tests PASS

## Success Criteria

- All streaming tests PASS
- Text chunks arrive incrementally
- Tool calls properly normalized
- Usage metadata included
- No regressions in previous tests

## Fraud Prevention Checklist (TDD GREEN Phase)

Before marking this phase complete, verify:

- [ ] Implementation is MINIMAL to pass tests (no extra features)
- [ ] All P11 tests now PASS (TDD Green)
- [ ] No implementation code was written BEFORE tests
- [ ] Streaming is the default mode (options.streaming !== false)
- [ ] Tool ID normalization uses normalizeToHistoryToolId
- [ ] Type checking passes
- [ ] All previous tests still pass (no regressions)

### Anti-Pattern Detection

```bash
# Check for deferred implementation markers
grep -rn -E "(TODO|FIXME|HACK|STUB|XXX|TEMPORARY|TEMP|WIP)" packages/core/src/providers/openai-vercel/OpenAIVercelProvider.ts | grep -v "Not yet implemented"
# Expected: No matches (or only for listModels which is implemented later)

# Check for cop-out comments
grep -rn -E "(in a real|in production|ideally|for now|placeholder)" packages/core/src/providers/openai-vercel/OpenAIVercelProvider.ts
# Expected: No matches

# Verify all tests pass
npm run test -- packages/core/src/providers/openai-vercel/
# Expected: All pass
```

## Failure Recovery

If this phase fails:
1. Review test error messages
2. Check Vercel AI SDK streamText response structure
3. Verify async iteration handling
4. Update implementation to match test expectations

## Related Files

- `packages/core/src/providers/openai-vercel/__tests__/streamingGeneration.test.ts`
- `packages/core/src/providers/openai-vercel/OpenAIVercelProvider.ts`

## Phase State Tracking

**Phase State**: `NOT_STARTED` | `IN_PROGRESS` | `BLOCKED` | `COMPLETED`

**Current State**: `NOT_STARTED`

**State Transitions**:
- [ ] NOT_STARTED → IN_PROGRESS: When implementation begins
- [ ] IN_PROGRESS → BLOCKED: If unexpected test failures
- [ ] IN_PROGRESS → COMPLETED: When all P11 tests PASS (TDD Green)
- [ ] BLOCKED → IN_PROGRESS: After issues resolved

## Phase Completion Marker

Create: `project-plans/20251127openaivercel/.completed/P12.md`
Contents:

```markdown
Phase: P12
Completed: YYYY-MM-DD HH:MM
Files Modified:
- packages/core/src/providers/openai-vercel/OpenAIVercelProvider.ts [diff stats]
Tests Passing: [count from P11]
Test Run Output: [paste showing all P11 tests PASS]
Regression Check: [paste showing all previous tests still pass]
Fraud Prevention Checklist: [all items checked]
```
