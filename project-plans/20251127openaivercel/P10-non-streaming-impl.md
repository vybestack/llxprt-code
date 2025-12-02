# Phase 10: Non-Streaming Generation Implementation (TDD GREEN)

## Phase ID

`PLAN-20251127-OPENAIVERCEL.P10`

## Prerequisites

- Required: Phase 9 completed
- Verification: `npm run test -- packages/core/src/providers/openai-vercel/__tests__/nonStreamingGeneration.test.ts` fails with expected errors
- Expected files from previous phase: `nonStreamingGeneration.test.ts`
- Preflight verification: Phase 0.5 MUST be completed before any implementation phase

## Overview

This phase implements non-streaming chat completion generation to make all tests from Phase 9 pass.

## Requirements Implemented (Expanded)

### REQ-OAV-007: Chat Completion Generation

**Implementation**:
- Implement generateChatCompletion for non-streaming mode
- Use Vercel AI SDK's generateText function
- Convert messages to Vercel format
- Handle tool calls in response
- Include usage metadata

## Pseudocode Reference

Implementation follows `analysis/pseudocode/004-non-streaming-generation.md`:
- **generateNonStreaming**: Implement per pseudocode lines 001-048
  - Lines 007-024: Build request options with optional parameters
  - Lines 028-033: Call generateText and handle errors
  - Lines 036-038: Yield text content if present
  - Lines 041-043: Yield tool calls if present
  - Line 046: Yield usage metadata
- **createTextContent**: Implement per pseudocode lines 060-070
  - Create IContent with speaker='ai' and text block
- **createToolCallsContent**: Implement per pseudocode lines 080-104
  - Line 087: CRITICAL - Normalize tool IDs to hist_tool_ format using normalizeToHistoryToolId
  - Lines 089-099: Build tool_call blocks
- **createUsageContent**: Implement per pseudocode lines 110-134
  - Lines 112-120: Handle null usage with default zeros
  - Lines 127-130: Map promptTokens->inputTokens, completionTokens->outputTokens

## Implementation Code

### File: `packages/core/src/providers/openai-vercel/OpenAIVercelProvider.ts` (updated generateNonStreaming)

```typescript
// @plan:PLAN-20251127-OPENAIVERCEL.P10
// @requirement:REQ-OAV-006
// @pseudocode:004-non-streaming-generation.md lines 001-153

import { generateText } from 'ai';
import { normalizeToHistoryToolId } from './utils';

// Add to existing class:

async *generateChatCompletion(
  messages: IMessage[],
  options: GenerationOptions
): AsyncIterable<IContent> {
  this.validateConfiguration();

  const openai = this.createOpenAIClient();
  const model = openai(options.model);
  const vercelMessages = this.convertToVercelMessages(messages);

  if (options.streaming === false) {
    yield* this.generateNonStreaming(model, vercelMessages, options);
  } else {
    yield* this.generateStreaming(model, vercelMessages, options);
  }
}

private async *generateNonStreaming(
  model: LanguageModel,
  messages: CoreMessage[],
  options: GenerationOptions
): AsyncIterable<IContent> {
  const result = await generateText({
    model,
    messages,
    ...(options.temperature !== undefined && { temperature: options.temperature }),
    ...(options.maxTokens !== undefined && { maxTokens: options.maxTokens }),
    ...(options.tools && { tools: this.convertTools(options.tools) }),
  });

  // Yield text content if present
  if (result.text) {
    yield {
      type: 'text',
      text: result.text,
    };
  }

  // Yield tool calls if present
  if (result.toolCalls && result.toolCalls.length > 0) {
    for (const toolCall of result.toolCalls) {
      yield {
        type: 'tool_use',
        id: normalizeToHistoryToolId(toolCall.toolCallId),
        name: toolCall.toolName,
        input: toolCall.args,
      };
    }
  }

  // Yield usage metadata
  if (result.usage) {
    yield {
      type: 'usage',
      inputTokens: result.usage.promptTokens,
      outputTokens: result.usage.completionTokens,
    };
  }
}

private async *generateStreaming(
  model: LanguageModel,
  messages: CoreMessage[],
  options: GenerationOptions
): AsyncIterable<IContent> {
  // Will be implemented in streaming phase
  throw new Error('Streaming not yet implemented');
}

private convertTools(tools: Tool[]): Record<string, unknown> {
  const converted: Record<string, unknown> = {};
  
  for (const tool of tools) {
    converted[tool.name] = {
      description: tool.description,
      parameters: tool.parameters,
    };
  }
  
  return converted;
}
```

## Verification Commands

### Automated Checks

```bash
# Check plan markers exist
grep -c "@plan:PLAN-20251127-OPENAIVERCEL.P10" packages/core/src/providers/openai-vercel/OpenAIVercelProvider.ts

# Run non-streaming tests (expect PASS - TDD GREEN phase)
npm run test -- packages/core/src/providers/openai-vercel/__tests__/nonStreamingGeneration.test.ts

# Run all provider tests to ensure no regressions
npm run test -- packages/core/src/providers/openai-vercel/
```

### Deferred Implementation Detection

```bash
# Check for TODO/FIXME/HACK markers
grep -rn -E "(TODO|FIXME|HACK|STUB|XXX)" packages/core/src/providers/openai-vercel/OpenAIVercelProvider.ts | grep -v ".test.ts"
# Expected: No matches
```

### Semantic Verification Checklist (5 Behavioral Questions)

Answer these 5 questions to verify the feature actually works:

1. **Does INPUT -> OUTPUT work as specified?**
   - [ ] User message -> API receives `role: 'user'`
   - [ ] API text response -> yields `{ type: 'text', text: '...' }`
   - [ ] API tool call with `call_abc` -> yields `{ id: 'hist_tool_abc' }`

2. **Can I trigger this behavior manually?**
   - [ ] Write a test script that mocks generateText and verifies output
   - [ ] Check the yielded IContent structure matches expected format

3. **What happens with edge cases?**
   - [ ] Empty API response -> still yields usage block
   - [ ] No API key configured -> throws before API call
   - [ ] API error -> propagates with original message

4. **Does round-trip/integration work?**
   - [ ] Messages converted to Vercel format correctly
   - [ ] Tool IDs normalized both directions (see 001-tool-id-normalization.md)

5. **Is the feature observable in the system?**
   - [ ] All P09 tests PASS
   - [ ] Type checking passes
   - [ ] No regressions in previous tests

### Structural Verification Checklist

- [ ] generateChatCompletion handles streaming=false
- [ ] Messages are converted to Vercel format
- [ ] Tool IDs normalized using normalizeToHistoryToolId
- [ ] All P09 tests PASS

## Success Criteria

- All non-streaming tests PASS
- Tool call IDs normalized to hist_tool_ format
- Usage metadata included when available

## Fraud Prevention Checklist (TDD GREEN Phase)

Before marking this phase complete, verify:

- [ ] Implementation is MINIMAL to pass tests (no extra features)
- [ ] All P09 tests now PASS (TDD Green)
- [ ] No implementation code was written BEFORE tests
- [ ] No logic that isn't covered by a test
- [ ] Tool ID normalization uses normalizeToHistoryToolId
- [ ] Type checking passes
- [ ] All previous tests still pass (no regressions)

### Anti-Pattern Detection

```bash
# Check for deferred implementation markers
grep -rn -E "(TODO|FIXME|HACK|STUB|XXX|TEMPORARY|TEMP|WIP)" packages/core/src/providers/openai-vercel/OpenAIVercelProvider.ts | grep -v "Not yet implemented" | grep -v "Streaming"
# Expected: No matches (only streaming-related "Not yet implemented" allowed)

# Check for cop-out comments
grep -rn -E "(in a real|in production|ideally|for now|placeholder)" packages/core/src/providers/openai-vercel/OpenAIVercelProvider.ts
# Expected: No matches

# Verify all tests pass including previous phases
npm run test -- packages/core/src/providers/openai-vercel/
# Expected: All pass (except streaming tests if they exist)
```

## Failure Recovery

If this phase fails:
1. Review test error messages
2. Check Vercel AI SDK generateText response structure
3. Verify tool ID normalization
4. Update implementation to match test expectations

## Related Files

- `packages/core/src/providers/openai-vercel/__tests__/nonStreamingGeneration.test.ts`
- `packages/core/src/providers/openai-vercel/OpenAIVercelProvider.ts`
- `packages/core/src/providers/openai-vercel/utils.ts`

## Phase State Tracking

**Phase State**: `NOT_STARTED` | `IN_PROGRESS` | `BLOCKED` | `COMPLETED`

**Current State**: `NOT_STARTED`

**State Transitions**:
- [ ] NOT_STARTED → IN_PROGRESS: When implementation begins
- [ ] IN_PROGRESS → BLOCKED: If unexpected test failures
- [ ] IN_PROGRESS → COMPLETED: When all P09 tests PASS (TDD Green)
- [ ] BLOCKED → IN_PROGRESS: After issues resolved

## Phase Completion Marker

Create: `project-plans/20251127openaivercel/.completed/P10.md`
Contents:

```markdown
Phase: P10
Completed: YYYY-MM-DD HH:MM
Files Modified:
- packages/core/src/providers/openai-vercel/OpenAIVercelProvider.ts [diff stats]
Tests Passing: [count from P09]
Test Run Output: [paste showing all P09 tests PASS]
Regression Check: [paste showing all previous tests still pass]
Fraud Prevention Checklist: [all items checked]
```
