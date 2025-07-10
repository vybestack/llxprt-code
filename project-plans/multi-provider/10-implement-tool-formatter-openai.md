# Phase 10 – Implement ToolFormatter for OpenAI (multi-provider)

**STOP**
This worker must stop after completing the tasks in this phase.

## Goal

To implement the `toProviderFormat` and `fromProviderFormat` methods in `ToolFormatter` specifically for the `openai` tool format. This will enable the conversion of internal tool representations to OpenAI's format and vice-versa.

## Deliverables

- Modified `/Users/acoliver/projects/gemini-code/gemini-cli/packages/cli/src/tools/ToolFormatter.ts` with `openai` specific logic.
- Modified `/Users/acoliver/projects/gemini-code/gemini-cli/packages/cli/src/tools/ToolFormatter.test.ts` with tests for `openai` tool formatting.

## Checklist (implementer)

- [ ] Update `packages/cli/src/tools/ToolFormatter.ts`:
  - [ ] Implement `toProviderFormat(tools: ITool[], format: ToolFormat): any`:
    - [ ] If `format` is 'openai', convert the `ITool[]` array into the format expected by OpenAI's `tools` parameter (array of objects with `type: "function"` and `function` property).
    - [ ] For other formats, continue to throw `NotYetImplemented`.
  - [ ] Implement `fromProviderFormat(rawToolCall: any, format: ToolFormat): IMessage['tool_calls']`:
    - [ ] If `format` is 'openai', parse the raw tool call object (from OpenAI's streaming delta or non-streaming response) into the `IMessage['tool_calls']` array format.
    - [ ] For other formats, continue to throw `NotYetImplemented`.
- [ ] Update `packages/cli/src/tools/ToolFormatter.test.ts`:
  - [ ] Add tests for `toProviderFormat` with `format: 'openai'`:
    - [ ] Provide sample `ITool[]` input.
    - [ ] Assert that the output matches OpenAI's expected tool format.
  - [ ] Add tests for `fromProviderFormat` with `format: 'openai'`:
    - [ ] Provide sample raw OpenAI tool call objects (e.g., from `delta.tool_calls` or `message.tool_calls`).
    - [ ] Assert that the output matches the `IMessage['tool_calls']` internal format.
  - [ ] Ensure existing `NotYetImplemented` tests for other formats still pass.

## Self-verify

```bash
npm run typecheck
npm run lint
npm test packages/cli/src/tools/ToolFormatter.test.ts
```

**STOP. Wait for Phase 10a verification.**
