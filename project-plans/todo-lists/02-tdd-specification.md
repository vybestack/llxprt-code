# Phase 2 - TDD Specification (todo-lists)

## Goal

Add comprehensive test suites that define the expected behavior of TodoRead and TodoWrite tools.

## Deliverables

- [ ] `/packages/core/src/tools/todo-read.test.ts` - TodoRead tool tests
- [ ] `/packages/core/src/tools/todo-write.test.ts` - TodoWrite tool tests
- [ ] `/packages/core/src/tools/todo-store.test.ts` - TodoStore tests
- [ ] `/packages/core/src/tools/todo-schemas.test.ts` - Schema validation tests

## Test Specifications

### TodoRead Tests

```typescript
describe('TodoRead', () => {
  it('should return empty array when no todos exist', async () => {
    const result = await todoRead.execute({}, context);
    expect(result.todos).toEqual([]);
  });

  it('should return sorted todos (in_progress first, then pending, then completed)', async () => {
    // Setup: Create todos with different statuses
    const result = await todoRead.execute({}, context);
    expect(result.todos[0].status).toBe('in_progress');
    expect(result.todos[result.todos.length - 1].status).toBe('completed');
  });

  it('should sort by priority within same status', async () => {
    // Setup: Create todos with same status but different priorities
    const result = await todoRead.execute({}, context);
    // Verify high priority comes before low priority
  });
});
```

### TodoWrite Tests

```typescript
describe('TodoWrite', () => {
  it('should create new todos with valid schema', async () => {
    const newTodos = [
      { id: '1', content: 'Test task', status: 'pending', priority: 'high' },
    ];
    const result = await todoWrite.execute({ todos: newTodos }, context);
    expect(result.newTodos).toEqual(newTodos);
  });

  it('should validate todo schema and reject invalid data', async () => {
    const invalidTodos = [{ id: '1', content: '', status: 'invalid' }];
    await expect(
      todoWrite.execute({ todos: invalidTodos }, context),
    ).rejects.toThrow('Validation error');
  });

  it('should return both old and new todos for diff tracking', async () => {
    // Setup: Create initial todos
    const result = await todoWrite.execute({ todos: updatedTodos }, context);
    expect(result.oldTodos).toBeDefined();
    expect(result.newTodos).toBeDefined();
  });

  it('should completely replace todo list (not merge)', async () => {
    // Setup: Create 3 todos, then write only 1
    const result = await todoWrite.execute({ todos: [singleTodo] }, context);
    expect(result.newTodos).toHaveLength(1);
  });
});
```

### TodoStore Tests

```typescript
describe('TodoStore', () => {
  it('should persist todos to file system', async () => {
    await store.saveTodos(todos, agentId);
    const loaded = await store.loadTodos(agentId);
    expect(loaded).toEqual(todos);
  });

  it('should create todos directory if not exists', async () => {
    // Verify directory creation logic
  });

  it('should handle concurrent access safely', async () => {
    // Test multiple simultaneous reads/writes
  });

  it('should use agent-specific file names', async () => {
    await store.saveTodos(todos, 'agent1');
    await store.saveTodos(differentTodos, 'agent2');
    expect(await store.loadTodos('agent1')).not.toEqual(
      await store.loadTodos('agent2'),
    );
  });
});
```

## Checklist (implementer)

- [ ] All tests define expected behavior without implementation details
- [ ] No tests expect or catch NotYetImplemented errors
- [ ] Tests cover edge cases (empty arrays, invalid data)
- [ ] Tests verify sorting behavior matches Claude's implementation
- [ ] Schema validation tests ensure data integrity
- [ ] File system persistence tests verify storage behavior
- [ ] All tests currently fail (since implementation is stubbed)

## Self-verify

```bash
npm run test -- todo-read.test.ts 2>&1 | grep -q "fail" || echo "❌ Tests should be failing"
npm run test -- todo-write.test.ts 2>&1 | grep -q "fail" || echo "❌ Tests should be failing"
npm run test -- todo-store.test.ts 2>&1 | grep -q "fail" || echo "❌ Tests should be failing"
npm run typecheck
```

## Note

Tests should fail in this phase as implementation is still stubbed. This is expected and correct.
