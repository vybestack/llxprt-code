# Reasoning/Thinking Token Support

## Overview

LLXPRT needs to support reasoning/thinking tokens across multiple providers (Kimi K2, MiniMax m2, DeepSeek, Anthropic, Gemini, etc.) with cross-compatible context handling. The critical discovery: **some models require reasoning tokens in subsequent requests** or they break (Kimi K2 Thinking stops working after tool calls if reasoning_content is not included).

## Core Philosophy

**LLXPRT stays dumb about models.** All reasoning behavior is controlled by **ephemeral settings** which can be saved/loaded via model profiles. No hardcoded model capability registry.

---

## Problem Statement

### Current Issues

1. **Kimi K2 Thinking breaks** after tool calls because `reasoning_content` is not included in subsequent turns
2. **MiniMax m2** has similar requirements
3. **Gemini 2.5** is the only provider with thinking support today (and it filters thinking from history)
4. Token tracking has `thoughts_token_count` scaffolding but it's never populated
5. No unified way to control reasoning behavior across providers

### Root Cause

Different models have different requirements:
- **Kimi K2 / DeepSeek / MiniMax**: REQUIRE `reasoning_content` in context
- **Anthropic Claude**: Recommends preserving `thinking` blocks for continuity
- **Gemini 2.5**: Optional, currently filtered out
- **OpenAI o1/o3**: Internal reasoning, not returned to client

Without ephemeral settings to control this, LLXPRT can't adapt to each model's needs.

---

## Ephemeral Settings for Reasoning

New settings controllable via `/set`:

| Setting | Values | Default | Description |
|---------|--------|---------|-------------|
| `reasoning.enabled` | `true \| false` | `true` | Parse reasoning from responses |
| `reasoning.includeInContext` | `true \| false` | `false` | Include reasoning in subsequent turns |
| `reasoning.includeInResponse` | `true \| false` | `true` | Show reasoning to user |
| `reasoning.effort` | `minimal \| low \| medium \| high` | (none) | For OpenAI-style models |
| `reasoning.maxTokens` | `<number>` | (none) | Budget for Anthropic-style models |
| `reasoning.format` | `native \| field` | `field` | How to send back to provider |
| `reasoning.stripFromContext` | `all \| allButLast \| none` | `none` | What to strip before sending |

### Profile Integration

Settings saved with `/profile save mymodel` and restored with `/profile load mymodel`.

Example profiles:
```
# kimi-k2-thinking profile
reasoning.includeInContext = true
reasoning.format = field

# claude-sonnet-4 profile
reasoning.includeInContext = true
reasoning.format = native

# gemini-2.5-flash profile
reasoning.includeInContext = false

# gpt-4o profile
reasoning.enabled = false
```

---

## Architecture

### 1. Storage: Neutral Format in HistoryService

All thinking blocks stored as `ThinkingBlock` in HistoryService. **No filtering at storage time** - that's the provider's job on the way out.

```typescript
interface ThinkingBlock {
  type: 'thinking';
  thought: string;
  isHidden?: boolean;
  sourceField?: 'reasoning_content' | 'thinking' | 'thought';  // For round-trip
  signature?: string;  // Anthropic signatures
}
```

### 2. Transformation: Provider Responsibility

Each provider:
1. **Parses** incoming reasoning (from API response) → `ThinkingBlock`
2. **Transforms** outgoing reasoning (to API request) based on ephemeral settings
3. Uses **utility functions** from `reasoningUtils.ts`

### 3. Utility Functions

New file: `packages/core/src/providers/reasoning/reasoningUtils.ts`

```typescript
// Extract thinking blocks from IContent
extractThinkingBlocks(content: IContent): ThinkingBlock[]

// Filter content based on stripFromContext setting
filterThinkingForContext(
  contents: IContent[],
  stripPolicy: 'all' | 'allButLast' | 'none'
): IContent[]

// Convert ThinkingBlock to OpenAI-compatible format
thinkingToReasoningField(blocks: ThinkingBlock[]): string | undefined

// Convert ThinkingBlock to Anthropic format
thinkingToAnthropicBlocks(blocks: ThinkingBlock[]): AnthropicThinkingBlock[]

// Convert ThinkingBlock to Gemini format
thinkingToGeminiParts(blocks: ThinkingBlock[]): GeminiThoughtPart[]

// Estimate token count for thinking blocks
estimateThinkingTokens(blocks: ThinkingBlock[]): number
```

---

## Context Limit & Compression Handling

### Display Calculation

When displaying context usage (e.g., `123000/212000`):
- If `reasoning.stripFromContext = all` or `allButLast`: Don't count stripped thinking tokens
- If `reasoning.stripFromContext = none` AND `reasoning.includeInContext = true`: Count thinking tokens

The display shows the **effective** context size based on what will actually be sent.

### Compression Trigger

**Critical**: Compression must respect the same logic as display.

When determining if compression is needed:
1. Calculate **effective token count** (excluding stripped thinking tokens)
2. Compare against context limit
3. Trigger compression based on effective count, not raw count

When performing compression:
1. If thinking tokens are being stripped anyway (`stripFromContext = all`), they don't contribute to the problem
2. If thinking tokens are included, they're fair game for compression summarization
3. The compressor should be aware of `ThinkingBlock` type and handle appropriately

### Implementation

```typescript
// In context limit calculation
function getEffectiveTokenCount(
  contents: IContent[],
  settings: EphemeralSettings
): number {
  const stripPolicy = settings.get('reasoning.stripFromContext') || 'none';
  const includeInContext = settings.get('reasoning.includeInContext') ?? false;

  // If we're stripping thinking, don't count those tokens
  if (stripPolicy === 'all' || !includeInContext) {
    const filtered = filterThinkingForContext(contents, 'all');
    return estimateTokens(filtered);
  }

  if (stripPolicy === 'allButLast') {
    const filtered = filterThinkingForContext(contents, 'allButLast');
    return estimateTokens(filtered);
  }

  // Count everything
  return estimateTokens(contents);
}

// Compression decision
function shouldCompress(
  contents: IContent[],
  contextLimit: number,
  settings: EphemeralSettings
): boolean {
  const effectiveCount = getEffectiveTokenCount(contents, settings);
  return effectiveCount > contextLimit * COMPRESSION_THRESHOLD;
}
```

---

## UI Rendering

Thinking blocks displayed **inline** with:
- Slightly shaded background (theme-aware: lighter shade in dark mode, darker shade in light mode)
- Italic text
- Visible by default
- Controlled by `reasoning.includeInResponse` setting (takes effect immediately in UI)

No collapsible panels - just styled inline text.

---

## Phase 1: OpenAI Provider (Kimi K2 & MiniMax m2)

### Scope

Focus exclusively on `OpenAIProvider.ts` for models using the OpenAI-compatible Chat Completions API with `reasoning_content` field.

### Changes Required

#### 1. Parse `reasoning_content` from responses

```typescript
// In streaming handler
for await (const chunk of stream) {
  const delta = chunk.choices[0]?.delta;

  if ('reasoning_content' in delta && delta.reasoning_content) {
    yield {
      speaker: 'ai',
      blocks: [{
        type: 'thinking',
        thought: delta.reasoning_content,
        sourceField: 'reasoning_content',
        isHidden: false
      }]
    };
  }

  // Existing content handling...
}
```

#### 2. Build messages with reasoning based on settings

```typescript
private buildMessagesWithReasoning(
  contents: IContent[],
  settings: EphemeralSettings
): OpenAIMessage[] {
  const stripPolicy = settings.get('reasoning.stripFromContext') || 'none';
  const includeInContext = settings.get('reasoning.includeInContext') ?? false;
  const format = settings.get('reasoning.format') || 'field';

  const filtered = filterThinkingForContext(contents, stripPolicy);

  return filtered.map(content => {
    if (content.speaker === 'ai') {
      const thinking = extractThinkingBlocks(content);
      const text = getTextContent(content);

      if (includeInContext && thinking.length > 0 && format === 'field') {
        return {
          role: 'assistant',
          content: text,
          reasoning_content: thinkingToReasoningField(thinking)
        };
      }

      return { role: 'assistant', content: text };
    }
    // ... other speakers
  });
}
```

---

## Future Phases

### Phase 2: Anthropic Provider
- Handle `thinking_delta` streaming events
- Handle `thinking` content blocks
- Add `anthropic-beta: interleaved-thinking-2025-05-14` header
- Preserve signatures

### Phase 3: Token Tracking
- Wire up `thoughts_token_count` extraction
- Update telemetry display
- Add to billing/usage reports

### Phase 4: Gemini Updates
- Review current thinking support
- Ensure it respects new ephemeral settings
- Align with unified approach

---

## Files to Modify

| File | Changes |
|------|---------|
| `packages/core/src/services/history/IContent.ts` | Add `sourceField`, `signature` to ThinkingBlock |
| **NEW** `packages/core/src/providers/reasoning/reasoningUtils.ts` | Utility functions |
| `packages/core/src/providers/openai/OpenAIProvider.ts` | Parse reasoning, build messages with settings |
| `packages/cli/src/ui/` (rendering files) | Render thinking with shading/italics |
| Context limit/compression logic | Respect effective token count |

---

## Testing Strategy

1. **Unit tests** for `reasoningUtils.ts` functions
2. **Integration tests** with mock OpenAI responses containing `reasoning_content`
3. **Manual testing** with Kimi K2 and MiniMax m2 via Synthetic/OpenRouter
4. **Context limit tests** verifying compression triggers correctly with/without thinking tokens

---

## Success Criteria

1. Kimi K2 Thinking completes multi-turn conversations with tool calls
2. MiniMax m2 reasoning flows through correctly
3. Thinking blocks visible in UI with appropriate styling
4. `/set reasoning.includeInContext true` makes model work, `false` breaks it (expected)
5. Context limit display reflects effective token count
6. Compression triggers based on effective count, not raw count
7. Profiles can save/restore reasoning settings

---

## References

- GitHub Issue #398: Main reasoning tracking issue
- GitHub Issue #679: Kimi K2-thinking support
- GitHub Issue #693: Kimi thinking tokens
- GitHub Issue #694: Anthropic thinking support
- OpenRouter reasoning documentation: https://openrouter.ai/docs/use-cases/reasoning-tokens
- models.dev API: https://models.dev/api.json
- Code Puppy models_dev_parser.py: Reference implementation
