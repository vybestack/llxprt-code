# Phase 1a - Verification of Stub Scaffolding (todo-lists)

## Verification Steps

1. Check that todo tool files exist:

   ```bash
   test -f packages/core/src/tools/todo-read.ts || echo "❌ todo-read.ts missing"
   test -f packages/core/src/tools/todo-write.ts || echo "❌ todo-write.ts missing"
   test -f packages/core/src/tools/todo-store.ts || echo "❌ todo-store.ts missing"
   test -f packages/core/src/tools/todo-schemas.ts || echo "❌ todo-schemas.ts missing"
   ```

2. Verify tools are exported:

   ```bash
   grep -q "todo-read" packages/core/src/tools/tools.ts || echo "❌ todo-read not exported"
   grep -q "todo-write" packages/core/src/tools/tools.ts || echo "❌ todo-write not exported"
   ```

3. Check for NotYetImplemented errors:

   ```bash
   grep -q "NotYetImplemented" packages/core/src/tools/todo-read.ts || echo "❌ todo-read missing NotYetImplemented"
   grep -q "NotYetImplemented" packages/core/src/tools/todo-write.ts || echo "❌ todo-write missing NotYetImplemented"
   grep -q "NotYetImplemented" packages/core/src/tools/todo-store.ts || echo "❌ todo-store missing NotYetImplemented"
   ```

4. Verify Zod schemas exist:

   ```bash
   grep -q "z.enum.*pending.*in_progress.*completed" packages/core/src/tools/todo-schemas.ts || echo "❌ TodoStatus schema missing"
   grep -q "z.enum.*high.*medium.*low" packages/core/src/tools/todo-schemas.ts || echo "❌ TodoPriority schema missing"
   grep -q "z.object" packages/core/src/tools/todo-schemas.ts || echo "❌ TodoSchema missing"
   ```

5. Run type checking:

   ```bash
   npm run typecheck || echo "❌ Type checking failed"
   ```

6. Run linting:
   ```bash
   npm run lint || echo "❌ Linting failed"
   ```

## Outcome

If all checks pass, emit ✅. Otherwise list all ❌ failures.
