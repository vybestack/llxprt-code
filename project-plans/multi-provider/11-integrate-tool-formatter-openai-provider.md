# Phase 11 – Integrate ToolFormatter into OpenAIProvider (multi-provider)

**STOP**
This worker must stop after completing the tasks in this phase.

## Goal

To integrate the `ToolFormatter` into the `OpenAIProvider` so that it correctly formats outgoing tool definitions and parses incoming tool calls using the `openai` format.

## Deliverables

- Modified `/Users/acoliver/projects/gemini-code/gemini-cli/packages/cli/src/providers/openai/OpenAIProvider.ts` to use `ToolFormatter`.
- Modified `/Users/acoliver/projects/gemini-code/gemini-cli/packages/cli/src/providers/openai/OpenAIProvider.test.ts` to reflect the integration.

## Checklist (implementer)

- [ ] Update `packages/cli/src/providers/openai/OpenAIProvider.ts`:
  - [ ] Import `ToolFormatter` from `../../tools/ToolFormatter`.
  - [ ] Instantiate `ToolFormatter` in the constructor or as a static instance.
  - [ ] In `generateChatCompletion`:
    - [ ] Before sending `tools` to `openai.chat.completions.create`, use `ToolFormatter.toProviderFormat(tools, 'openai')` to convert them to the OpenAI-specific format.
    - [ ] When processing incoming `delta.tool_calls` or `message.tool_calls` from OpenAI, use `ToolFormatter.fromProviderFormat(rawToolCall, 'openai')` to convert them into the internal `IMessage['tool_calls']` format.
- [ ] Update `packages/cli/src/providers/openai/OpenAIProvider.test.ts`:
  - [ ] Ensure tests for `generateChatCompletion` now implicitly test the `ToolFormatter` integration by providing `ITool` objects and asserting that the mocked OpenAI API receives the correctly formatted tools, and that the parsed tool calls from the mocked OpenAI response are in the correct internal `IMessage` format.
  - [ ] You might need to mock `ToolFormatter` in these tests to isolate `OpenAIProvider`'s logic, or ensure `ToolFormatter`'s tests are robust enough that you can rely on its correct behavior here.

## Self-verify

```bash
npm run typecheck
npm run lint
npm test packages/cli/src/providers/openai/OpenAIProvider.test.ts
```

**STOP. Wait for Phase 11a verification.**
