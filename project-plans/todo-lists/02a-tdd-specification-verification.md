# Phase 2a - Verification of TDD Specification (todo-lists)

## Verification Steps

1. Check test files exist:

   ```bash
   test -f packages/core/src/tools/todo-read.test.ts || echo "❌ todo-read.test.ts missing"
   test -f packages/core/src/tools/todo-write.test.ts || echo "❌ todo-write.test.ts missing"
   test -f packages/core/src/tools/todo-store.test.ts || echo "❌ todo-store.test.ts missing"
   ```

2. Verify no reverse tests:

   ```bash
   grep -i "expect.*NotYetImplemented" packages/core/src/tools/todo-*.test.ts && echo "❌ Found reverse test expecting NotYetImplemented"
   grep -i "toThrow.*NotYetImplemented" packages/core/src/tools/todo-*.test.ts && echo "❌ Found reverse test expecting NotYetImplemented"
   ```

3. Check test coverage topics:

   ```bash
   grep -q "empty list" packages/core/src/tools/todo-read.test.ts || echo "❌ Missing empty list test"
   grep -q "status" packages/core/src/tools/todo-write.test.ts || echo "❌ Missing status update test"
   grep -q "priority" packages/core/src/tools/todo-write.test.ts || echo "❌ Missing priority test"
   ```

4. Verify tests are runnable:
   ```bash
   npm run test -- todo-read.test.ts 2>&1 | grep -q "test" || echo "❌ todo-read tests not found"
   npm run test -- todo-write.test.ts 2>&1 | grep -q "test" || echo "❌ todo-write tests not found"
   ```

## Outcome

If all checks pass, emit ✅. Otherwise list all ❌ failures.
