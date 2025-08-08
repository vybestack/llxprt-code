# Phase 14: Integration Activation - TDD

## Objective

Write behavioral tests that verify the complete todo continuation system works end-to-end.

## TDD Implementation Task

```bash
Task(
  description="Write integration activation tests",
  prompt="Write comprehensive BEHAVIORAL tests for the todo continuation integration.

File: packages/cli/src/ui/hooks/useGeminiStream.integration.test.tsx

Based on requirements:
[REQ-001] Todo Continuation Detection
[REQ-002] Continuation Prompting  
[REQ-003] Todo Pause Tool
[REQ-004] Configuration

Write 8-10 behavioral tests covering:

1. Complete continuation flow:
   /**
    * @requirement REQ-001.1, REQ-001.2, REQ-002.1
    * @scenario Model completes with active todo and no tool calls
    * @given Active todo 'Implement user auth', model completes streaming
    * @when Stream completes without tool calls
    * @then Continuation prompt sent with task description
    * @and Prompt marked as ephemeral (not in history)
    */

2. Tool call suppression:
   /**
    * @requirement REQ-001.1
    * @scenario Model completes with tool calls pending
    * @given Active todo exists, model makes tool calls
    * @when Stream completes with tool calls
    * @then NO continuation prompt sent
    */

3. Configuration respect:
   /**
    * @requirement REQ-001.4, REQ-004.1
    * @scenario Continuation disabled via setting
    * @given todo-continuation = false, active todo exists
    * @when Stream completes without tool calls
    * @then NO continuation prompt sent
    */

4. YOLO mode variation:
   /**
    * @requirement REQ-002.3
    * @scenario YOLO mode uses stronger prompt
    * @given YOLO mode active, todo exists
    * @when Stream completes
    * @then Prompt contains 'without waiting for confirmation'
    */

5. Todo pause tool availability:
   /**
    * @requirement REQ-003.4
    * @scenario todo_pause available to model
    * @given Active continuation scenario
    * @when Model lists available tools
    * @then todo_pause tool is accessible
    */

Each test must:
- Test ACTUAL stream → prompt behavior
- Use real useGeminiStream hook
- Verify actual GeminiClient.sendMessage calls
- Check ephemeral flag on prompts
- NO mocking of core behavior

FORBIDDEN:
- Mock verification (toHaveBeenCalled)
- Structure-only tests
- Tests that pass with stubs",
  subagent_type="typescript-coder"
)
```

## Expected Test Behaviors

Tests should verify:
- Real stream completion triggers continuation
- Actual prompt content matches requirements
- Settings are respected in real scenarios
- Tool registration works correctly