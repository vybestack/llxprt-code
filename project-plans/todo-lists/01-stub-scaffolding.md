# Phase 1 - Stub Scaffolding (todo-lists)

## Goal

Create the basic structure for TodoRead and TodoWrite tools with compile-able skeleton throwing `NotYetImplemented`.

## Deliverables

- [ ] `/packages/core/src/tools/todo-read.ts` - TodoRead tool class
- [ ] `/packages/core/src/tools/todo-write.ts` - TodoWrite tool class
- [ ] `/packages/core/src/tools/todo-store.ts` - File-based todo storage
- [ ] `/packages/core/src/tools/todo-schemas.ts` - Zod schemas for validation
- [ ] Update `/packages/core/src/tools/tools.ts` to export new tools
- [ ] Update `/packages/core/src/tools/tool-registry.ts` to register tools

## Schema Definitions (todo-schemas.ts)

```typescript
import { z } from 'zod';

export const TodoStatus = z.enum(['pending', 'in_progress', 'completed']);
export const TodoPriority = z.enum(['high', 'medium', 'low']);

export const TodoSchema = z.object({
  id: z.string(),
  content: z.string().min(1),
  status: TodoStatus,
  priority: TodoPriority,
});

export const TodoArraySchema = z.array(TodoSchema);
export type Todo = z.infer<typeof TodoSchema>;
export type TodoStatus = z.infer<typeof TodoStatus>;
export type TodoPriority = z.infer<typeof TodoPriority>;
```

## Checklist (implementer)

- [ ] Create TodoRead tool with empty input schema and NotYetImplemented error
- [ ] Create TodoWrite tool with todos array schema and NotYetImplemented error
- [ ] Create TodoStore with file-based storage methods (all throwing NotYetImplemented)
- [ ] Create todo-schemas.ts with Zod validation schemas
- [ ] Register both tools in the tool registry
- [ ] All files compile without errors
- [ ] Type definitions match expected schemas

## Self-verify

```bash
npm run typecheck
npm run lint
```

## Note

All methods should throw `new Error('NotYetImplemented')` in this phase.
