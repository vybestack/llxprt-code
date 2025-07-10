# Phase 18 – Integrate ToolFormatter into AnthropicProvider (multi-provider)

**STOP**
This worker must stop after completing the tasks in this phase.

## Goal

To integrate the `ToolFormatter` into the `AnthropicProvider` so that it correctly formats outgoing tool definitions and handles incoming tool calls using the `anthropic` format. Note that Anthropic uses the structured path (not text-based).

## Background

Anthropic is a structured format provider like OpenAI. It returns tool calls as JSON objects in the response, not as text. The ToolFormatter handles conversion between internal format and Anthropic's specific format.

## Deliverables

- Modified `/Users/acoliver/projects/gemini-code/gemini-cli/packages/cli/src/providers/anthropic/AnthropicProvider.ts` to use `ToolFormatter`.
- Modified `/Users/acoliver/projects/gemini-code/gemini-cli/packages/cli/src/providers/anthropic/AnthropicProvider.test.ts` to reflect the integration.

## Checklist (implementer)

- [ ] Update `packages/cli/src/providers/anthropic/AnthropicProvider.ts`:
  - [ ] Import `ToolFormatter` from `../../tools/ToolFormatter.js`.
  - [ ] Import `ToolFormat` from `../../tools/IToolFormatter.js`.
  - [ ] Add `toolFormatter: ToolFormatter` property and instantiate in constructor.
  - [ ] Set `toolFormat: ToolFormat = 'anthropic'` (Anthropic doesn't need dynamic detection).
  - [ ] In `generateChatCompletion`:
    - [ ] Before sending `tools` to `this.anthropic.messages.create`, use `this.toolFormatter.toProviderFormat(tools, 'anthropic')` to convert them to the Anthropic-specific format.
    - [ ] For streaming tool calls, use `this.toolFormatter.accumulateStreamingToolCall()` similar to OpenAI (if Anthropic supports streaming tool calls).
    - [ ] If Anthropic doesn't stream tool calls, convert the complete tool call objects using appropriate ToolFormatter methods.
  - [ ] Note: Anthropic does NOT use TextToolCallParser - it's a structured format only.
- [ ] Update `packages/cli/src/providers/anthropic/AnthropicProvider.test.ts`:
  - [ ] Ensure tests verify ToolFormatter integration.
  - [ ] Test that tools are correctly formatted for Anthropic's API.
  - [ ] Verify tool calls are properly converted to internal format.

## Self-verify

```bash
npm run typecheck
npm run lint
npm test packages/cli/src/providers/anthropic/AnthropicProvider.test.ts
```

**STOP. Wait for Phase 18a verification.**
