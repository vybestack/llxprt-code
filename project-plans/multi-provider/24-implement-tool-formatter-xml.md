# Phase 24 – Implement ToolFormatter for XML (multi-provider)

**STOP**
This worker must stop after completing the tasks in this phase.

## Goal

To implement the `toProviderFormat` and `fromProviderFormat` methods in `ToolFormatter` specifically for the `xml` tool format. This will enable the conversion of internal tool representations to XML's format and vice-versa.

## Deliverables

- Modified `/Users/acoliver/projects/gemini-code/gemini-cli/packages/cli/src/tools/ToolFormatter.ts` with `xml` specific logic.
- Modified `/Users/acoliver/projects/gemini-code/gemini-cli/packages/cli/src/tools/ToolFormatter.test.ts` with tests for `xml` tool formatting.

## Checklist (implementer)

- [ ] Update `packages/cli/src/tools/ToolFormatter.ts`:
  - [ ] Implement `toProviderFormat(tools: ITool[], format: ToolFormat): any`:
    - [ ] If `format` is 'xml', convert the `ITool[]` array into an XML string representation suitable for tool definitions.
    - [ ] For other formats, continue to throw `NotYetImplemented`.
  - [ ] Implement `fromProviderFormat(rawToolCall: any, format: ToolFormat): IMessage['tool_calls']`:
    - [ ] If `format` is 'xml', parse the raw XML tool call string (from a model's response) into the `IMessage['tool_calls']` internal format.
    - [ ] For other formats, continue to throw `NotYetImplemented`.
- [ ] Update `packages/cli/src/tools/ToolFormatter.test.ts`:
  - [ ] Add tests for `toProviderFormat` with `format: 'xml'`:
    - [ ] Provide sample `ITool[]` input.
    - [ ] Assert that the output matches the expected XML tool definition format.
  - [ ] Add tests for `fromProviderFormat` with `format: 'xml'`:
    - [ ] Provide sample raw XML tool call strings.
    - [ ] Assert that the output matches the `IMessage['tool_calls']` internal format.
  - [ ] Ensure existing `NotYetImplemented` tests for other formats still pass.

## Self-verify

```bash
npm run typecheck
npm run lint
npm test packages/cli/src/tools/ToolFormatter.test.ts
```

**STOP. Wait for Phase 24a verification.**
