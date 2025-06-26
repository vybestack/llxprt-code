# Phase 23 – Implement ToolFormatter for Hermes (multi-provider)

**STOP**
This worker must stop after completing the tasks in this phase.

## Goal

To implement the `toProviderFormat` and `fromProviderFormat` methods in `ToolFormatter` specifically for the `hermes` tool format. This will enable the conversion of internal tool representations to Hermes's format and vice-versa.

## Deliverables

- Modified `/Users/acoliver/projects/gemini-code/gemini-cli/packages/cli/src/tools/ToolFormatter.ts` with `hermes` specific logic.
- Modified `/Users/acoliver/projects/gemini-code/gemini-cli/packages/cli/src/tools/ToolFormatter.test.ts` with tests for `hermes` tool formatting.

## Checklist (implementer)

- [ ] Update `packages/cli/src/tools/ToolFormatter.ts`:
  - [ ] Implement `toProviderFormat(tools: ITool[], format: ToolFormat): any`:
    - [ ] If `format` is 'hermes', convert the `ITool[]` array into the format expected by Hermes (e.g., a specific JSON structure or XML representation).
    - [ ] For other formats, continue to throw `NotYetImplemented`.
  - [ ] Implement `fromProviderFormat(rawToolCall: any, format: ToolFormat): IMessage['tool_calls']`:
    - [ ] If `format` is 'hermes', parse the raw tool call object (from a model's response) into the `IMessage['tool_calls']` internal format.
    - [ ] For other formats, continue to throw `NotYetImplemented`.
- [ ] Update `packages/cli/src/tools/ToolFormatter.test.ts`:
  - [ ] Add tests for `toProviderFormat` with `format: 'hermes'`:
    - [ ] Provide sample `ITool[]` input.
    - [ ] Assert that the output matches Hermes's expected tool format.
  - [ ] Add tests for `fromProviderFormat` with `format: 'hermes'`:
    - [ ] Provide sample raw Hermes tool call objects.
    - [ ] Assert that the output matches the `IMessage['tool_calls']` internal format.
  - [ ] Ensure existing `NotYetImplemented` tests for other formats still pass.

## Self-verify

```bash
npm run typecheck
npm run lint
npm test packages/cli/src/tools/ToolFormatter.test.ts
```

**STOP. Wait for Phase 23a verification.**
