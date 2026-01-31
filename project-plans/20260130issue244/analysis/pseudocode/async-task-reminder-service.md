# AsyncTaskReminderService Pseudocode

## Phase ID
`PLAN-20260130-ASYNCTASK.P02`

## Interface Contract

```
INPUTS:
  - AsyncTaskManager instance
  
OUTPUTS:
  - Status summary strings for system instruction
  - Completion notification strings matching sync task format
  
DEPENDENCIES:
  - AsyncTaskManager
```

## Class Implementation

```
001: CLASS AsyncTaskReminderService {
002:   PRIVATE taskManager: AsyncTaskManager
003:
004:   CONSTRUCTOR(taskManager: AsyncTaskManager) {
005:     this.taskManager = taskManager
006:   }
```

### generateStatusSummary

```
012:   // Generate status for system instruction
013:   // Format matches user request: "[ASYNC TASKS: X total] [1] name - status..."
014:   METHOD generateStatusSummary(): string {
015:     LET tasks = this.taskManager.getAllTasks()
016:
017:     IF tasks.length === 0 THEN
018:       RETURN ''  // No async tasks - return empty
019:     END IF
020:
021:     LET lines: string[] = []
022:     lines.push(`[ASYNC TASKS: ${tasks.length} total]`)
023:
024:     FOR i = 0 TO tasks.length - 1 DO
025:       LET task = tasks[i]
026:       LET statusIcon = SWITCH task.status {
027:         'running': '[RUNNING]'
028:         'completed': '[DONE]'
029:         'failed': '[FAILED]'
030:         'cancelled': '[CANCELLED]'
031:       }
032:       // Short ID prefix for readability
033:       LET idPrefix = task.id.substring(0, 8)
034:       lines.push(`[${i + 1}] ${task.subagentName} - ${statusIcon} (${idPrefix}...)`)
035:     END FOR
036:
037:     RETURN lines.join('\n')
038:   }
```

### generateReminder

```
044:   // Generate reminder for next turn (matches TodoReminderService format)
045:   METHOD generateReminder(): string {
046:     LET pending = this.taskManager.getPendingNotifications()
047:     LET running = this.taskManager.getRunningTasks()
048:
049:     IF pending.length === 0 AND running.length === 0 THEN
050:       RETURN ''
051:     END IF
052:
053:     LET parts: string[] = []
054:
055:     // Pending completions - include full output
056:     IF pending.length > 0 THEN
057:       parts.push(`${pending.length} async task(s) completed:`)
058:       FOR task IN pending DO
059:         parts.push(this.formatCompletionNotification(task))
060:       END FOR
061:     END IF
062:
063:     // Running tasks - just summary
064:     IF running.length > 0 THEN
065:       parts.push(`${running.length} async task(s) still running.`)
066:     END IF
067:
068:     // ERROR: Format MUST match TodoReminderService exactly
069:     // See: packages/core/src/services/todo-reminder-service.ts line 98-100
070:     RETURN `---\nSystem Note: Async Task Status\n\n${parts.join('\n\n')}\n---`
071:   }
```

### formatCompletionNotification

```
077:   // Format completion to match sync task.ts formatSuccessContent
078:   // See: packages/core/src/tools/task.ts lines 109-121
079:   METHOD formatCompletionNotification(task: AsyncTaskInfo): string {
080:     IF task.status === 'completed' AND task.output THEN
081:       // Match sync task format exactly
082:       LET payload = {
083:         agent_id: task.id,
084:         terminate_reason: task.output.terminate_reason,
085:         emitted_vars: task.output.emitted_vars ?? {}
086:       }
087:
088:       IF task.output.final_message !== undefined THEN
089:         payload.final_message = task.output.final_message
090:       END IF
091:
092:       RETURN JSON.stringify(payload, null, 2)
093:
094:     ELSE IF task.status === 'failed' THEN
095:       RETURN JSON.stringify({
096:         agent_id: task.id,
097:         status: 'failed',
098:         error: task.error
099:       }, null, 2)
100:
101:     ELSE IF task.status === 'cancelled' THEN
102:       RETURN JSON.stringify({
103:         agent_id: task.id,
104:         status: 'cancelled'
105:       }, null, 2)
106:
107:     END IF
108:
109:     RETURN ''
110:   }
```

### Notification State Methods

```
116:   METHOD hasPendingNotifications(): boolean {
117:     RETURN this.taskManager.getPendingNotifications().length > 0
118:   }
119:
120:   // ERROR: Call this ONLY AFTER successful delivery to model
121:   // DO NOT call before triggerAgentTurn succeeds
122:   METHOD markAllNotified(): void {
123:     LET pending = this.taskManager.getPendingNotifications()
124:     FOR task IN pending DO
125:       this.taskManager.markNotified(task.id)
126:     END FOR
127:   }
128: }
```

## Anti-Pattern Warnings

```
ERROR: Line 70 - Format MUST use exact delimiters
  WHY: Model expects consistent format across reminders
  CORRECT: Use "---\nSystem Note: ...\n---" exactly like TodoReminderService

ERROR: Line 121-122 - DO NOT mark notified before delivery
  WHY: If delivery fails, notification would be lost
  CORRECT: Call markAllNotified ONLY after triggerAgentTurn resolves

ERROR: Line 82-92 - MUST match sync task format
  WHY: Model expects same format for sync and async results
  CORRECT: Use exact field names from task.ts formatSuccessContent
```
