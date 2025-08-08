# Phase 18: End-to-End Verification

## Objective

Verify the complete todo continuation system works in real usage scenarios.

## Verification Task

```bash
Task(
  description="Verify e2e functionality",
  prompt="Create and run end-to-end verification tests for todo continuation.

File: integration-tests/todo-continuation.e2e.test.js

Create real e2e tests that:

1. Start actual CLI instance
2. Create active todos
3. Send messages that complete without tool calls
4. Verify continuation prompts appear
5. Test todo_pause tool usage
6. Verify setting changes work

Test scenarios:

1. Basic continuation flow:
   - Start CLI
   - Create todo: 'Implement auth system'
   - Send: 'I need to think about this'
   - Verify: Continuation prompt appears
   - Verify: Prompt mentions 'Implement auth system'

2. Tool call suppression:
   - Create todo
   - Send: 'Let me check the files' (triggers tool use)
   - Verify: NO continuation prompt

3. Todo pause usage:
   - Create todo
   - Trigger continuation
   - Use todo_pause('Need more context')
   - Verify: 'AI paused: Need more context' appears
   - Verify: Control returns to user

4. Setting toggle:
   - Run: /set todo-continuation false
   - Create todo
   - Complete without tools
   - Verify: NO continuation

5. YOLO mode check:
   - Enable YOLO mode
   - Create todo
   - Trigger continuation
   - Verify: Stronger prompt language

Include timing checks, output verification, and state validation.
Follow existing e2e test patterns in integration-tests/.",
  subagent_type="typescript-coder"
)
```

## Success Criteria

- All scenarios pass
- Real CLI behavior matches specification
- No race conditions or timing issues
- Clear user experience