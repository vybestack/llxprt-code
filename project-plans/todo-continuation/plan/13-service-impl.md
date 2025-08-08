# Phase 13: Todo Continuation Service - Implementation

## Objective

Implement todoContinuationService to make all tests pass.

## Implementation Task

```bash
Task(
  description="Implement continuation service",
  prompt="Implement the todo continuation service to make ALL tests pass.

File: packages/cli/src/services/todo-continuation/todoContinuationService.ts

Based on:
- Failing tests in todoContinuationService.spec.ts
- Pseudocode from analysis/pseudocode/todo-continuation-service.md
- Requirements [REQ-002]

Requirements:
1. Do NOT modify any tests
2. Implement exactly what tests expect
3. Handle all edge cases from tests
4. No console.log or debug code
5. Clean, readable implementation

The service should:
- Generate appropriate continuation prompts
- Determine when continuation should occur
- Format prompts differently for YOLO mode
- Extract task descriptions from todos
- Handle edge cases gracefully

Ensure all tests pass before completion.",
  subagent_type="typescript-coder"
)
```

## Implementation Checklist

- [ ] All tests pass
- [ ] Prompt generation correct
- [ ] Decision logic sound
- [ ] Edge cases handled
- [ ] No debug artifacts