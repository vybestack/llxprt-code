# Phase 08: Todo Pause Tool - Implementation

## Objective

Implement todo_pause tool to make all tests pass.

## Implementation Task

```bash
Task(
  description="Implement todo_pause tool",
  prompt="Implement the todo_pause tool to make ALL tests pass.

File: packages/core/src/tools/todo-pause.ts

Based on:
- Failing tests in todo-pause.spec.ts
- Pseudocode from analysis/pseudocode/todo-pause-tool.md
- Requirements [REQ-003]
- Tool system patterns

Requirements:
1. Do NOT modify any tests
2. Implement exactly what tests expect
3. Follow BaseTool patterns
4. Validate inputs properly
5. Format output correctly
6. Handle edge cases

The tool should:
- Validate reason string (required, max 500 chars)
- Return pause signal
- Format user message as 'AI paused: [reason]'
- NOT modify any todo states
- Integrate with continuation context

Ensure all tests pass.",
  subagent_type="typescript-coder"
)
```

## Implementation Checklist

- [ ] Input validation works
- [ ] Output formatting correct
- [ ] Integration clean
- [ ] All tests pass
- [ ] Follows tool patterns