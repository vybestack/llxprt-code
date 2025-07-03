# Phase 25 – Integrate ToolFormatter into CLI Tool Execution (multi-provider)

**STOP**
This worker must stop after completing the tasks in this phase.

## Goal

To ensure the CLI's tool execution logic correctly handles tool calls from both structured (ToolFormatter) and text-based (TextToolCallParser) paths. Since we now have two parallel systems for extracting tool calls, the execution layer must handle both seamlessly.

## Background

Current architecture:

1. **Structured path**: Provider → ToolFormatter → Standard format → Execution
2. **Text-based path**: Provider → TextToolCallParser → Standard format → Execution

Both paths output the same `IMessage['tool_calls']` format, but they arrive there differently.

## Deliverables

- Verified tool execution works for both paths
- Updated execution logic if needed to handle edge cases
- Tests covering both structured and text-based tool calls

## Checklist (implementer)

- [ ] Verify current tool execution logic location:
  - [ ] Check where tool calls from `generateChatCompletion` are executed
  - [ ] Confirm it operates on `IMessage['tool_calls']` format
  - [ ] Ensure it doesn't assume a specific source (structured vs text)

- [ ] Test both paths end-to-end:
  - [ ] Structured: OpenAI/Anthropic → ToolFormatter → Execution
  - [ ] Text-based: Gemma/Hermes → TextToolCallParser → Execution
  - [ ] Mixed: Multiple tool calls from different sources

- [ ] Handle edge cases:
  - [ ] Tool calls with missing IDs (text-parsed often generate IDs)
  - [ ] Malformed arguments that passed parsing but fail execution
  - [ ] Multiple sequential tool calls
  - [ ] Tool calls mixed with regular content

- [ ] Update logging/debugging:
  - [ ] Log which path (structured/text) tool calls came from
  - [ ] Include format information in debug output
  - [ ] Make troubleshooting easier for users

## Self-verify

```bash
npm run typecheck
npm run lint
# Manual test: Run the CLI, set different providers and tool formats (e.g., /provider openai /toolformat openai, then /provider anthropic /toolformat anthropic).
# Send messages that trigger tool calls for each configuration.
# Verify that tools are correctly identified and executed, and their results are processed.
```

**STOP. Wait for Phase 25a verification.**
