# Phase 25 – Integrate ToolFormatter into CLI Tool Execution (multi-provider)

**STOP**
This worker must stop after completing the tasks in this phase.

## Goal

To integrate the `ToolFormatter` into the main CLI's tool execution logic. This ensures that tool calls received from any provider, regardless of their native format, are correctly parsed into the internal `IMessage['tool_calls']` format before execution.

## Deliverables

- Modified CLI tool execution logic (e.g., in `packages/cli/src/index.ts` or a dedicated tool execution module) to use `ToolFormatter.fromProviderFormat`.

## Checklist (implementer)

- [ ] Identify the part of the CLI code that receives tool calls from the `generateChatCompletion` stream (or non-streaming response) and prepares them for execution.
- [ ] In this section, ensure that `ToolFormatter.fromProviderFormat(rawToolCall, currentToolFormat)` is used to convert the raw tool call object (as received from the provider) into the standardized `IMessage['tool_calls']` format.
- [ ] The `currentToolFormat` should be the one determined by the active provider and potentially overridden by the `/toolformat` command.
- [ ] Ensure that the tool execution logic (which calls the actual tool functions) operates on this standardized `IMessage['tool_calls']` format.

## Self-verify

```bash
npm run typecheck
npm run lint
# Manual test: Run the CLI, set different providers and tool formats (e.g., /provider openai /toolformat openai, then /provider anthropic /toolformat anthropic).
# Send messages that trigger tool calls for each configuration.
# Verify that tools are correctly identified and executed, and their results are processed.
```

**STOP. Wait for Phase 25a verification.**
