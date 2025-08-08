# Phase 10: Integration & Configuration - TDD

## Objective

Write integration tests for todo continuation system.

## TDD Implementation Task

```bash
Task(
  description="Write integration tests",
  prompt="Write comprehensive integration tests for todo continuation.

File: packages/cli/src/integration-tests/todo-continuation.integration.test.ts

Test scenarios covering:

1. End-to-end continuation flow:
   - Model completes without tool call
   - Active todos present
   - Continuation prompt sent
   - Model continues with tool call

2. Configuration scenarios:
   - Setting todo-continuation to false disables feature
   - Setting persists for session
   - Default true behavior

3. Todo pause integration:
   - Model calls todo_pause during continuation
   - User sees pause reason
   - Control returns to user

4. YOLO mode variation:
   - Stronger prompt in YOLO mode
   - Same behavior otherwise

5. Edge cases:
   - Multiple todos active
   - Rapid completions
   - Setting changes mid-session

Write 12-15 integration tests that verify:
- Real component interaction
- No mocks for core functionality
- Actual user experience
- Setting persistence

Include @requirement tags for all tests.

Ensure tests cover ALL requirements:
- [REQ-001] Todo Continuation Detection  
- [REQ-002] Continuation Prompting
- [REQ-003] Todo Pause Tool
- [REQ-004] Configuration",
  subagent_type="typescript-coder"
)
```

## Integration Test Requirements

- Test real workflows
- Verify user experience
- No mock theater
- Clear scenarios