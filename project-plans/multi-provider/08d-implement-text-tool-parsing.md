# Phase 08d – Implement Text-Based Tool Call Parsing (multi-provider)

**STOP**
This worker must stop after completing the tasks in this phase.

## Goal

To add support for models that output tool calls as text (like gemma-3-12b) by implementing a parser in the OpenAI provider that detects and converts text-based tool call formats to the standard OpenAI format.

## Background

Some open-source models (like gemma-3-12b) don't support OpenAI's structured tool_calls format. Instead, they output tool calls as specially formatted text within the content. For example:

```
[TOOL_REQUEST]
tool_name {"param1":"value1"}
[TOOL_REQUEST_END]
```

## Deliverables

- Text-based tool call parser in OpenAIProvider
- Model detection for known text-based tool call formats
- Automatic conversion to standard tool call format

## Checklist (implementer)

### Part A: Create Tool Call Parser

- [ ] Create `packages/cli/src/providers/parsers/TextToolCallParser.ts`:

  ```typescript
  export interface TextToolCall {
    name: string;
    arguments: Record<string, unknown>;
  }

  export interface ITextToolCallParser {
    parse(content: string): {
      cleanedContent: string;
      toolCalls: TextToolCall[];
    };
  }

  export class GemmaToolCallParser implements ITextToolCallParser {
    private readonly pattern =
      /\[TOOL_REQUEST\]\s*(\w+)\s+({[^}]+})\s*\[TOOL_REQUEST_END\]/g;

    parse(content: string): {
      cleanedContent: string;
      toolCalls: TextToolCall[];
    } {
      // Implementation
    }
  }
  ```

### Part B: Add Model Detection

- [ ] Update `packages/cli/src/providers/openai/OpenAIProvider.ts`:
  - [ ] Add model detection logic:
    ```typescript
    private requiresTextToolCallParsing(): boolean {
      const textBasedModels = [
        'gemma-3-12b-it',
        'gemma-2-27b-it',
        // Add other known models
      ];
      return textBasedModels.includes(this.currentModel);
    }
    ```
  - [ ] Import the parser:
    ```typescript
    import { GemmaToolCallParser } from '../parsers/TextToolCallParser.js';
    ```

### Part C: Integrate Parser in Stream Processing

- [ ] Modify the `generateChatCompletion` method in OpenAIProvider:
  - [ ] Add parser instance:
    ```typescript
    const parser = this.requiresTextToolCallParsing()
      ? new GemmaToolCallParser()
      : null;
    ```
  - [ ] Update content accumulation to parse tool calls:

    ```typescript
    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta;

      if (delta?.content) {
        fullContent += delta.content;

        // For text-based models, don't yield content chunks yet
        if (!parser) {
          yield { role: ContentGeneratorRole.ASSISTANT, content: delta.content };
        }
      }

      // ... existing tool_calls handling ...
    }

    // After stream ends, parse text-based tool calls if needed
    if (parser && fullContent) {
      const { cleanedContent, toolCalls } = parser.parse(fullContent);

      if (toolCalls.length > 0) {
        // Convert to standard format
        const standardToolCalls = toolCalls.map((tc, index) => ({
          id: `call_${Date.now()}_${index}`,
          type: 'function' as const,
          function: {
            name: tc.name,
            arguments: JSON.stringify(tc.arguments),
          },
        }));

        yield {
          role: ContentGeneratorRole.ASSISTANT,
          content: cleanedContent,
          tool_calls: standardToolCalls,
          usage: usageData,
        };
      } else {
        // No tool calls found, yield cleaned content
        yield {
          role: ContentGeneratorRole.ASSISTANT,
          content: cleanedContent,
          usage: usageData,
        };
      }
    }
    ```

### Part D: Handle Edge Cases

- [ ] Add error handling for malformed JSON in tool arguments
- [ ] Support multiple tool calls in one response
- [ ] Handle partial tool call patterns (incomplete markers)
- [ ] Add logging for debugging:
  ```typescript
  console.log(
    '[OpenAIProvider] Text-based tool parsing enabled for model:',
    this.currentModel,
  );
  console.log('[OpenAIProvider] Parsed tool calls:', toolCalls);
  ```

### Part E: Add Configuration Option

- [ ] Add setting to enable/disable text tool parsing:
  - [ ] Update Settings interface:
    ```typescript
    enableTextToolCallParsing?: boolean;
    textToolCallModels?: string[];
    ```
  - [ ] Check setting in provider:

    ```typescript
    private requiresTextToolCallParsing(): boolean {
      if (this.settings?.enableTextToolCallParsing === false) {
        return false;
      }

      const defaultModels = ['gemma-3-12b-it', 'gemma-2-27b-it'];
      const configuredModels = this.settings?.textToolCallModels || [];
      const allModels = [...defaultModels, ...configuredModels];

      return allModels.includes(this.currentModel);
    }
    ```

## Testing

- [ ] Test with gemma-3-12b-it model
- [ ] Verify tool calls are properly parsed and executed
- [ ] Test with multiple tool calls in one response
- [ ] Test with malformed tool call syntax
- [ ] Test with models that use standard OpenAI format (should not affect them)
- [ ] Test disabling the feature via settings

## Self-verify

```bash
npm run typecheck
npm run lint

# Manual test
# 1. Set up OpenAI-compatible endpoint with gemma model
# 2. Run: /provider openai
# 3. Set model: /model gemma-3-12b-it
# 4. Test tool call: "List the files in the current directory"
# 5. Verify tool executes successfully
```

**STOP. Wait for Phase 08e verification.**
