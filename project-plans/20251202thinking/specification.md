# Feature Specification: Reasoning/Thinking Token Support

## Purpose

Enable LLXPRT to properly handle reasoning/thinking tokens from models like Kimi K2-Thinking, MiniMax m2, DeepSeek R1, and others that use the OpenAI-compatible `reasoning_content` field. The critical issue: **some models require reasoning tokens in subsequent requests** or they break (Kimi K2 Thinking stops working after tool calls if `reasoning_content` is not included).

## Architectural Decisions

- **Pattern**: Settings-driven behavior via ephemeral settings, no hardcoded model capabilities
- **Storage**: Neutral `ThinkingBlock` format in HistoryService, providers transform on ingress/egress
- **Configuration**: Ephemeral settings controllable via `/set`, saved/loaded via `/profile`
- **Integration**: Utility functions in `reasoningUtils.ts` to avoid provider code duplication

## Project Structure

```
packages/core/src/
  providers/
    reasoning/
      reasoningUtils.ts           # Utility functions for reasoning handling
      reasoningUtils.test.ts      # Unit tests
    openai/
      OpenAIProvider.ts           # Modified to parse/emit reasoning
  services/
    history/
      IContent.ts                 # Enhanced ThinkingBlock interface
      HistoryService.ts           # Context limit calculations
packages/cli/src/
  ui/
    components/                   # Rendering for thinking blocks
```

## Technical Environment

- **Type**: CLI Tool
- **Runtime**: Node.js 20.x
- **Dependencies**: Existing LLXPRT dependencies (no new external deps)

## Integration Points (MANDATORY SECTION)

### Existing Code That Will Use This Feature

- `packages/core/src/providers/openai/OpenAIProvider.ts` - Will parse `reasoning_content` from responses and include in outgoing messages
- `packages/core/src/core/geminiChat.ts` - Will use effective token calculation for context limits
- `packages/core/src/services/history/HistoryService.ts` - Will provide filtered history based on reasoning settings
- `packages/cli/src/ui/` - Will render ThinkingBlocks with appropriate styling
- Context compression logic - Will use effective token count, not raw count

### Existing Code To Be Replaced

- Current behavior that ignores `reasoning_content` field in OpenAI-compatible responses
- Current context limit calculation that doesn't account for stripped reasoning tokens
- Current compression trigger that uses raw token count

### User Access Points

- CLI: `/set reasoning.includeInContext true|false`
- CLI: `/set reasoning.includeInResponse true|false`
- CLI: `/set reasoning.effort minimal|low|medium|high`
- CLI: `/set reasoning.maxTokens <number>`
- CLI: `/set reasoning.format native|field`
- CLI: `/set reasoning.stripFromContext all|allButLast|none`
- CLI: `/profile save/load` to persist reasoning settings

### Migration Requirements

- None - new feature, no existing data to migrate
- Existing conversations without thinking blocks continue to work unchanged

## Formal Requirements

```
[REQ-THINK-001] ThinkingBlock Interface Enhancement
  [REQ-THINK-001.1] ThinkingBlock MUST include sourceField property for round-trip serialization
  [REQ-THINK-001.2] ThinkingBlock MUST include optional signature property for Anthropic compatibility
  [REQ-THINK-001.3] ThinkingBlock MUST be part of ContentBlock union type (already is)

[REQ-THINK-002] Reasoning Utility Functions
  [REQ-THINK-002.1] extractThinkingBlocks MUST extract all ThinkingBlock instances from IContent
  [REQ-THINK-002.2] filterThinkingForContext MUST filter based on stripFromContext policy
  [REQ-THINK-002.3] thinkingToReasoningField MUST convert ThinkingBlocks to single reasoning_content string
  [REQ-THINK-002.4] estimateThinkingTokens MUST return token estimate for thinking content

[REQ-THINK-003] OpenAI Provider Parsing
  [REQ-THINK-003.1] Streaming handler MUST detect and parse reasoning_content delta
  [REQ-THINK-003.2] Non-streaming handler MUST detect and parse reasoning_content field
  [REQ-THINK-003.3] Parser MUST emit ThinkingBlock with sourceField='reasoning_content'
  [REQ-THINK-003.4] Parser MUST NOT break when reasoning_content is absent

[REQ-THINK-004] OpenAI Provider Message Building
  [REQ-THINK-004.1] Message builder MUST read reasoning.includeInContext ephemeral setting
  [REQ-THINK-004.2] Message builder MUST read reasoning.stripFromContext ephemeral setting
  [REQ-THINK-004.3] When includeInContext=true, assistant messages MUST include reasoning_content field
  [REQ-THINK-004.4] When includeInContext=false, assistant messages MUST NOT include reasoning_content
  [REQ-THINK-004.5] Message builder MUST apply stripFromContext policy before building

[REQ-THINK-005] Context Limit Handling
  [REQ-THINK-005.1] Context usage display MUST reflect effective token count (after stripping)
  [REQ-THINK-005.2] Compression trigger MUST use effective token count, not raw count
  [REQ-THINK-005.3] Effective count calculation MUST respect current ephemeral settings

[REQ-THINK-006] Ephemeral Settings
  [REQ-THINK-006.1] reasoning.enabled MUST default to true
  [REQ-THINK-006.2] reasoning.includeInContext MUST default to false
  [REQ-THINK-006.3] reasoning.includeInResponse MUST default to true
  [REQ-THINK-006.4] reasoning.format MUST default to 'field'
  [REQ-THINK-006.5] reasoning.stripFromContext MUST default to 'none'
  [REQ-THINK-006.6] All reasoning.* settings MUST be saveable via /profile save

[REQ-THINK-007] UI Rendering
  [REQ-THINK-007.1] ThinkingBlocks MUST render inline with shaded background
  [REQ-THINK-007.2] ThinkingBlocks MUST render with italic text
  [REQ-THINK-007.3] Shading MUST be theme-aware (lighter in dark mode, darker in light mode)
  [REQ-THINK-007.4] reasoning.includeInResponse=false MUST hide ThinkingBlocks from display
```

## Data Schemas

```typescript
// Enhanced ThinkingBlock (IContent.ts)
interface ThinkingBlock {
  type: 'thinking';
  thought: string;
  isHidden?: boolean;
  sourceField?: 'reasoning_content' | 'thinking' | 'thought';
  signature?: string;
}

// Ephemeral settings structure (conceptual)
interface ReasoningEphemeralSettings {
  'reasoning.enabled': boolean;
  'reasoning.includeInContext': boolean;
  'reasoning.includeInResponse': boolean;
  'reasoning.effort': 'minimal' | 'low' | 'medium' | 'high';
  'reasoning.maxTokens': number;
  'reasoning.format': 'native' | 'field';
  'reasoning.stripFromContext': 'all' | 'allButLast' | 'none';
}

// OpenAI message with reasoning (what we send to API)
interface OpenAIMessageWithReasoning {
  role: 'assistant';
  content: string;
  reasoning_content?: string;
}

// OpenAI streaming delta with reasoning (what we receive)
interface OpenAIDeltaWithReasoning {
  content?: string;
  reasoning_content?: string;
}
```

## Example Data

```json
{
  "streamingChunkWithReasoning": {
    "choices": [{
      "delta": {
        "reasoning_content": "Let me think about this step by step..."
      }
    }]
  },
  "streamingChunkWithContent": {
    "choices": [{
      "delta": {
        "content": "Here is my answer..."
      }
    }]
  },
  "assistantMessageWithReasoning": {
    "role": "assistant",
    "content": "Here is my answer...",
    "reasoning_content": "I considered several approaches..."
  },
  "thinkingBlockNeutral": {
    "type": "thinking",
    "thought": "I considered several approaches...",
    "sourceField": "reasoning_content",
    "isHidden": false
  }
}
```

## Constraints

- No hardcoded model capability detection - all behavior via ephemeral settings
- No breaking changes to existing ThinkingBlock consumers
- Must work with existing profile save/load mechanism
- Must not break models that don't return reasoning_content

## Setting Behavior Clarifications

### `reasoning.enabled` (REQ-THINK-006.1)

**Default**: `true`

**Behavior when `false`**:
- Provider will NOT request reasoning tokens from the model
- No `reasoning_content` field will be added to outgoing requests
- If model spontaneously returns reasoning, it will still be parsed and stored
- This setting primarily controls the request side, not response handling

**Use Case**: Disable reasoning to save tokens/cost when not needed.

### `reasoning.format` (REQ-THINK-006.4)

**Default**: `'field'`

**Values**:
- `'field'`: Use `reasoning_content` field in OpenAI-compatible format (implemented)
- `'native'`: **FUTURE SCOPE** - Use provider-native thinking format

**`native` format is OUT OF SCOPE for this plan**. When implemented in a future plan:
- OpenAI: Would use `reasoning_content` (same as `field`)
- Anthropic: Would use extended thinking API
- Gemini: Would use thoughts field
- Other providers: Would fall back to `field`

For this plan, `native` is accepted as a valid value but behaves identically to `field`.

### `reasoning.stripFromContext` Interaction with `includeInContext`

**Processing Order**:
1. `stripFromContext` is applied first (filters which thinking blocks are kept)
2. `includeInContext` determines if remaining thinking is sent to API

**Example**:
```
History: [T1, R1], [T2, R2], [T3, R3]  (T=thinking, R=response)

stripFromContext='allButLast', includeInContext=true:
  → Only T3 sent to API

stripFromContext='allButLast', includeInContext=false:
  → No thinking sent to API (T3 filtered by includeInContext)

stripFromContext='none', includeInContext=true:
  → T1, T2, T3 all sent to API
```

## Performance Requirements

- Parsing reasoning_content: negligible overhead (streaming already processes deltas)
- Token estimation: use existing tokenizer, no new dependencies
- Context calculation: computed once per request, cached
