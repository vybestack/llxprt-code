# Phase 04: Todo Continuation Hook - TDD Phase

## Objective

Write comprehensive behavioral tests for useTodoContinuation hook.

## TDD Implementation Task

```bash
Task(
  description="Write behavioral tests for useTodoContinuation",
  prompt="Write comprehensive BEHAVIORAL tests for the todo continuation hook.

File: packages/cli/src/ui/hooks/useTodoContinuation.spec.ts

Based on requirements:
[REQ-001.1] Detect stream completion without tool calls
[REQ-001.2] Check for active todos
[REQ-001.3] Only trigger when control returns to user
[REQ-001.4] Respect ephemeral setting

MANDATORY: Write 15-20 behavioral tests covering:

1. Stream completion detection scenarios:
   - Completion with tool calls (should NOT trigger)
   - Completion without tool calls (should trigger)
   - Multiple completions in sequence

2. Todo state scenarios:
   - Active todos (pending/in_progress) trigger continuation
   - No todos don't trigger
   - Completed todos don't trigger

3. Continuation prompt scenarios:
   - Standard mode prompt format
   - YOLO mode prompt format
   - Prompt includes task description

4. Configuration scenarios:
   - Respects todo-continuation setting (true/false)
   - Default behavior when setting not specified

5. Edge cases:
   - Empty todo descriptions
   - Rapid stream completions
   - Concurrent todo updates

Each test must:
- Transform INPUT → OUTPUT
- Have clear Given/When/Then structure
- Test actual behavior, not mocks
- Include @requirement tags

FORBIDDEN:
- Mock verification tests
- Structure-only tests
- Tests that pass with empty implementations",
  subagent_type="typescript-coder"
)
```

## Test Verification

Tests must demonstrate:
- Clear behavioral transformations
- Edge case coverage
- Integration with real components
- No mock theater