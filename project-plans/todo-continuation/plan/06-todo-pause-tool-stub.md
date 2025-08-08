# Phase 06: Todo Pause Tool - Stub Implementation

## Objective

Create minimal skeleton for todo_pause tool.

## Implementation Task

```bash
Task(
  description="Implement todo_pause tool stub",
  prompt="Create a stub implementation for the todo_pause tool.

File: packages/core/src/tools/todo-pause.ts

Based on:
- Pseudocode from analysis/pseudocode/todo-pause-tool.md
- Requirements [REQ-003]

Requirements:
1. Extend BaseTool class
2. All methods throw new Error('NotYetImplemented')
3. Include:
   - Tool name: 'todo_pause'
   - Description for AI
   - Input schema (reason: string)
   - execute method stub
4. Must compile with strict TypeScript
5. Follow existing tool patterns

The tool should:
- Accept a reason string parameter
- Break continuation loop
- Return control to user with reason

Create minimal structure without implementation.",
  subagent_type="typescript-coder"
)
```

## Verification Checklist

- [ ] Extends BaseTool properly
- [ ] Schema defined correctly
- [ ] Tool metadata complete
- [ ] Throws NotYetImplemented
- [ ] Follows tool conventions