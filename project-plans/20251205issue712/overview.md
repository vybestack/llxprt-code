# Issue 712: Kimi K2 Thinking Streaming Tool ID Fix

## Problem Statement

Kimi K2 (kimi-k2-0711-preview) uses a non-standard tool call ID format that breaks multi-turn tool calling conversations. When K2 makes tool calls, it expects to receive responses with IDs in its specific format, but our normalization pipeline destroys this format.

### K2's Tool Call ID Format

K2 uses: `functions.{tool_name}:{global_index}`

Example: `functions.read_file:3`

### The Broken Pipeline

```
K2 Returns:           functions.read_file:3
        ↓
extractKimiToolCallsFromText() calls normalizeToHistoryToolId(rawId)
        ↓
sanitize() strips '.' and ':' → hist_tool_functionsread_file3
        ↓
When building messages: normalizeToOpenAIToolId() → call_functionsread_file3
        ↓
K2 Expects:           functions.read_file:3   ❌ MISMATCH
        ↓
K2 crashes/loops because tool_call_id doesn't match its internal state
```

### Root Cause

The `sanitize()` function in `normalizeToOpenAIToolId()` removes all non-alphanumeric characters except underscore:

```typescript
const sanitize = (value: string) =>
  value.replace(/[^a-zA-Z0-9_]/g, '') || 'call_' + crypto.randomUUID().replace(/-/g, '');
```

This strips the `.` and `:` characters that K2 requires in its ID format.

## Constraint: Model Switching

Users must be able to switch models mid-conversation while sharing context. This means:

- We cannot simply store K2's exact IDs (other providers won't understand them)
- When switching TO K2 from another provider, there are no K2 IDs to preserve
- We need a provider-agnostic internal format with dynamic ID generation per-provider

## Solution: Add `kimi` Tool Format with Dynamic ID Regeneration

### Approach

1. Add `'kimi'` as a new value in the `ToolFormat` type
2. The `kimi` format implies both OpenAI-style tool definitions AND K2-style ID handling
3. When building messages for K2, dynamically regenerate K2-format IDs based on conversation position
4. Auto-detect K2 models in `detectToolFormat()`
5. Users can manually override with `/toolformat kimi`

### How Dynamic ID Regeneration Works

When building messages for K2:

1. Scan all tool calls in conversation history
2. Assign each a K2 ID: `functions.{toolName}:{globalIndex}` (0-indexed)
3. Tool responses use the same mapping to find their corresponding call's K2 ID
4. The mapping is rebuilt fresh each time messages are constructed

This works for model switching because:
- Internal format stays `hist_tool_xxx` (provider-agnostic)
- When switching TO K2, we regenerate K2 IDs for the entire history
- When switching FROM K2, other providers use their standard ID formats

### ToolFormat Type Extension

```typescript
export type ToolFormat =
  | 'openai'
  | 'anthropic'
  | 'deepseek'
  | 'qwen'
  | 'kimi'      // NEW: Kimi/K2 with K2-style ID handling
  | 'hermes'
  | 'xml'
  | 'llama'
  | 'gemma';
```

## Architecture

### New Module: `ToolIdStrategy.ts`

Location: `packages/core/src/tools/ToolIdStrategy.ts`

```typescript
export interface ToolIdMapper {
  resolveToolCallId(tc: ToolCallBlock): string;
  resolveToolResponseId(tr: ToolResponseBlock): string;
}

export interface ToolIdStrategy {
  createMapper(contents: IContent[]): ToolIdMapper;
}

// Standard strategy: uses normalizeToOpenAIToolId (call_xxx format)
export const standardStrategy: ToolIdStrategy;

// Kimi strategy: generates functions.{name}:{idx} format
export const kimiStrategy: ToolIdStrategy;

// Get strategy for a tool format
export function getToolIdStrategy(format: ToolFormat): ToolIdStrategy;

// Detect if model requires kimi format
export function isKimiModel(model: string): boolean;
```

### Provider Integration

Both `OpenAIProvider.ts` and `OpenAIVercelProvider.ts` will:

1. Detect tool format via `detectToolFormat()` (auto-detects `kimi` for K2 models)
2. Get the appropriate ID strategy via `getToolIdStrategy(format)`
3. Create a mapper from conversation contents
4. Use the mapper when building messages

```typescript
// In buildMessagesWithReasoning() or equivalent:
const format = this.detectToolFormat();
const strategy = getToolIdStrategy(format);
const idMapper = strategy.createMapper(contents);

// When building tool_calls:
tool_calls: toolCalls.map((tc) => ({
  id: idMapper.resolveToolCallId(tc),
  type: 'function',
  function: { name: tc.name, arguments: ... }
}))

// When building tool responses:
messages.push({
  role: 'tool',
  content: ...,
  tool_call_id: idMapper.resolveToolResponseId(tr)
});
```

### Auto-Detection

In `detectToolFormat()`:

```typescript
private detectToolFormat(): ToolFormat {
  const modelName = (this.getModel() || this.getDefaultModel()).toLowerCase();

  // K2 models use kimi format
  if (modelName.includes('kimi') || modelName.includes('k2')) {
    return 'kimi';
  }

  // ... existing detection for qwen, glm, etc.
}
```

### `/toolformat` Command Update

Update `toolformatCommand.ts` to include `kimi`:

```typescript
const STRUCTURED_FORMATS = ['openai', 'anthropic', 'deepseek', 'qwen', 'kimi', 'gemma'];
```

## Files to Modify

| File | Changes |
|------|---------|
| `packages/core/src/tools/IToolFormatter.ts` | Add `'kimi'` to `ToolFormat` type |
| `packages/core/src/tools/ToolIdStrategy.ts` | **NEW** - ID strategy module |
| `packages/core/src/tools/ToolFormatter.ts` | Handle `kimi` format (same as `qwen` for tool definitions) |
| `packages/core/src/providers/openai/OpenAIProvider.ts` | Integrate ID strategy in message building |
| `packages/core/src/providers/openai-vercel/OpenAIVercelProvider.ts` | Integrate ID strategy in message building |
| `packages/core/src/providers/openai-vercel/messageConversion.ts` | Accept ID resolver parameter |
| `packages/cli/src/ui/commands/toolformatCommand.ts` | Add `kimi` to format list |

## Implementation Phases (TDD Approach)

Following the TDD process from `dev-docs/RULES.md`: RED → GREEN → REFACTOR → COMMIT

### Phase 1: ToolIdStrategy Module (Test-First)

#### 1.1 RED: Write failing tests for `isKimiModel()`

```typescript
// packages/core/src/tools/ToolIdStrategy.test.ts
describe('isKimiModel', () => {
  it('should return true for kimi-k2-0711-preview', () => {
    expect(isKimiModel('kimi-k2-0711-preview')).toBe(true);
  });

  it('should return true for K2-Thinking', () => {
    expect(isKimiModel('K2-Thinking')).toBe(true);
  });

  it('should return false for gpt-4o', () => {
    expect(isKimiModel('gpt-4o')).toBe(false);
  });

  it('should return false for qwen3-coder-plus', () => {
    expect(isKimiModel('qwen3-coder-plus')).toBe(false);
  });
});
```

#### 1.2 GREEN: Implement minimal `isKimiModel()`

#### 1.3 RED: Write failing tests for `kimiStrategy.createMapper()`

```typescript
describe('kimiStrategy', () => {
  describe('createMapper', () => {
    it('should generate K2 ID for first tool call', () => {
      const contents: IContent[] = [
        {
          speaker: 'ai',
          blocks: [{ type: 'tool_call', id: 'hist_tool_abc', name: 'read_file', parameters: {} }]
        }
      ];
      const mapper = kimiStrategy.createMapper(contents);
      expect(mapper.resolveToolCallId(contents[0].blocks[0] as ToolCallBlock))
        .toBe('functions.read_file:0');
    });

    it('should generate sequential K2 IDs for multiple tool calls', () => {
      const contents: IContent[] = [
        {
          speaker: 'ai',
          blocks: [
            { type: 'tool_call', id: 'hist_tool_1', name: 'read_file', parameters: {} },
            { type: 'tool_call', id: 'hist_tool_2', name: 'glob', parameters: {} }
          ]
        }
      ];
      const mapper = kimiStrategy.createMapper(contents);
      const blocks = contents[0].blocks as ToolCallBlock[];
      expect(mapper.resolveToolCallId(blocks[0])).toBe('functions.read_file:0');
      expect(mapper.resolveToolCallId(blocks[1])).toBe('functions.glob:1');
    });

    it('should resolve tool response ID to match its call', () => {
      const contents: IContent[] = [
        {
          speaker: 'ai',
          blocks: [{ type: 'tool_call', id: 'hist_tool_abc', name: 'read_file', parameters: {} }]
        },
        {
          speaker: 'tool',
          blocks: [{ type: 'tool_response', callId: 'hist_tool_abc', toolName: 'read_file', result: {} }]
        }
      ];
      const mapper = kimiStrategy.createMapper(contents);
      const response = contents[1].blocks[0] as ToolResponseBlock;
      expect(mapper.resolveToolResponseId(response)).toBe('functions.read_file:0');
    });
  });
});
```

#### 1.4 GREEN: Implement `kimiStrategy`

#### 1.5 RED: Write failing tests for `standardStrategy`

```typescript
describe('standardStrategy', () => {
  it('should normalize hist_tool_xxx to call_xxx format', () => {
    const contents: IContent[] = [
      {
        speaker: 'ai',
        blocks: [{ type: 'tool_call', id: 'hist_tool_abc123', name: 'read_file', parameters: {} }]
      }
    ];
    const mapper = standardStrategy.createMapper(contents);
    expect(mapper.resolveToolCallId(contents[0].blocks[0] as ToolCallBlock))
      .toBe('call_abc123');
  });
});
```

#### 1.6 GREEN: Implement `standardStrategy`

#### 1.7 REFACTOR: Extract common patterns if valuable

#### 1.8 COMMIT: `feat(tools): add ToolIdStrategy module with kimi and standard strategies`

### Phase 2: Extend ToolFormat Type (Test-First)

#### 2.1 RED: Write failing test for kimi format in ToolFormatter

```typescript
// packages/core/src/tools/ToolFormatter.test.ts
describe('ToolFormatter', () => {
  describe('toProviderFormat with kimi', () => {
    it('should convert tools to OpenAI format (same as qwen)', () => {
      const tools: ITool[] = [
        { type: 'function', function: { name: 'read_file', description: 'Read a file', parameters: {} } }
      ];
      const result = formatter.toProviderFormat(tools, 'kimi');
      expect(result).toEqual([
        { type: 'function', function: { name: 'read_file', description: 'Read a file', parameters: {} } }
      ]);
    });
  });
});
```

#### 2.2 GREEN: Add `'kimi'` to ToolFormat type and handle in ToolFormatter

#### 2.3 COMMIT: `feat(tools): add kimi to ToolFormat type`

### Phase 3: OpenAIProvider Integration (Test-First)

#### 3.1 RED: Write failing test for K2 model detection

```typescript
// packages/core/src/providers/openai/OpenAIProvider.toolFormatDetection.test.ts
describe('detectToolFormat for K2 models', () => {
  it('should detect kimi format for kimi-k2-0711-preview', () => {
    const provider = createTestProvider({ model: 'kimi-k2-0711-preview' });
    expect(provider.getToolFormat()).toBe('kimi');
  });

  it('should detect kimi format for K2-Thinking', () => {
    const provider = createTestProvider({ model: 'K2-Thinking' });
    expect(provider.getToolFormat()).toBe('kimi');
  });
});
```

#### 3.2 GREEN: Update `detectToolFormat()` to detect K2 models

#### 3.3 RED: Write failing integration test for K2 message building

```typescript
describe('buildMessagesWithReasoning for K2', () => {
  it('should use K2 ID format for tool calls when format is kimi', () => {
    const contents: IContent[] = [
      { speaker: 'human', blocks: [{ type: 'text', text: 'list files' }] },
      {
        speaker: 'ai',
        blocks: [{ type: 'tool_call', id: 'hist_tool_abc', name: 'glob', parameters: {} }]
      },
      {
        speaker: 'tool',
        blocks: [{ type: 'tool_response', callId: 'hist_tool_abc', toolName: 'glob', result: ['file.ts'] }]
      }
    ];

    const messages = provider.buildMessagesForTest(contents, { model: 'kimi-k2-0711-preview' });

    const assistantMsg = messages.find(m => m.role === 'assistant' && m.tool_calls);
    expect(assistantMsg.tool_calls[0].id).toBe('functions.glob:0');

    const toolMsg = messages.find(m => m.role === 'tool');
    expect(toolMsg.tool_call_id).toBe('functions.glob:0');
  });
});
```

#### 3.4 GREEN: Integrate ToolIdStrategy into `buildMessagesWithReasoning()`

#### 3.5 REFACTOR: Extract message building helpers if valuable

#### 3.6 COMMIT: `feat(openai): integrate kimi tool ID strategy`

### Phase 4: OpenAIVercelProvider Integration (Test-First)

#### 4.1 RED: Write failing test for messageConversion with kimi format

```typescript
// packages/core/src/providers/openai-vercel/messageConversion.test.ts
describe('convertToVercelMessages with kimi ID resolver', () => {
  it('should use K2 ID format when kimi resolver provided', () => {
    const contents: IContent[] = [
      {
        speaker: 'ai',
        blocks: [{ type: 'tool_call', id: 'hist_tool_xyz', name: 'read_file', parameters: {} }]
      }
    ];
    const mapper = kimiStrategy.createMapper(contents);
    const messages = convertToVercelMessages(contents, {
      resolveToolCallId: (id, name) => mapper.resolveToolCallId({ id, name } as ToolCallBlock),
      resolveToolResponseId: (callId, name) => mapper.resolveToolResponseId({ callId, toolName: name } as ToolResponseBlock)
    });

    const assistantMsg = messages[0];
    expect(assistantMsg.content[0].toolCallId).toBe('functions.read_file:0');
  });
});
```

#### 4.2 GREEN: Update `convertToVercelMessages` to accept ID resolver

#### 4.3 RED: Write failing test for OpenAIVercelProvider K2 detection

```typescript
describe('OpenAIVercelProvider K2 detection', () => {
  it('should detect kimi format for kimi-k2 models', () => {
    const provider = createTestVercelProvider({ model: 'kimi-k2-0711-preview' });
    expect(provider.getToolFormat()).toBe('kimi');
  });
});
```

#### 4.4 GREEN: Update `detectToolFormat()` in OpenAIVercelProvider

#### 4.5 COMMIT: `feat(openaivercel): integrate kimi tool ID strategy`

### Phase 5: CLI Integration (Test-First)

#### 5.1 RED: Write failing test for /toolformat kimi command

```typescript
// packages/cli/src/ui/commands/toolformatCommand.test.ts
describe('/toolformat kimi', () => {
  it('should accept kimi as a valid format', async () => {
    const result = await toolformatCommand.action(mockContext, 'kimi');
    expect(result.messageType).toBe('info');
    expect(result.content).toContain('kimi');
  });
});
```

#### 5.2 GREEN: Add `'kimi'` to STRUCTURED_FORMATS

#### 5.3 COMMIT: `feat(cli): add kimi to /toolformat command`

### Phase 6: End-to-End Integration Tests

#### 6.1 Multi-turn K2 tool calling

```typescript
describe('K2 multi-turn tool calling', () => {
  it('should complete 4 rounds of tool calls without crash', async () => {
    // This tests the full pipeline with real K2 message format
  });
});
```

#### 6.2 Model switching tests

```typescript
describe('model switching with tool history', () => {
  it('should preserve context when switching from OpenAI to K2', async () => {
    // History from OpenAI should work when continuing with K2
  });

  it('should preserve context when switching from K2 to OpenAI', async () => {
    // History from K2 should work when continuing with OpenAI
  });
});
```

#### 6.3 COMMIT: `test: add end-to-end tests for K2 tool calling`

## Testing Requirements

1. **K2 ID round-trip**: Verify `functions.read_file:0` is preserved through pipeline
2. **Multi-turn K2**: 4+ tool call rounds without crash
3. **Model switching to K2**: History from OpenAI works when switching to K2
4. **Model switching from K2**: History from K2 works when switching to OpenAI
5. **Auto-detection**: K2 models correctly detected as `kimi` format
6. **Manual override**: `/toolformat kimi` works correctly
7. **Regression**: OpenAI/Anthropic/Qwen/etc. still work correctly

## Success Criteria

1. K2 multi-turn tool calling works without crash/loop
2. Model switching preserves context and works correctly
3. No changes to internal storage format (`hist_tool_xxx`)
4. Auto-detection works for K2 models
5. Manual override via `/toolformat kimi` works
6. All existing provider tests pass
