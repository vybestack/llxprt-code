# Analysis Phase: Todo Continuation System

## Objective

Analyze the existing codebase to understand integration points for the todo continuation feature.

## Tasks for Analysis Worker

```bash
Task(
  description="Analyze todo continuation integration",
  prompt="Analyze the llxprt-code codebase to understand how to implement todo continuation. Focus on:

1. How useGeminiStream detects stream completion
2. Where todos are tracked (TodoContext)
3. How tool calls are detected during streaming
4. Where control returns to user after streaming
5. How ephemeral settings are accessed
6. Integration points for new hooks

Look specifically at:
- packages/cli/src/ui/hooks/useGeminiStream.ts
- packages/cli/src/ui/contexts/TodoContext.tsx
- packages/cli/src/ui/contexts/TodoProvider.tsx
- packages/core/src/tools/base-tool.ts
- How YOLO mode is detected

Create analysis output documenting:
- Stream completion detection mechanism
- Todo state access patterns
- Tool call detection during streaming
- Best integration points for continuation logic
- How to send prompts without storing in context",
  subagent_type="general-purpose"
)
```

## Expected Analysis Output

The worker should produce:
1. Detailed flow diagram of stream completion
2. Integration points for continuation detection
3. Method to send out-of-band prompts
4. Todo state access patterns
5. Tool registration requirements