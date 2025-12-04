# Phase 11: OpenAIProvider Parsing Implementation

## Phase ID

`PLAN-20251202-THINKING.P11`

## What This Phase Implements

### Concrete Implementation Goal

Add two private methods to OpenAIProvider that parse reasoning_content from OpenAI API responses (both streaming and non-streaming) and convert to ThinkingBlock instances. Integrate these methods into existing stream and response handling code.

### Expected Code Structure

```typescript
// packages/core/src/providers/openai/OpenAIProvider.ts

// Method 1: Parse streaming deltas
private parseStreamingReasoningDelta(
  delta: ChatCompletionChunk.Choice.Delta | undefined
): IContent | null {
  if (!delta?.reasoning_content) return null;

  return {
    speaker: 'ai',
    blocks: [{
      type: 'thinking',
      thought: delta.reasoning_content,
      sourceField: 'reasoning_content',
      isHidden: false
    }]
  };
}

// Method 2: Parse non-streaming messages
private parseNonStreamingReasoning(
  message: ChatCompletionMessage | null | undefined
): ThinkingBlock | null {
  if (!message?.reasoning_content) return null;

  return {
    type: 'thinking',
    thought: message.reasoning_content,
    sourceField: 'reasoning_content',
    isHidden: false
  };
}

// Integration: In generateChatStream
for await (const chunk of stream) {
  const delta = chunk.choices[0]?.delta;

  // NEW: Parse reasoning BEFORE content
  const reasoning = this.parseStreamingReasoningDelta(delta);
  if (reasoning) yield reasoning;

  // EXISTING: Parse regular content
  if (delta.content) { /* ... */ }
}

// Integration: In generateChat (non-streaming)
const message = response.choices[0].message;
const blocks: ContentBlock[] = [];

// NEW: Parse reasoning FIRST
const thinkingBlock = this.parseNonStreamingReasoning(message);
if (thinkingBlock) blocks.push(thinkingBlock);

// EXISTING: Parse content
if (message.content) blocks.push({ type: 'text', text: message.content });
```

### Integration Points

**Called by:**
- `OpenAIProvider.generateChatStream()` - calls parseStreamingReasoningDelta for each delta
- `OpenAIProvider.generateChat()` - calls parseNonStreamingReasoning for response message

**Calls:**
- No external dependencies (operates on OpenAI SDK types)
- Returns IContent and ThinkingBlock instances defined in `../../services/history/IContent.js`

### Success Criteria

**What should happen when this code runs correctly:**
1. When API returns streaming chunk with `reasoning_content`, a ThinkingBlock is yielded BEFORE any TextBlock
2. When API returns non-streaming response with `reasoning_content`, ThinkingBlock appears BEFORE TextBlock in blocks array
3. When API response has no `reasoning_content`, parsing returns null without errors (graceful degradation)
4. ThinkingBlock instances have `sourceField: 'reasoning_content'` set correctly
5. All P10 tests pass without modification
6. All existing OpenAIProvider tests continue to pass

## Prerequisites

- Required: Phase 10a completed
- Verification: `cat project-plans/20251202thinking/.completed/P10a.md`
- Expected: Tests exist and fail with assertion errors

## Requirements Implemented (Expanded)

### REQ-THINK-003.1: Streaming Handler Detection and Parsing
**Full Text**: Streaming handler MUST detect and parse reasoning_content delta
**Behavior**:
- GIVEN: OpenAI-compatible model returns streaming response with reasoning_content in delta
- WHEN: parseStreamingReasoningDelta processes the delta
- THEN: Returns IContent with ThinkingBlock containing the reasoning text
**Why This Matters**: Models like Kimi K2-Thinking return reasoning as separate streaming chunks; without parsing these, users lose visibility into model reasoning

### REQ-THINK-003.2: Non-Streaming Handler Detection and Parsing
**Full Text**: Non-streaming handler MUST detect and parse reasoning_content field
**Behavior**:
- GIVEN: OpenAI-compatible model returns non-streaming response with reasoning_content field
- WHEN: parseNonStreamingReasoning processes the message
- THEN: Returns ThinkingBlock with sourceField='reasoning_content'
**Why This Matters**: Non-streaming API calls also include reasoning; consistent parsing ensures feature parity

### REQ-THINK-003.3: ThinkingBlock Metadata
**Full Text**: Parser MUST emit ThinkingBlock with sourceField='reasoning_content'
**Behavior**:
- GIVEN: Either streaming or non-streaming response contains reasoning_content
- WHEN: Parser creates ThinkingBlock
- THEN: ThinkingBlock.sourceField equals 'reasoning_content'
**Why This Matters**: sourceField enables round-trip serialization back to API format when sending history

### REQ-THINK-003.4: Graceful Absence Handling
**Full Text**: Parser MUST NOT break when reasoning_content is absent
**Behavior**:
- GIVEN: Response from model that does not support reasoning (no reasoning_content field)
- WHEN: Parser processes the response
- THEN: Returns null without errors, allowing normal content handling to proceed
**Why This Matters**: Ensures backward compatibility with all existing OpenAI-compatible models

## Implementation Tasks

### Files to Modify

#### `packages/core/src/providers/openai/OpenAIProvider.ts`

Replace stub implementations with real code:

```typescript
/**
 * Parse reasoning_content from streaming delta.
 *
 * @plan PLAN-20251202-THINKING.P11
 * @requirement REQ-THINK-003.1, REQ-THINK-003.3, REQ-THINK-003.4
 * @pseudocode openai-provider-reasoning.md lines 10-24
 */
private parseStreamingReasoningDelta(
  delta: ChatCompletionChunk.Choice.Delta | undefined
): IContent | null {
  if (!delta) {
    return null;
  }

  const reasoningContent = (delta as any).reasoning_content;

  // GAP 5 FIX: Enhanced error handling for malformed reasoning_content

  // Handle absent or null reasoning_content
  if (!reasoningContent) {
    return null;
  }

  // Handle non-string reasoning_content (log warning and skip)
  if (typeof reasoningContent !== 'string') {
    this.logger?.warn('Received non-string reasoning_content in streaming delta', {
      type: typeof reasoningContent,
      value: Array.isArray(reasoningContent) ? '[Array]' : reasoningContent,
    });
    return null;
  }

  // Handle empty string
  if (reasoningContent.length === 0) {
    return null;
  }

  // Handle excessively long reasoning_content (potential malicious input)
  const MAX_REASONING_LENGTH = 100_000; // 100k chars ~ 25k tokens max
  if (reasoningContent.length > MAX_REASONING_LENGTH) {
    this.logger?.warn('Received excessively long reasoning_content, truncating', {
      originalLength: reasoningContent.length,
      truncatedLength: MAX_REASONING_LENGTH,
    });
    // Truncate but continue processing
    const truncated = reasoningContent.substring(0, MAX_REASONING_LENGTH) + '\n[... truncated]';
    const thinkingBlock: ThinkingBlock = {
      type: 'thinking',
      thought: truncated,
      sourceField: 'reasoning_content',
      isHidden: false,
    };
    return {
      speaker: 'ai',
      blocks: [thinkingBlock],
    };
  }

  // Normal case: valid string
  const thinkingBlock: ThinkingBlock = {
    type: 'thinking',
    thought: reasoningContent,
    sourceField: 'reasoning_content',
    isHidden: false,
  };

  return {
    speaker: 'ai',
    blocks: [thinkingBlock],
  };
}

/**
 * Parse reasoning_content from non-streaming message.
 *
 * @plan PLAN-20251202-THINKING.P11
 * @requirement REQ-THINK-003.2, REQ-THINK-003.3, REQ-THINK-003.4
 * @pseudocode openai-provider-reasoning.md lines 60-70
 */
private parseNonStreamingReasoning(
  message: ChatCompletionMessage | null | undefined
): ThinkingBlock | null {
  if (!message) {
    return null;
  }

  const reasoningContent = (message as any).reasoning_content;

  // GAP 5 FIX: Enhanced error handling for malformed reasoning_content

  // Handle absent or null reasoning_content
  if (!reasoningContent) {
    return null;
  }

  // Handle non-string reasoning_content (log warning and skip)
  if (typeof reasoningContent !== 'string') {
    this.logger?.warn('Received non-string reasoning_content in non-streaming response', {
      type: typeof reasoningContent,
      value: Array.isArray(reasoningContent) ? '[Array]' : reasoningContent,
    });
    return null;
  }

  // Handle empty string
  if (reasoningContent.length === 0) {
    return null;
  }

  // Handle excessively long reasoning_content (potential malicious input)
  const MAX_REASONING_LENGTH = 100_000; // 100k chars ~ 25k tokens max
  if (reasoningContent.length > MAX_REASONING_LENGTH) {
    this.logger?.warn('Received excessively long reasoning_content, truncating', {
      originalLength: reasoningContent.length,
      truncatedLength: MAX_REASONING_LENGTH,
    });
    // Truncate but continue processing
    return {
      type: 'thinking',
      thought: reasoningContent.substring(0, MAX_REASONING_LENGTH) + '\n[... truncated]',
      sourceField: 'reasoning_content',
      isHidden: false,
    };
  }

  // Normal case: valid string
  return {
    type: 'thinking',
    thought: reasoningContent,
    sourceField: 'reasoning_content',
    isHidden: false,
  };
}
```

### Integration into Stream Handler

Find the stream processing loop and add reasoning handling BEFORE content:

```typescript
// In generateChatStream or equivalent
for await (const chunk of stream) {
  const delta = chunk.choices[0]?.delta;
  if (!delta) continue;

  // NEW: Handle reasoning_content BEFORE content
  const reasoningContent = this.parseStreamingReasoningDelta(delta);
  if (reasoningContent) {
    yield reasoningContent;
  }

  // EXISTING: Handle regular content
  if (delta.content) {
    // ... existing content handling ...
  }
}
```

**CRITICAL**: ThinkingBlocks are emitted as separate IContent blocks, NOT mixed with text content. This ensures:
1. History service stores reasoning separately from text
2. ThinkingBlocks can be filtered during message building (via `filterThinkingForContext`)
3. Reasoning display can be toggled independently of text

### Integration into Non-Streaming Handler

Find where message is processed and add reasoning before text:

```typescript
// In generateChat or equivalent
const message = response.choices[0].message;
const blocks: ContentBlock[] = [];

// NEW: Parse reasoning first
const thinkingBlock = this.parseNonStreamingReasoning(message);
if (thinkingBlock) {
  blocks.push(thinkingBlock);
}

// EXISTING: Parse content
if (message.content) {
  blocks.push({ type: 'text', text: message.content });
}
```

## Verification Commands

### Automated Checks

```bash
# Run tests - they should NOW PASS
npm test -- --run packages/core/src/providers/openai/__tests__/OpenAIProvider.reasoning.test.ts

# All OpenAI tests still pass
npm test -- --run packages/core/src/providers/openai/

# No stubs remain
grep "return null.*STUB" packages/core/src/providers/openai/OpenAIProvider.ts
# Expected: No matches

# TypeScript compiles
npm run typecheck

# Lint passes
npm run lint -- packages/core/src/providers/openai/
```

### Deferred Implementation Detection (MANDATORY)

```bash
# Run ALL of these checks - if ANY match, phase FAILS:

# Check for TODO/FIXME/HACK markers left in implementation
grep -rn -E "(TODO|FIXME|HACK|STUB|XXX|TEMPORARY|TEMP|WIP)" packages/core/src/providers/openai/OpenAIProvider.ts | grep -v ".test.ts"
# Expected: No matches (or only in comments explaining WHY, not WHAT to do)

# Check for "cop-out" comments
grep -rn -E "(in a real|in production|ideally|for now|placeholder|not yet|will be|should be)" packages/core/src/providers/openai/OpenAIProvider.ts | grep -v ".test.ts"
# Expected: No matches

# Check for empty/trivial implementations
grep -rn -E "return \[\]|return \{\}|return null|return undefined" packages/core/src/providers/openai/OpenAIProvider.ts | grep -v ".test.ts"
# Expected: No matches in reasoning-related functions (parseStreamingReasoningDelta and parseNonStreamingReasoning may return null for absent fields - verify these are intentional edge case handling, not placeholders)
```

### Semantic Verification Checklist (MANDATORY)

**Go beyond markers. Actually verify the behavior exists.**

#### Behavioral Verification Questions (answer ALL before proceeding)

1. **Does the code DO what the requirement says?**
   - [ ] I read REQ-THINK-003.1 and verified streaming parsing logic exists
   - [ ] I read REQ-THINK-003.2 and verified non-streaming parsing logic exists
   - [ ] I read REQ-THINK-003.3 and verified sourceField is set to 'reasoning_content'
   - [ ] I read REQ-THINK-003.4 and verified null returns for absent fields

2. **Is this REAL implementation, not placeholder?**
   - [ ] Deferred implementation detection passed (no TODO/HACK/STUB)
   - [ ] No empty returns in implementation (except valid null for absent content)
   - [ ] No "will be implemented" comments

3. **Would the test FAIL if implementation was removed?**
   - [ ] Test verifies ThinkingBlock structure, not just that code ran
   - [ ] Test would catch wrong sourceField value
   - [ ] Test would catch missing reasoning in output

4. **Is the feature REACHABLE by users?**
   - [ ] parseStreamingReasoningDelta called from stream processing loop
   - [ ] parseNonStreamingReasoning called from non-stream response handler
   - [ ] Path exists from API response to ThinkingBlock in IContent

5. **What's MISSING?** (list gaps that need fixing before proceeding)
   - [ ] [gap 1]
   - [ ] [gap 2]

#### Feature Actually Works

```bash
# Manual test: Verify parsing methods exist and have correct signatures
grep -A 10 "parseStreamingReasoningDelta" packages/core/src/providers/openai/OpenAIProvider.ts | head -15
grep -A 10 "parseNonStreamingReasoning" packages/core/src/providers/openai/OpenAIProvider.ts | head -15
# Expected: Methods with proper implementation (not just return null)
```

#### Integration Points Verified

- [ ] Stream handler correctly yields IContent from parseStreamingReasoningDelta return
- [ ] Non-stream handler correctly adds ThinkingBlock to result blocks array
- [ ] ThinkingBlock format matches IContent.ts ThinkingBlock interface
- [ ] Error in parsing does not crash stream (graceful degradation)

#### Edge Cases Verified

- [ ] Empty reasoning_content string: returns null (not empty ThinkingBlock)
- [ ] Null delta: returns null without error
- [ ] Undefined delta: returns null without error
- [ ] Valid reasoning_content: returns properly structured ThinkingBlock
- [ ] **GAP 5 FIXED**: Very long reasoning_content (>100k chars): truncated with warning logged
- [ ] **GAP 5 FIXED**: Non-string reasoning_content (array, object): returns null with warning logged
- [ ] **GAP 5 FIXED**: Non-string reasoning_content (number, boolean): returns null with warning logged

## Success Criteria

- All P10 tests pass
- Existing OpenAI tests still pass
- Implementation matches pseudocode
- TypeScript and lint pass

## Failure Recovery

If tests fail:

1. Compare implementation to pseudocode
2. Check OpenAI types for reasoning_content
3. Ensure type assertions are correct
4. Fix implementation (not tests)

## Phase Completion Marker

Create: `project-plans/20251202thinking/.completed/P11.md`
