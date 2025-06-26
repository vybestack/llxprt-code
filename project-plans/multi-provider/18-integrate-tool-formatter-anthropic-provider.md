# Phase 18 – Integrate ToolFormatter into AnthropicProvider (multi-provider)

**STOP**
This worker must stop after completing the tasks in this phase.

## Goal

To integrate the `ToolFormatter` into the `AnthropicProvider` so that it correctly formats outgoing tool definitions and parses incoming tool calls using the `anthropic` format.

## Deliverables

- Modified `/Users/acoliver/projects/gemini-code/gemini-cli/packages/cli/src/providers/anthropic/AnthropicProvider.ts` to use `ToolFormatter`.
- Modified `/Users/acoliver/projects/gemini-code/gemini-cli/packages/cli/src/providers/anthropic/AnthropicProvider.test.ts` to reflect the integration.

## Checklist (implementer)

- [ ] Update `packages/cli/src/providers/anthropic/AnthropicProvider.ts`:
  - [ ] Import `ToolFormatter` from `../../tools/ToolFormatter`.
  - [ ] Instantiate `ToolFormatter` in the constructor or as a static instance.
  - [ ] In `generateChatCompletion`:
    - [ ] Before sending `tools` to `this.anthropic.messages.create`, use `ToolFormatter.toProviderFormat(tools, 'anthropic')` to convert them to the Anthropic-specific format.
    - [ ] When processing incoming `tool_use` objects from Anthropic's streaming response, use `ToolFormatter.fromProviderFormat(rawToolCall, 'anthropic')` to convert them into the internal `IMessage['tool_calls']` format.
- [ ] Update `packages/cli/src/providers/anthropic/AnthropicProvider.test.ts`:
  - [ ] Ensure tests for `generateChatCompletion` now implicitly test the `ToolFormatter` integration by providing `ITool` objects and asserting that the mocked Anthropic API receives the correctly formatted tools, and that the parsed tool calls from the mocked Anthropic response are in the correct internal `IMessage` format.
  - [ ] You might need to mock `ToolFormatter` in these tests to isolate `AnthropicProvider`'s logic, or ensure `ToolFormatter`'s tests are robust enough that you can rely on its correct behavior here.

## Self-verify

```bash
npm run typecheck
npm run lint
npm test packages/cli/src/providers/anthropic/AnthropicProvider.test.ts
```

**STOP. Wait for Phase 18a verification.**
