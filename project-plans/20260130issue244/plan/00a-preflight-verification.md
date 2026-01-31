# Phase 0.5: Preflight Verification

## Phase ID
`PLAN-20260130-ASYNCTASK.P00a`

## Purpose
Verify ALL assumptions before writing any code.

## Dependency Verification

| Dependency | Expected Location | Verification Command | Output | Status |
|------------|-------------------|---------------------|--------|--------|
| TodoReminderService | `packages/core/src/services/todo-reminder-service.ts` | `head -50 packages/core/src/services/todo-reminder-service.ts` | [PENDING] | [ ] |
| MessageBus | `packages/core/src/confirmation-bus/message-bus.ts` | `head -50 packages/core/src/confirmation-bus/message-bus.ts` | [PENDING] | [ ] |
| MessageBusType | `packages/core/src/confirmation-bus/types.ts` | `grep -n "enum MessageBusType" packages/core/src/confirmation-bus/types.ts` | [PENDING] | [ ] |
| TaskTool | `packages/core/src/tools/task.ts` | `grep -n "class TaskTool" packages/core/src/tools/task.ts` | [PENDING] | [ ] |
| TaskToolParams | `packages/core/src/tools/task.ts` | `grep -n "interface TaskToolParams" packages/core/src/tools/task.ts` | [PENDING] | [ ] |
| SettingsRegistry | `packages/core/src/settings/settingsRegistry.ts` | `head -50 packages/core/src/settings/settingsRegistry.ts` | [PENDING] | [ ] |
| Config class | `packages/core/src/config/config.ts` | `grep -n "class Config" packages/core/src/config/config.ts` | [PENDING] | [ ] |
| appendSystemReminderToRequest | `packages/core/src/core/client.ts` | `grep -n "appendSystemReminderToRequest" packages/core/src/core/client.ts` | [PENDING] | [ ] |
| OutputObject | `packages/core/src/core/subagent.ts` | `grep -A10 "interface OutputObject\|type OutputObject" packages/core/src/core/subagent.ts` | [PENDING] | [ ] |

## Type/Interface Verification

| Type Name | Expected Definition | Verification Command | Actual Definition | Match? |
|-----------|---------------------|---------------------|-------------------|--------|
| OutputObject | `{ emitted_vars, final_message?, terminate_reason }` | `grep -A15 "OutputObject" packages/core/src/core/subagent.ts` | [PENDING] | [ ] |
| SubAgentScope | Has `output`, `runInteractive`, `runNonInteractive` | `grep -n "class SubAgentScope" packages/core/src/core/subagent.ts` | [PENDING] | [ ] |
| ToolResult | Has `llmContent`, `returnDisplay`, `metadata?`, `error?` | `grep -A15 "ToolResult" packages/core/src/tools/tools.ts` | [PENDING] | [ ] |
| TaskToolParams | Has fields for subagent_name, goal_prompt, etc | `grep -A20 "TaskToolParams" packages/core/src/tools/task.ts` | [PENDING] | [ ] |

## Call Path Verification

| Function | Expected Integration Point | Verification Command | Evidence | Exists? |
|----------|---------------------------|---------------------|----------|---------|
| appendSystemReminderToRequest | Called in client.ts request building | `grep -B5 -A5 "appendSystemReminderToRequest" packages/core/src/core/client.ts` | [PENDING] | [ ] |
| TodoReminderService.getReminder | Called in client.ts | `grep -n "todoReminderService\|TodoReminderService" packages/core/src/core/client.ts` | [PENDING] | [ ] |
| TaskTool registration | Where tools are registered | `grep -rn "new TaskTool\|TaskTool.Name" packages/core/src/` | [PENDING] | [ ] |
| Slash command registration | Where commands are registered | `grep -rn "registerCommand\|commands\[" packages/cli/src/ui/commands/` | [PENDING] | [ ] |
| useGeminiStream hook | Where agent turn triggering happens | `grep -n "triggerAgentTurn\|sendMessage\|isResponding" packages/cli/src/ui/` | [PENDING] | [ ] |

## Test Infrastructure Verification

| Component | Test File | Verification Command | Exists? | Patterns Work? |
|-----------|-----------|---------------------|---------|----------------|
| TaskTool | `packages/core/src/tools/task.test.ts` | `ls -la packages/core/src/tools/task.test.ts` | [ ] | [ ] |
| Services | `packages/core/src/services/*.test.ts` | `ls packages/core/src/services/*.test.ts` | [ ] | [ ] |
| Config | `packages/core/src/config/config.test.ts` | `ls -la packages/core/src/config/config.test.ts` | [ ] | [ ] |
| Client | `packages/core/src/core/client.test.ts` | `ls -la packages/core/src/core/client.test.ts` | [ ] | [ ] |
| CLI commands | `packages/cli/src/ui/commands/*.test.ts` | `ls packages/cli/src/ui/commands/*.test.ts 2>/dev/null` | [ ] | [ ] |

## Critical Auto-Trigger Dependencies

These MUST exist or the plan needs modification:

| Dependency | Expected Location | Verification | Status |
|------------|-------------------|--------------|--------|
| isResponding state | useGeminiStream or equivalent | `grep -rn "isResponding" packages/cli/src/ui/` | [ ] |
| isWaitingForConfirmation | useGeminiStream or equivalent | `grep -rn "isWaitingForConfirmation\|waitingForConfirmation" packages/cli/src/ui/` | [ ] |
| Method to trigger agent turn | sendMessage or triggerAgentTurn | `grep -rn "sendMessage\|triggerTurn" packages/cli/src/ui/hooks/` | [ ] |

## Blocking Issues Found

[To be filled in after running verification commands]

1. [Issue 1]
2. [Issue 2]
...

## Plan Modifications Required

[To be filled in based on blocking issues]

1. [Modification 1]
2. [Modification 2]
...

## Verification Gate

- [ ] All dependencies verified present
- [ ] All types match expectations
- [ ] All call paths are possible
- [ ] Test infrastructure ready
- [ ] Auto-trigger dependencies exist (or plan modified to create them)

**IF ANY CHECKBOX IS UNCHECKED: STOP and update plan before proceeding.**

## Verification Commands Script

Run all verifications at once:

```bash
#!/bin/bash
echo "=== PREFLIGHT VERIFICATION ==="
echo ""
echo "--- TodoReminderService ---"
head -50 packages/core/src/services/todo-reminder-service.ts 2>/dev/null || echo "NOT FOUND"
echo ""
echo "--- MessageBus ---"
head -50 packages/core/src/confirmation-bus/message-bus.ts 2>/dev/null || echo "NOT FOUND"
echo ""
echo "--- MessageBusType enum ---"
grep -n "enum MessageBusType" packages/core/src/confirmation-bus/types.ts
echo ""
echo "--- TaskTool class ---"
grep -n "class TaskTool" packages/core/src/tools/task.ts
echo ""
echo "--- TaskToolParams ---"
grep -A20 "interface TaskToolParams" packages/core/src/tools/task.ts
echo ""
echo "--- SettingsRegistry ---"
head -50 packages/core/src/settings/settingsRegistry.ts 2>/dev/null || echo "NOT FOUND"
echo ""
echo "--- Config class ---"
grep -n "class Config" packages/core/src/config/config.ts
echo ""
echo "--- appendSystemReminderToRequest ---"
grep -n "appendSystemReminderToRequest" packages/core/src/core/client.ts
echo ""
echo "--- OutputObject ---"
grep -A15 "OutputObject" packages/core/src/core/subagent.ts | head -20
echo ""
echo "--- Tool registration location ---"
grep -rn "new TaskTool\|TaskTool.Name" packages/core/src/ | head -10
echo ""
echo "--- Command registration ---"
grep -rn "registerCommand\|commands\[" packages/cli/src/ui/commands/ | head -10
echo ""
echo "--- Auto-trigger dependencies ---"
grep -rn "isResponding\|isWaitingForConfirmation\|triggerTurn\|sendMessage" packages/cli/src/ui/hooks/ | head -20
echo ""
echo "--- Test files ---"
ls -la packages/core/src/tools/task.test.ts 2>/dev/null || echo "task.test.ts NOT FOUND"
ls packages/core/src/services/*.test.ts 2>/dev/null || echo "No service tests found"
ls -la packages/core/src/config/config.test.ts 2>/dev/null || echo "config.test.ts NOT FOUND"
echo ""
echo "=== END PREFLIGHT ==="
```
