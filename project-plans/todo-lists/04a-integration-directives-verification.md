# Phase 4a - Verification of Integration and Directives (todo-lists)

## Verification Steps

1. Check comprehensive system prompts:

   ```bash
   grep -q "TodoWrite" packages/core/src/core/prompts.ts || echo "❌ TodoWrite not in prompts"
   grep -q "TodoRead" packages/core/src/core/prompts.ts || echo "❌ TodoRead not in prompts"
   grep -q "VERY frequently" packages/core/src/core/prompts.ts || echo "❌ Missing frequency emphasis"
   grep -q "proactively" packages/core/src/core/prompts.ts || echo "❌ Missing proactiveness instruction"
   grep -q "ONE task in_progress" packages/core/src/core/prompts.ts || echo "❌ Missing single task constraint"
   grep -q "real-time" packages/core/src/core/prompts.ts || echo "❌ Missing real-time update rule"
   grep -q "When in doubt" packages/core/src/core/prompts.ts || echo "❌ Missing 'when in doubt' rule"
   ```

2. Verify examples included:

   ```bash
   grep -q "Example.*multi.*step" packages/core/src/core/prompts.ts || echo "❌ Missing multi-step example"
   grep -q "Example.*NOT.*use" packages/core/src/core/prompts.ts || echo "❌ Missing negative examples"
   ```

3. Check reminder system:

   ```bash
   grep -q "empty.*todo.*reminder" packages/core/src/tools/todo-write.ts || echo "❌ Missing empty todo reminder logic"
   grep -q "todo.*state.*confirmation" packages/core/src/tools/todo-write.ts || echo "❌ Missing state confirmation"
   ```

4. Verify todo tools registered:

   ```bash
   grep -q "TodoRead" packages/core/src/tools/tool-registry.ts || echo "❌ TodoRead not registered"
   grep -q "TodoWrite" packages/core/src/tools/tool-registry.ts || echo "❌ TodoWrite not registered"
   ```

5. Check for JSDoc documentation:

   ```bash
   grep -q "@example" packages/core/src/tools/todo-read.ts || echo "❌ TodoRead missing examples"
   grep -q "@example" packages/core/src/tools/todo-write.ts || echo "❌ TodoWrite missing examples"
   grep -q "proactive" packages/core/src/tools/todo-write.ts || echo "❌ TodoWrite missing proactiveness note"
   ```

6. Run integration tests:

   ```bash
   npm run test -- --grep "todo" || echo "❌ Todo tests failing"
   npm run test -- --grep "reminder" || echo "❌ Reminder system tests missing"
   ```

7. Verify all providers can use todo tools:
   ```bash
   for provider in "openai" "anthropic" "gemini" "qwen"; do
     grep -q "todo" packages/cli/src/providers/$provider/*.ts 2>/dev/null || echo "Note: Check $provider configuration"
   done
   ```

## Outcome

If all checks pass, emit ✅. Otherwise list all ❌ failures.
