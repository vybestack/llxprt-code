# Plan: Async Subagent Execution

Plan ID: PLAN-20260130-ASYNCTASK
Generated: 2026-01-30
Total Phases: 16 (including verification phases)
Issue: #244
Design Document: `project-plans/20260130issue244/design.md`

## Requirements

- REQ-ASYNC-001: AsyncTaskManager Service
- REQ-ASYNC-002: History Limits
- REQ-ASYNC-003: Status Reminders
- REQ-ASYNC-004: Completion Notification Format
- REQ-ASYNC-005: MessageBus Event Types
- REQ-ASYNC-006: task-max-async Setting
- REQ-ASYNC-007: Config.getAsyncTaskManager()
- REQ-ASYNC-008: Task Tool async Parameter
- REQ-ASYNC-009: Resource Limit Enforcement
- REQ-ASYNC-010: Status Reminder Injection
- REQ-ASYNC-011: check_async_tasks List Mode
- REQ-ASYNC-012: check_async_tasks Peek Mode
- REQ-ASYNC-013: Unique Prefix Matching
- REQ-ASYNC-014: /tasks list Command
- REQ-ASYNC-015: /task end Command
- REQ-ASYNC-016: /task end Ambiguity Handling
- REQ-ASYNC-017: Auto-Trigger When Idle
- REQ-ASYNC-018: No Auto-Trigger When Busy
- REQ-ASYNC-019: check_async_tasks Tool Registration
- REQ-ASYNC-020: End-to-End Async Task Flow

## Critical Reminders

Before implementing ANY phase, ensure you have:

1. Completed preflight verification (Phase 0.5)
2. Read the full design document at `project-plans/20260130issue244/design.md`
3. Understood existing patterns: `TodoReminderService`, `CoreToolScheduler`, `MessageBus`
4. Written integration tests BEFORE unit tests (vertical slice)
5. Verified all dependencies and types exist as assumed

## Key Design Decisions

1. **Async tasks display identically to sync tasks** - same UI, same scheduler, CoreToolScheduler unchanged
2. **Uses TodoReminderService pattern** for status reminders (follow exact format)
3. **Tool confirmations work the same** as sync tasks (no special handling)
4. **History limit**: `2 * task-max-async` completed tasks (or 10 if unlimited)
5. **Notifications use same format** as sync task output
6. **State machine**: `running → completed/failed/cancelled` exactly once (atomic transitions)
7. **notifiedAt marked AFTER delivery** not before (use delivery queue pattern)
8. **Auto-trigger serialization**: Only one triggerAgentTurn in flight, coalesce multiple completions

## Integration Points (CRITICAL - feature is useless if not integrated)

### Existing Code That Will USE This Feature
- `packages/core/src/tools/task.ts` - Will branch on async parameter
- `packages/core/src/core/client.ts` - Will inject async task reminders
- `packages/cli/src/ui/hooks/useGeminiStream.ts` - Will subscribe to completions and auto-trigger

### Existing Code To Be MODIFIED
- `packages/core/src/confirmation-bus/types.ts` - Add async task event types
- `packages/core/src/settings/settingsRegistry.ts` - Add task-max-async setting
- `packages/core/src/config/config.ts` - Add getAsyncTaskManager()

### User Access Points
- Model: `task(subagent='name', goal='...', async=true)` - async parameter
- Model: `check_async_tasks()` - list/peek tool
- CLI: `/tasks` or `/tasks list` - list async tasks
- CLI: `/task end <id>` - cancel async task
- CLI: `/set task-max-async N` - configure limit

## Phase Structure

```
00-overview.md              ← This file
00a-preflight-verification.md
01-analysis.md
01a-analysis-verification.md
02-pseudocode.md
02a-pseudocode-verification.md
03-asynctaskmanager-stub.md
03a-asynctaskmanager-stub-verification.md
04-asynctaskmanager-tdd.md
04a-asynctaskmanager-tdd-verification.md
05-asynctaskmanager-impl.md
05a-asynctaskmanager-impl-verification.md
06-reminderservice-stub.md
06a-reminderservice-stub-verification.md
07-reminderservice-tdd.md
07a-reminderservice-tdd-verification.md
08-reminderservice-impl.md
08a-reminderservice-impl-verification.md
09-messagebus-settings.md
09a-messagebus-settings-verification.md
10-config-integration.md
10a-config-integration-verification.md
11-tasktool-async-stub.md
11a-tasktool-async-stub-verification.md
12-tasktool-async-tdd.md
12a-tasktool-async-tdd-verification.md
13-tasktool-async-impl.md
13a-tasktool-async-impl-verification.md
14-client-reminder-injection.md
14a-client-reminder-injection-verification.md
15-checkasync-tool-stub.md
15a-checkasync-tool-stub-verification.md
16-checkasync-tool-tdd.md
16a-checkasync-tool-tdd-verification.md
17-checkasync-tool-impl.md
17a-checkasync-tool-impl-verification.md
18-slash-commands-stub.md
18a-slash-commands-stub-verification.md
19-slash-commands-tdd.md
19a-slash-commands-tdd-verification.md
20-slash-commands-impl.md
20a-slash-commands-impl-verification.md
21-autotrigger-stub.md
21a-autotrigger-stub-verification.md
22-autotrigger-tdd.md
22a-autotrigger-tdd-verification.md
23-autotrigger-impl.md
23a-autotrigger-impl-verification.md
24-tool-registration.md
24a-tool-registration-verification.md
25-integration-tests.md
25a-integration-tests-verification.md
26-final-verification.md
```

## Execution Order

Phases MUST be executed in exact numerical sequence:
[OK] 00a → 01 → 01a → 02 → 02a → 03 → 03a → ...
[ERROR] 03 → 06 → 09 (WRONG - skipped phases)

## Code Traceability Requirements

Every function, test, and class MUST include:

```typescript
/**
 * @plan PLAN-20260130-ASYNCTASK.P[NN]
 * @requirement REQ-ASYNC-XXX
 * @pseudocode lines X-Y (if applicable)
 */
```
