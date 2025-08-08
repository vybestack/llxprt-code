# Phase 12: Todo Continuation Service - TDD

## Objective

Write comprehensive tests for todo continuation service.

## TDD Implementation Task

```bash
Task(
  description="Write service behavioral tests",
  prompt="Write comprehensive behavioral tests for the todo continuation service.

File: packages/cli/src/services/todo-continuation/todoContinuationService.spec.ts

Based on requirements:
[REQ-002.1] Send out-of-band prompt to model
[REQ-002.2] Include specific task description
[REQ-002.3] Different prompt for YOLO mode
[REQ-002.4] Do not add prompt to history

Write 10-12 behavioral tests covering:

1. Prompt generation:
   - Standard mode prompt format
   - YOLO mode stronger wording
   - Multiple active todos handling
   - Empty todo list handling

2. Continuation logic:
   - Should continue when todos active & no tool calls
   - Should not continue when setting disabled
   - Should not continue with tool calls made
   - Should not continue with no active todos

3. Task description extraction:
   - Extract from in_progress todos first
   - Fall back to pending todos
   - Handle malformed todo content

4. Edge cases:
   - Null/undefined inputs
   - Empty strings
   - Very long task descriptions

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
- Service behavior matches specification
- Prompts formatted correctly
- Decision logic is sound