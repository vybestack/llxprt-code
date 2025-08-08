# Phase 16: Default Setting Configuration - TDD

## Objective

Write tests to verify the todo-continuation setting defaults to true.

## TDD Implementation Task

```bash
Task(
  description="Write default setting tests",
  prompt="Write behavioral tests for todo-continuation default setting.

File: packages/core/src/config/config.ephemeral.test.ts

Based on requirement:
[REQ-004.2] Default value: true

Write 3-4 behavioral tests:

1. Default behavior:
   /**
    * @requirement REQ-004.2
    * @scenario Setting defaults to true when unset
    * @given No todo-continuation setting configured
    * @when getEphemeralSetting('todo-continuation') called
    * @then Returns true (not undefined)
    */

2. Explicit true:
   /**
    * @requirement REQ-004.1
    * @scenario Explicit true value preserved
    * @given todo-continuation set to true
    * @when getEphemeralSetting('todo-continuation') called
    * @then Returns true
    */

3. Explicit false:
   /**
    * @requirement REQ-004.1
    * @scenario Explicit false value preserved
    * @given todo-continuation set to false
    * @when getEphemeralSetting('todo-continuation') called
    * @then Returns false
    */

4. Service integration:
   /**
    * @requirement REQ-004.2
    * @scenario Service treats undefined as true
    * @given No setting configured
    * @when todoContinuationService checks setting
    * @then Continuation is enabled
    */

Tests must verify actual behavior, not mocks.",
  subagent_type="typescript-coder"
)
```

## Expected Behaviors

- Unset setting returns true (not undefined)
- Explicit values are preserved
- Service correctly interprets default