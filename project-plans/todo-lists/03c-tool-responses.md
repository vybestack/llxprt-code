# Phase 3c - Tool Response Formatting (todo-lists)

## Goal

Implement proper tool response formatting to match Claude's behavior and enable UI integration.

## Deliverables

- [ ] Update TodoRead response format
- [ ] Update TodoWrite response format with diff tracking
- [ ] Add tool result mapping for LLM responses
- [ ] Integration with existing tool response system

## Implementation Details

### TodoRead Response Format

```typescript
// Tool execution response
{
  todos: Todo[] // Sorted array of todos
}

// LLM message format
{
  tool_use_id: string,
  type: 'tool_result',
  content: JSON.stringify(todos) // Array only, not wrapped object
}
```

### TodoWrite Response Format

```typescript
// Tool execution response
{
  oldTodos: Todo[], // Previous state
  newTodos: Todo[]  // New state after update
}

// LLM message format
{
  tool_use_id: string,
  type: 'tool_result',
  content: 'Todos have been modified successfully. Ensure that you continue to use the todo list to track your progress. Please proceed with the current tasks if applicable'
}
```

### Tool Response Methods

Each tool needs to implement:

- `renderToolUseMessage()` - Initial confirmation
- `renderToolResultMessage()` - Display results in UI
- `mapToolResultToToolResultBlockParam()` - Format for LLM

## Checklist (implementer)

- [ ] TodoRead returns raw array in LLM response
- [ ] TodoWrite returns confirmation message to LLM
- [ ] TodoWrite includes old/new todos in execution result
- [ ] Response formatting matches Claude's exact messages
- [ ] Integration with tool response rendering system
- [ ] Type safety maintained throughout

## Self-verify

```bash
npm run test -- todo-read.test.ts
npm run test -- todo-write.test.ts
npm run typecheck
# Test actual tool responses
npm run test -- --grep "tool.*response"
```
