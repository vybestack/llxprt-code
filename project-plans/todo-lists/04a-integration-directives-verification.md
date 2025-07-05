# Phase 4a - Verification of Integration and Directives (todo-lists)

## Verification Steps

1. Check system prompts updated:
   ```bash
   grep -q "TodoWrite" packages/core/src/core/prompts.ts || echo "❌ TodoWrite not in prompts"
   grep -q "TodoRead" packages/core/src/core/prompts.ts || echo "❌ TodoRead not in prompts"
   grep -q "todo list" packages/core/src/core/prompts.ts || echo "❌ Todo usage instructions missing"
   ```

2. Verify todo tools registered:
   ```bash
   grep -q "TodoRead" packages/core/src/tools/tool-registry.ts || echo "❌ TodoRead not registered"
   grep -q "TodoWrite" packages/core/src/tools/tool-registry.ts || echo "❌ TodoWrite not registered"
   ```

3. Check for JSDoc documentation:
   ```bash
   grep -q "@example" packages/core/src/tools/todo-read.ts || echo "❌ TodoRead missing examples"
   grep -q "@example" packages/core/src/tools/todo-write.ts || echo "❌ TodoWrite missing examples"
   ```

4. Run integration tests:
   ```bash
   npm run test -- --grep "todo" || echo "❌ Todo tests failing"
   ```

5. Verify all providers can use todo tools:
   ```bash
   grep -q "todo" packages/cli/src/providers/providerManagerInstance.ts || echo "Note: Check provider configurations manually"
   ```

## Outcome
If all checks pass, emit ✅. Otherwise list all ❌ failures.