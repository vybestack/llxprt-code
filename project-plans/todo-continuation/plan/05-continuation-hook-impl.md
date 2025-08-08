# Phase 05: Todo Continuation Hook - Implementation

## Objective

Implement useTodoContinuation to make all tests pass.

## Implementation Task

```bash
Task(
  description="Implement useTodoContinuation hook",
  prompt="Implement the todo continuation hook to make ALL tests pass.

File: packages/cli/src/ui/hooks/useTodoContinuation.ts

Based on:
- Failing tests in useTodoContinuation.spec.ts
- Pseudocode from analysis/pseudocode/use-todo-continuation.md
- Requirements [REQ-001] and [REQ-002]
- Integration with existing systems

Requirements:
1. Do NOT modify any tests
2. Implement exactly what tests expect
3. Integrate with:
   - TodoContext for active todo detection
   - Stream completion events
   - Ephemeral settings
   - Prompt generation
4. Handle all edge cases from tests
5. No console.log or debug code
6. Clean, readable implementation

The hook should:
- Monitor stream completion events
- Check for active todos when no tool calls made
- Generate appropriate continuation prompts
- Respect configuration settings
- Handle YOLO mode variations

Ensure all tests pass before completion.",
  subagent_type="typescript-coder"
)
```

## Implementation Checklist

- [ ] All tests pass
- [ ] Proper integration with TodoContext
- [ ] Clean prompt generation
- [ ] Configuration respected
- [ ] No debug artifacts