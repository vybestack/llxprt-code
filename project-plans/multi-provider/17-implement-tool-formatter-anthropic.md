# Phase 17 – Implement ToolFormatter for Anthropic (multi-provider)

**STOP**
This worker must stop after completing the tasks in this phase.

## Goal

To implement the `toProviderFormat` and `fromProviderFormat` methods in `ToolFormatter` specifically for the `anthropic` tool format. This will enable the conversion of internal tool representations to Anthropic's format and vice-versa.

## Deliverables

- Modified `/Users/acoliver/projects/gemini-code/gemini-cli/packages/cli/src/tools/ToolFormatter.ts` with `anthropic` specific logic.
- Modified `/Users/acoliver/projects/gemini-code/gemini-cli/packages/cli/src/tools/ToolFormatter.test.ts` with tests for `anthropic` tool formatting.

## Checklist (implementer)

- [ ] Update `packages/cli/src/tools/ToolFormatter.ts`:
  - [ ] Implement `toProviderFormat(tools: ITool[], format: ToolFormat): any`:
    - [ ] If `format` is 'anthropic', convert the `ITool[]` array into the format expected by Anthropic's `tools` parameter (array of objects with `type: "tool"` and `input` property).
    - [ ] For other formats, continue to throw `NotYetImplemented`.
  - [ ] Implement `fromProviderFormat(rawToolCall: any, format: ToolFormat): IMessage['tool_calls']`:
    - [ ] If `format` is 'anthropic', parse the raw tool call object (from Anthropic's streaming delta or non-streaming response) into the `IMessage['tool_calls']` array format.
    - [ ] For other formats, continue to throw `NotYetImplemented`.
- [ ] Update `packages/cli/src/tools/ToolFormatter.test.ts`:
  - [ ] Add tests for `toProviderFormat` with `format: 'anthropic'`:
    - [ ] Provide sample `ITool[]` input.
    - [ ] Assert that the output matches Anthropic's expected tool format.
  - [ ] Add tests for `fromProviderFormat` with `format: 'anthropic'`:
    - [ ] Provide sample raw Anthropic tool call objects (e.g., from `delta.tool_use` or `message.content` with `type: 'tool_use'`).
    - [ ] Assert that the output matches the `IMessage['tool_calls']` internal format.
  - [ ] Ensure existing `NotYetImplemented` tests for other formats still pass.

## Self-verify

```bash
npm run typecheck
npm run lint
npm test packages/cli/src/tools/ToolFormatter.test.ts
```

**STOP. Wait for Phase 17a verification.**
