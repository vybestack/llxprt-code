# Phase 14: Error Handling Implementation (TDD GREEN)

## Phase ID

`PLAN-20251127-OPENAIVERCEL.P14`

## Prerequisites

- Required: Phase 13 completed
- Verification: `npm run test -- packages/core/src/providers/openai-vercel/__tests__/errorHandling.test.ts` fails with expected errors
- Expected files from previous phase: `errorHandling.test.ts`
- Preflight verification: Phase 0.5 MUST be completed before any implementation phase

## Overview

This phase implements comprehensive error handling to make all tests from Phase 13 pass. This includes custom error classes and error wrapping logic.

## Requirements Implemented (Expanded)

### REQ-OAV-009: Error Handling

**Implementation**:
- Create ProviderError base class
- Create RateLimitError with retry-after support
- Create AuthenticationError
- Wrap API errors with appropriate error types
- Preserve original error information

## Pseudocode Reference

Implementation follows `analysis/pseudocode/005-error-handling.md`:
- **ProviderError class**: Per pseudocode lines 001-013
- **RateLimitError class**: Per pseudocode lines 016-024
- **AuthenticationError class**: Per pseudocode lines 027-032
- **wrapError function**: Per pseudocode lines 040-088
- **createRateLimitError**: Per pseudocode lines 100-119
- **isNetworkError**: Per pseudocode lines 130-152

## Implementation Code

### File: `packages/core/src/providers/openai-vercel/errors.ts`

```typescript
// @plan:PLAN-20251127-OPENAIVERCEL.P14
// @requirement:REQ-OAV-008
// @pseudocode:005-error-handling.md lines 001-240

export class ProviderError extends Error {
  readonly provider: string = 'openaivercel';
  readonly statusCode?: number;
  readonly originalError?: Error;

  constructor(message: string, statusCode?: number, originalError?: Error) {
    super(message);
    this.name = 'ProviderError';
    this.statusCode = statusCode;
    this.originalError = originalError;
  }
}

export class RateLimitError extends ProviderError {
  readonly retryAfter?: number;

  constructor(message: string, retryAfter?: number, originalError?: Error) {
    super(message, 429, originalError);
    this.name = 'RateLimitError';
    this.retryAfter = retryAfter;
  }
}

export class AuthenticationError extends ProviderError {
  constructor(message: string, originalError?: Error) {
    super(`Authentication failed: ${message}. Please check your API key.`, 401, originalError);
    this.name = 'AuthenticationError';
  }
}

export function wrapError(error: unknown): ProviderError {
  if (error instanceof ProviderError) {
    return error;
  }

  const err = error as Error & { status?: number; headers?: Record<string, string>; code?: string };
  const status = err.status;
  const message = err.message || 'Unknown error';

  // Rate limit error
  if (status === 429) {
    const retryAfter = err.headers?.['retry-after']
      ? parseInt(err.headers['retry-after'], 10)
      : undefined;
    return new RateLimitError(message, retryAfter, err);
  }

  // Authentication error
  if (status === 401) {
    return new AuthenticationError(message, err);
  }

  // All other errors
  return new ProviderError(message, status, err);
}
```

### File: `packages/core/src/providers/openai-vercel/OpenAIVercelProvider.ts` (updated with error handling)

```typescript
// @plan:PLAN-20251127-OPENAIVERCEL.P14
// @req:REQ-OAV-009

import { wrapError } from './errors';

// Update generateChatCompletion to wrap errors:

async *generateChatCompletion(
  messages: IMessage[],
  options: GenerationOptions
): AsyncIterable<IContent> {
  this.validateConfiguration();

  const openai = this.createOpenAIClient();
  const model = openai(options.model);
  const vercelMessages = this.convertToVercelMessages(messages);

  const useStreaming = options.streaming !== false;

  try {
    if (useStreaming) {
      yield* this.generateStreaming(model, vercelMessages, options);
    } else {
      yield* this.generateNonStreaming(model, vercelMessages, options);
    }
  } catch (error) {
    throw wrapError(error);
  }
}

// Update generateStreaming to handle stream errors:

private async *generateStreaming(
  model: LanguageModel,
  messages: CoreMessage[],
  options: GenerationOptions
): AsyncIterable<IContent> {
  let stream;
  
  try {
    stream = streamText({
      model,
      messages,
      ...(options.temperature !== undefined && { temperature: options.temperature }),
      ...(options.maxTokens !== undefined && { maxTokens: options.maxTokens }),
      ...(options.tools && { tools: this.convertTools(options.tools) }),
    });
  } catch (error) {
    throw wrapError(error);
  }

  // Stream text chunks with error handling
  try {
    for await (const chunk of stream.textStream) {
      if (chunk) {
        yield {
          type: 'text',
          text: chunk,
        };
      }
    }
  } catch (error) {
    throw wrapError(error);
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

// Update generateNonStreaming to handle errors:

private async *generateNonStreaming(
  model: LanguageModel,
  messages: CoreMessage[],
  options: GenerationOptions
): AsyncIterable<IContent> {
  let result;
  
  try {
    result = await generateText({
      model,
      messages,
      ...(options.temperature !== undefined && { temperature: options.temperature }),
      ...(options.maxTokens !== undefined && { maxTokens: options.maxTokens }),
      ...(options.tools && { tools: this.convertTools(options.tools) }),
    });
  } catch (error) {
    throw wrapError(error);
  }

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
```

### File: `packages/core/src/providers/openai-vercel/index.ts` (updated exports)

```typescript
// @plan:PLAN-20251127-OPENAIVERCEL.P14

export { OpenAIVercelProvider } from './OpenAIVercelProvider';
export { ProviderError, RateLimitError, AuthenticationError, wrapError } from './errors';
export { normalizeToOpenAIToolId, normalizeToHistoryToolId } from './utils';
```

## Verification Commands

### Automated Checks

```bash
# Check plan markers exist
grep -c "@plan:PLAN-20251127-OPENAIVERCEL.P14" packages/core/src/providers/openai-vercel/errors.ts

# Run error handling tests (expect PASS - TDD GREEN phase)
npm run test -- packages/core/src/providers/openai-vercel/__tests__/errorHandling.test.ts

# Run all provider tests to ensure no regressions
npm run test -- packages/core/src/providers/openai-vercel/
```

### Semantic Verification Checklist

- [ ] ProviderError class exists with provider property
- [ ] RateLimitError includes retryAfter
- [ ] AuthenticationError has helpful message
- [ ] wrapError correctly identifies error types
- [ ] Errors are wrapped in both streaming and non-streaming modes
- [ ] All P13 tests PASS

## Success Criteria

- All error handling tests PASS
- Error types are correctly identified
- Rate limit information is preserved
- Error messages are helpful
- No regressions in previous tests

## Fraud Prevention Checklist (TDD GREEN Phase)

Before marking this phase complete, verify:

- [ ] Implementation is MINIMAL to pass tests (no extra features)
- [ ] All P13 tests now PASS (TDD Green)
- [ ] No implementation code was written BEFORE tests
- [ ] ProviderError base class has provider property
- [ ] RateLimitError has retryAfter property
- [ ] AuthenticationError has helpful API key message
- [ ] wrapError function correctly identifies error types by status code
- [ ] All generation methods wrap errors using wrapError
- [ ] Type checking passes
- [ ] All previous tests still pass (no regressions)

### Anti-Pattern Detection

```bash
# Check for deferred implementation markers
grep -rn -E "(TODO|FIXME|HACK|STUB|XXX|TEMPORARY|TEMP|WIP)" packages/core/src/providers/openai-vercel/errors.ts
# Expected: No matches

grep -rn -E "(TODO|FIXME|HACK|STUB|XXX|TEMPORARY|TEMP|WIP)" packages/core/src/providers/openai-vercel/OpenAIVercelProvider.ts | grep -v "Not yet implemented"
# Expected: No matches (only listModels "Not yet implemented" allowed)

# Check for cop-out comments
grep -rn -E "(in a real|in production|ideally|for now|placeholder)" packages/core/src/providers/openai-vercel/
# Expected: No matches

# Verify all tests pass
npm run test -- packages/core/src/providers/openai-vercel/
# Expected: All pass
```

## Failure Recovery

If this phase fails:
1. Review test error messages
2. Check error status code handling
3. Verify error class inheritance
4. Update implementation to match test expectations

## Related Files

- `packages/core/src/providers/openai-vercel/__tests__/errorHandling.test.ts`
- `packages/core/src/providers/openai-vercel/errors.ts`
- `packages/core/src/providers/openai-vercel/OpenAIVercelProvider.ts`

## Phase State Tracking

**Phase State**: `NOT_STARTED` | `IN_PROGRESS` | `BLOCKED` | `COMPLETED`

**Current State**: `NOT_STARTED`

**State Transitions**:
- [ ] NOT_STARTED → IN_PROGRESS: When implementation begins
- [ ] IN_PROGRESS → BLOCKED: If unexpected test failures
- [ ] IN_PROGRESS → COMPLETED: When all P13 tests PASS (TDD Green)
- [ ] BLOCKED → IN_PROGRESS: After issues resolved

## Phase Completion Marker

Create: `project-plans/20251127openaivercel/.completed/P14.md`
Contents:

```markdown
Phase: P14
Completed: YYYY-MM-DD HH:MM
Files Created:
- packages/core/src/providers/openai-vercel/errors.ts
Files Modified:
- packages/core/src/providers/openai-vercel/OpenAIVercelProvider.ts [diff stats]
- packages/core/src/providers/openai-vercel/index.ts [diff stats]
Tests Passing: [count from P13]
Test Run Output: [paste showing all P13 tests PASS]
Regression Check: [paste showing all previous tests still pass]
Fraud Prevention Checklist: [all items checked]
```
