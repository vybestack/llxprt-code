# Phase 07: Todo Pause Tool - TDD Phase

## Objective

Write comprehensive behavioral tests for todo_pause tool.

## TDD Implementation Task

```bash
Task(
  description="Write behavioral tests for todo_pause tool",
  prompt="Write comprehensive BEHAVIORAL tests for the todo_pause tool.

File: packages/core/src/tools/todo-pause.spec.ts

Based on requirements:
[REQ-003.1] Accept reason string parameter
[REQ-003.2] Break continuation without changing task status
[REQ-003.3] Display reason to user
[REQ-003.4] Only available during continuation

Write 10-12 behavioral tests covering:

1. Input validation:
   - Valid reason strings
   - Empty reason rejection
   - Long reason truncation (500 char limit)

2. Execution behavior:
   - Returns pause signal with reason
   - Does NOT modify todo statuses
   - Formats user-friendly message

3. Integration scenarios:
   - Works during continuation context
   - Proper error in non-continuation context

4. Output formatting:
   - User sees 'AI paused: [reason]'
   - Special characters handled
   - Multi-line reasons formatted

Each test must:
- Test actual behavior
- Show input → output transformation
- Include @requirement tags

FORBIDDEN:
- Mock verification
- Implementation detail tests",
  subagent_type="typescript-coder"
)
```

## Test Requirements

Tests must verify:
- Tool behavior matches specification
- User feedback is clear
- Integration points work correctly