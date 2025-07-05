# Phase 3 - Core Implementation (todo-lists)

## Goal
Implement the core logic for TodoRead, TodoWrite tools and TodoStore to make all Phase 2 tests pass.

## Deliverables
- [ ] Fully functional TodoRead tool implementation
- [ ] Fully functional TodoWrite tool implementation  
- [ ] Working TodoStore with in-memory persistence
- [ ] All Phase 2 tests passing

## Implementation Requirements

### TodoRead Tool
- Returns empty array when no todos exist
- Returns all todos with their id, content, status, and priority
- Tool schema requires no parameters

### TodoWrite Tool
- Accepts array of todo items
- Each todo must have: id, content, status (pending/in_progress/completed), priority (high/medium/low)
- Completely replaces the todo list (not incremental updates)
- Returns success confirmation

### TodoStore
- Thread-safe in-memory storage
- Persists for the duration of the CLI session only
- Provides getTodos() and setTodos() methods

## Checklist (implementer)
- [ ] Remove all NotYetImplemented errors
- [ ] TodoRead returns proper JSON response
- [ ] TodoWrite validates todo schema
- [ ] TodoStore handles concurrent access safely
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
```