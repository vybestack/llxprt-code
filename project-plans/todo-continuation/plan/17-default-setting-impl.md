# Phase 17: Default Setting Configuration - Implementation

## Objective

Implement default value handling for todo-continuation setting.

## Implementation Task

```bash
Task(
  description="Implement default setting",
  prompt="Implement default value for todo-continuation setting to make tests pass.

File to modify:
packages/core/src/config/config.ts

Based on:
- Failing tests in config.ephemeral.test.ts
- Requirement [REQ-004.2] Default value: true

Requirements:
1. Do NOT modify any tests
2. Make getEphemeralSetting return true for todo-continuation when unset
3. Preserve explicit true/false values
4. Minimal code change

Implementation approach:
In getEphemeralSetting method (around line 790):
- Check if key is 'todo-continuation' and value is undefined
- Return true for this specific case
- Otherwise return normal value

Example pattern:
```typescript
getEphemeralSetting(key: string): unknown {
  const value = this.ephemeralSettings.get(key);
  
  // Default for todo-continuation
  if (key === 'todo-continuation' && value === undefined) {
    return true;
  }
  
  return value;
}
```

Verify all tests pass.",
  subagent_type="typescript-coder"
)
```

## Implementation Notes

- Single point of default handling
- Preserves all other behavior
- Clear and maintainable