# Phase 3 - Core Implementation (todo-lists)

## Goal

Implement the core logic for TodoRead, TodoWrite tools and TodoStore to make all Phase 2 tests pass.

## Deliverables

- [ ] Fully functional TodoRead tool implementation
- [ ] Fully functional TodoWrite tool implementation
- [ ] Working TodoStore with file-based persistence
- [ ] Todo sorting implementation
- [ ] All Phase 2 tests passing

## Implementation Requirements

### TodoRead Tool

- Returns empty array when no todos exist
- Returns todos sorted by status (in_progress → pending → completed) then priority (high → medium → low)
- Tool schema accepts empty object (no required parameters)
- Loads todos from file via TodoStore

### TodoWrite Tool

- Accepts array of todo items with Zod validation
- Each todo must have: id, content, status, priority
- Completely replaces the todo list (not incremental updates)
- Returns both oldTodos and newTodos for diff tracking
- Saves todos to file via TodoStore

### TodoStore

- File-based storage in `~/.gemini/todos/` directory
- Agent-specific files: `{sessionId}-agent-{agentId}.json`
- Creates directory if not exists
- Thread-safe file operations
- Methods:
  - `loadTodos(agentId: string): Promise<Todo[]>`
  - `saveTodos(todos: Todo[], agentId: string): Promise<void>`
  - `getTodoFilePath(agentId: string): string`

### Sorting Implementation

```typescript
const statusOrder = { in_progress: 0, pending: 1, completed: 2 };
const priorityOrder = { high: 0, medium: 1, low: 2 };

function sortTodos(a: Todo, b: Todo): number {
  const statusDiff = statusOrder[a.status] - statusOrder[b.status];
  if (statusDiff !== 0) return statusDiff;
  return priorityOrder[a.priority] - priorityOrder[b.priority];
}
```

## Checklist (implementer)

- [ ] Remove all NotYetImplemented errors
- [ ] TodoRead loads from file and sorts correctly
- [ ] TodoWrite validates with Zod and saves to file
- [ ] TodoStore creates directory structure
- [ ] File paths include session and agent IDs
- [ ] Sorting matches Claude's behavior exactly
- [ ] All Phase 2 tests pass
- [ ] Type checking passes
- [ ] Linting passes

## Self-verify

```bash
npm run test -- todo-read.test.ts
npm run test -- todo-write.test.ts
npm run test -- todo-store.test.ts
npm run typecheck
npm run lint
# Verify todos directory created
test -d ~/.gemini/todos || echo "❌ Todos directory not created"
```
