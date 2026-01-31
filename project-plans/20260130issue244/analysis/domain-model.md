# Domain Model Analysis

## Phase ID
`PLAN-20260130-ASYNCTASK.P01`

## Core Entities

### AsyncTaskInfo
The central data structure representing an async task.

```
AsyncTaskInfo {
  id: string                    // Unique identifier (agentId from orchestrator)
  subagentName: string          // Name of the subagent being run
  goalPrompt: string            // The goal/prompt given to the subagent
  status: AsyncTaskStatus       // Current state: running|completed|failed|cancelled
  launchedAt: number            // Unix timestamp when task started
  completedAt?: number          // Unix timestamp when task reached terminal state
  notifiedAt?: number           // Unix timestamp when model was notified of completion
  output?: OutputObject         // Result from successful completion
  error?: string                // Error message from failure
  abortController?: AbortController  // For cancellation
}
```

### AsyncTaskStatus (State Machine)
```
         ┌──────────────────────────────────────────┐
         │                RUNNING                   │
         │  (initial state, set on registerTask)    │
         └────────────┬─────────────┬───────────────┘
                      │             │               │
    completeTask()    │  failTask() │  cancelTask() │
                      ▼             ▼               ▼
              ┌───────────┐  ┌──────────┐  ┌────────────┐
              │ COMPLETED │  │  FAILED  │  │ CANCELLED  │
              │ (terminal)│  │(terminal)│  │ (terminal) │
              └───────────┘  └──────────┘  └────────────┘

Invariants:
- Each task transitions from RUNNING to exactly ONE terminal state
- Transitions are idempotent: repeat calls return false, no state change
- First transition wins (atomic)
```

## Services

### AsyncTaskManager
Central registry and state machine for async tasks.

**Responsibilities:**
- Track all async tasks (Map<id, AsyncTaskInfo>)
- Enforce state machine transitions
- Enforce resource limits (task-max-async)
- Enforce history limits (2*max or 10 if unlimited)
- Emit events on state transitions

**Dependencies:**
- EventEmitter (node:events)
- Config (for settings)

**Consumers:**
- TaskTool (registers tasks, updates status)
- AsyncTaskReminderService (queries for pending notifications)
- AsyncTaskAutoTrigger (subscribes to completion events)
- CheckAsyncTasksTool (queries task status)
- Slash commands (list/cancel tasks)

### AsyncTaskReminderService
Generates formatted notifications for the model.

**Responsibilities:**
- Generate status summary for system instruction
- Generate completion notifications matching sync task format
- Track which notifications have been delivered
- Mark notifications as delivered after successful injection

**Dependencies:**
- AsyncTaskManager

**Consumers:**
- Client (for system instruction updates)
- AsyncTaskAutoTrigger (for notification content)

### AsyncTaskAutoTrigger
Handles automatic notification delivery when agent is idle.

**Responsibilities:**
- Subscribe to task completion/failure events
- Check if agent is idle (not responding, not waiting for confirmation)
- Inject completion notification and trigger agent turn
- Serialize triggers (only one in flight)
- Mark notifications as delivered AFTER successful delivery

**Dependencies:**
- AsyncTaskManager
- AsyncTaskReminderService
- Client (isAgentBusy, triggerAgentTurn)

## Tools

### TaskTool (modified)
Existing tool, extended with async mode.

**New Parameter:**
- `async?: boolean` - If true, launch without blocking

**New Behavior:**
- Check canLaunchAsync() before async launch
- Register task with AsyncTaskManager
- Return immediately with launch status
- Execute subagent in background
- Update AsyncTaskManager on completion/failure

### CheckAsyncTasksTool (new)
Model tool to query async task status.

**Parameters:**
- `task_id?: string` - Optional task ID or prefix

**Behavior:**
- No args: List all tasks with status
- With task_id: Get detailed info for matching task
- Prefix matching with ambiguity handling

## Slash Commands

### /tasks list
User command to view async tasks.

**Output:**
- Status icon + task ID prefix + subagent name + duration + goal preview

### /task end <id>
User command to cancel an async task.

**Behavior:**
- Prefix matching for task ID
- Call cancelTask() which aborts the subagent
- Confirmation message

## Settings

### task-max-async
Maximum concurrent async tasks.

- Default: 5
- Range: -1 (unlimited) to 100
- Applied via AsyncTaskManager.setMaxAsyncTasks()

## Integration Points

### Config
- getAsyncTaskManager(): AsyncTaskManager (singleton)
- getAsyncTaskReminderService(): AsyncTaskReminderService (singleton)
- setupAsyncTaskAutoTrigger(): wires auto-trigger to client

### Client
- isAgentBusy(): boolean - check if model is responding or waiting for confirmation
- triggerAgentTurn(message: string): Promise<void> - inject message and trigger response
- Next-turn reminders include async task status

### Tool Registration
- CheckAsyncTasksTool registered with tool registry
- TaskTool dependencies updated to include getAsyncTaskManager

## Data Flow

### Async Task Launch
```
1. Model calls Task(subagent='X', goal='Y', async=true)
2. TaskTool.execute() checks canLaunchAsync()
3. TaskTool registers task with AsyncTaskManager
4. TaskTool returns immediately with launch status
5. Background: subagent executes
6. Background: on completion, TaskTool calls completeTask()
7. AsyncTaskManager emits 'task-completed' event
8. AsyncTaskAutoTrigger receives event
9. If agent idle: triggerAgentTurn with notification
10. If agent busy: deferred to next-turn reminder
```

### Notification Delivery
```
1. AsyncTaskAutoTrigger.maybeAutoTrigger() called
2. Check isTriggering (serialize)
3. Check isAgentBusy()
4. Check hasPendingNotifications()
5. Generate reminder via AsyncTaskReminderService
6. Call triggerAgentTurn(reminder)
7. On SUCCESS: markAllNotified()
8. On FAILURE: leave pending for next turn
```

### History Cleanup
```
1. On each terminal transition (complete/fail/cancel)
2. Calculate limit: max === -1 ? 10 : max * 2
3. Get terminal tasks sorted by completedAt ASC
4. While count > limit:
   - If oldest has notifiedAt set: remove it
   - Else: stop (don't remove unnotified)
```
