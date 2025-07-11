# Phase 3b - Verification of Reminder System (todo-lists)

## Verification Steps

1. Check reminder implementation exists:

   ```bash
   test -f packages/core/src/tools/todo-reminders.ts || echo "❌ todo-reminders.ts missing"
   ```

2. Verify reminder templates:

   ```bash
   grep -q "system-reminder" packages/core/src/tools/todo-reminders.ts || echo "❌ Missing system-reminder tags"
   grep -q "empty.*DO NOT mention" packages/core/src/tools/todo-reminders.ts || echo "❌ Missing empty todo reminder"
   grep -q "changed.*DO NOT mention" packages/core/src/tools/todo-reminders.ts || echo "❌ Missing update confirmation"
   ```

3. Check TodoWrite integration:

   ```bash
   grep -q "todo-reminders" packages/core/src/tools/todo-write.ts || echo "❌ TodoWrite not importing reminders"
   grep -q "confirmation.*state" packages/core/src/tools/todo-write.ts || echo "❌ TodoWrite missing state confirmation"
   ```

4. Test reminder injection:

   ```bash
   npm run test -- todo-reminders || echo "❌ Reminder tests failing"
   ```

5. Verify system message handling:
   ```bash
   grep -q "system-reminder" packages/core/src/core/client.ts || echo "❌ Client not handling system reminders"
   ```

## Outcome

If all checks pass, emit ✅. Otherwise list all ❌ failures.
