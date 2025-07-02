# Phase 11 – Integrate ToolFormatter into OpenAIProvider (multi-provider)

**STOP**
This worker must stop after completing the tasks in this phase.

## Goal

To integrate the `ToolFormatter` into the `OpenAIProvider` so that it correctly formats outgoing tool definitions and handles incoming tool calls using dynamic format detection to support multiple OpenAI-compatible providers.

## Background

The OpenAIProvider now supports two paths:

1. **Structured Path**: For providers that return tool calls as JSON (OpenAI, DeepSeek, Qwen) → Uses ToolFormatter
2. **Text-Based Path**: For models that output tool calls as text (Gemma, Hermes, XML, Llama) → Uses TextToolCallParser

## Deliverables

- Modified `/Users/acoliver/projects/gemini-code/gemini-cli/packages/cli/src/providers/openai/OpenAIProvider.ts` to use `ToolFormatter` with dynamic format detection.
- Modified `/Users/acoliver/projects/gemini-code/gemini-cli/packages/cli/src/providers/openai/OpenAIProvider.test.ts` to reflect the integration.

## Checklist (implementer)

- [ ] Update `packages/cli/src/providers/openai/OpenAIProvider.ts`:
  - [ ] Import `ToolFormatter` from `../../tools/ToolFormatter.js`.
  - [ ] Import `ToolFormat` from `../../tools/IToolFormatter.js`.
  - [ ] Add `toolFormatter: ToolFormatter` property and instantiate in constructor.
  - [ ] Add `toolFormat: ToolFormat` property to track current format.
  - [ ] Implement `getToolFormat()` method for dynamic format detection:
    ```typescript
    private getToolFormat(): ToolFormat {
      if (this.currentModel.includes('deepseek') || this.baseURL?.includes('deepseek')) {
        return 'deepseek';
      }
      if (this.currentModel.includes('qwen') || this.baseURL?.includes('qwen')) {
        return 'qwen';
      }
      return 'openai'; // default
    }
    ```
  - [ ] In `generateChatCompletion`:
    - [ ] Set `this.toolFormat = this.getToolFormat()` before formatting tools.
    - [ ] Use `this.toolFormatter.toProviderFormat(tools, this.toolFormat)` to convert tools.
    - [ ] For streaming tool calls, use `this.toolFormatter.accumulateStreamingToolCall(toolCall, accumulatedToolCalls, this.toolFormat)`.
    - [ ] Keep existing TextToolCallParser integration for text-based models.
- [ ] Update `packages/cli/src/providers/openai/OpenAIProvider.test.ts`:
  - [ ] Ensure tests verify dynamic format detection.
  - [ ] Test that different models/baseURLs result in correct format selection.
  - [ ] Verify both structured and text-based paths work correctly.

## Self-verify

```bash
npm run typecheck
npm run lint
npm test packages/cli/src/providers/openai/OpenAIProvider.test.ts
```

**STOP. Wait for Phase 11a verification.**
