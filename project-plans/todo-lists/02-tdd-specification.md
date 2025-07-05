# Phase 2 - TDD Specification (todo-lists)

## Goal
Add comprehensive test suites that define the expected behavior of TodoRead and TodoWrite tools.

## Deliverables
- [ ] `/packages/core/src/tools/todo-read.test.ts` - TodoRead tool tests
- [ ] `/packages/core/src/tools/todo-write.test.ts` - TodoWrite tool tests
- [ ] `/packages/core/src/tools/todo-store.test.ts` - TodoStore tests

## Checklist (implementer)
- [ ] TodoRead tests cover: empty list, multiple todos, status filtering
- [ ] TodoWrite tests cover: creating, updating status, updating priority, removing todos
- [ ] TodoStore tests cover: persistence within session, concurrent access safety
- [ ] All tests assert real behavior (no reverse tests expecting NotYetImplemented)
- [ ] Tests use proper TypeScript types for todo items
- [ ] Tests follow existing testing patterns in the codebase

## Self-verify
```bash
npm run test -- todo-read.test.ts || echo "TodoRead tests not passing yet (expected)"
npm run test -- todo-write.test.ts || echo "TodoWrite tests not passing yet (expected)"
npm run test -- todo-store.test.ts || echo "TodoStore tests not passing yet (expected)"
npm run typecheck
```

## Note
Tests should fail in this phase as implementation is still stubbed.