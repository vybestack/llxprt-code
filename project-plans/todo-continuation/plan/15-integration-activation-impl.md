# Phase 15: Integration Activation - Implementation

## Objective

Implement the integration to make all behavioral tests pass.

## Implementation Task

```bash
Task(
  description="Implement integration activation",
  prompt="Implement the todo continuation integration to make ALL tests pass.

Files to modify:
1. packages/cli/src/ui/hooks/useGeminiStream.ts - Remove NotYetImplemented stub
2. packages/core/src/config/config.ts - Register TodoPause tool

Based on:
- Failing tests in useGeminiStream.integration.test.tsx
- Analysis showing integration points

Requirements:
1. Do NOT modify any tests
2. Remove the NotYetImplemented stub completely
3. Call _handleStreamCompleted(processingResult.hadToolCalls)
4. Register TodoPause tool in config.ts after TodoRead
5. Ensure all behavioral tests pass

Implementation steps:

In useGeminiStream.ts (around line 795):
- Remove entire try-catch block with NotYetImplemented
- Replace with: _handleStreamCompleted(processingResult.hadToolCalls);

In config.ts (around line 898):
- Add: registerCoreTool(TodoPause);
- Import TodoPause at top of file

Verify:
- npm test useGeminiStream.integration.test.tsx
- All tests should pass
- Todo continuation activates on stream completion
- todo_pause tool is available to models",
  subagent_type="typescript-coder"
)
```

## Implementation Checklist

- [ ] NotYetImplemented stub removed
- [ ] _handleStreamCompleted called with correct parameter
- [ ] TodoPause tool registered
- [ ] All integration tests pass
- [ ] No debug code or TODOs