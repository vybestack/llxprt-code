# Phase 3c - Verification of Tool Response Formatting (todo-lists)

## Verification Steps

1. Check TodoRead response format:

   ```bash
   grep -q "JSON.stringify.*todos" packages/core/src/tools/todo-read.ts || echo "❌ TodoRead not returning raw array"
   grep -q "mapToolResultToToolResultBlockParam" packages/core/src/tools/todo-read.ts || echo "❌ TodoRead missing result mapping"
   ```

2. Check TodoWrite response format:

   ```bash
   grep -q "oldTodos.*newTodos" packages/core/src/tools/todo-write.ts || echo "❌ TodoWrite not returning diff"
   grep -q "Todos have been modified successfully" packages/core/src/tools/todo-write.ts || echo "❌ TodoWrite missing confirmation message"
   ```

3. Verify tool response methods:

   ```bash
   grep -q "renderToolUseMessage" packages/core/src/tools/todo-read.ts || echo "❌ TodoRead missing render methods"
   grep -q "renderToolResultMessage" packages/core/src/tools/todo-write.ts || echo "❌ TodoWrite missing render methods"
   ```

4. Test response formatting:
   ```bash
   npm run test -- --grep "mapToolResult" || echo "❌ Response mapping tests failing"
   ```

## Outcome

If all checks pass, emit ✅. Otherwise list all ❌ failures.
