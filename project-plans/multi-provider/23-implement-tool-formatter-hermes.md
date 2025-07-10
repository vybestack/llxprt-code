# Phase 23 – Implement Text Parser for Hermes Tool Format (multi-provider)

**STOP**
This worker must stop after completing the tasks in this phase.

## Goal

To add support for Hermes tool call format to the TextToolCallParser. Hermes models output tool calls as text with `<tool_call>` XML-like tags containing JSON.

## Background

Hermes format example:

```
<|im_start|>assistant
<tool_call>
{"arguments": {"symbol": "TSLA"}, "name": "get_stock_fundamentals"}
</tool_call>
<|im_end|>
```

## Deliverables

- Updated `TextToolCallParser` with Hermes pattern
- Tests for Hermes format parsing
- Updated format detection logic

## Checklist (implementer)

- [ ] Update `packages/cli/src/providers/parsers/TextToolCallParser.ts`:
  - [ ] Add Hermes pattern to patterns array:
    ```typescript
    // Format 5: Hermes format with <tool_call> tags
    /<tool_call>\s*({.*?"name":\s*"(\w+)".*?})\s*<\/tool_call>/gs,
    ```
  - [ ] Update parsing logic to handle this pattern
  - [ ] Ensure special tokens like `<|im_start|>` are cleaned up

- [ ] Create `HermesToolCallParser` class (optional):
  - [ ] If Hermes needs special handling, create dedicated parser
  - [ ] Otherwise, use updated GemmaToolCallParser

- [ ] Update format detection:
  - [ ] Add 'hermes' to text-based formats list
  - [ ] Update `requiresTextToolCallParsing()` to include Hermes models

- [ ] Add tests to `TextToolCallParser.test.ts`:
  - [ ] Test single Hermes tool call
  - [ ] Test multiple tool calls
  - [ ] Test with special tokens
  - [ ] Test malformed Hermes format

## Self-verify

```bash
npm run typecheck
npm run lint
npm test packages/cli/src/tools/ToolFormatter.test.ts
```

**STOP. Wait for Phase 23a verification.**
