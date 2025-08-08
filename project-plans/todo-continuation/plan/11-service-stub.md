# Phase 11: Todo Continuation Service - Stub

## Objective

Create minimal skeleton for todoContinuationService that supports the hook.

## Implementation Task

```bash
Task(
  description="Implement continuation service stub",
  prompt="Create a stub implementation for the todo continuation service.

File: packages/cli/src/services/todo-continuation/todoContinuationService.ts

Based on:
- Pseudocode from analysis/pseudocode/todo-continuation-service.md
- Requirements [REQ-002]

Requirements:
1. Create service with proper TypeScript types
2. All methods throw new Error('NotYetImplemented')
3. Include methods for:
   - generateContinuationPrompt(activeTodos, isYoloMode)
   - shouldContinue(settings, hasActiveTodos, hasToolCalls)
   - formatPrompt(taskDescription, isYoloMode)
4. Export the service
5. Must compile with strict TypeScript

The service handles:
- Prompt generation logic
- Continuation decision logic
- YOLO mode variations

Create stub that defines the structure without implementation.",
  subagent_type="typescript-coder"
)
```

## Verification Checklist

- [ ] File compiles with no TypeScript errors
- [ ] All functions throw NotYetImplemented
- [ ] Proper types defined
- [ ] No actual logic implemented
- [ ] Exports are correct