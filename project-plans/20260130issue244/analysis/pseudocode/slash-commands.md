# Slash Commands Pseudocode

## Phase ID
`PLAN-20260130-ASYNCTASK.P02`

## Interface Contract

```
INPUTS:
  - User input starting with /tasks or /task
  
OUTPUTS:
  - Command execution result or error message
  
DEPENDENCIES:
  - AsyncTaskManager
  - Existing slash command infrastructure
```

## Command Registration

```
001: // In slash command registry (find existing pattern in CLI)
002: // Register /tasks and /task commands
003:
004: CONST ASYNC_TASK_COMMANDS = {
005:   'tasks': {
006:     description: 'List all async tasks',
007:     subcommands: {
008:       'list': 'List all async tasks with status'
009:     },
010:     handler: handleTasksCommand
011:   },
012:   'task': {
013:     description: 'Manage async tasks',
014:     subcommands: {
015:       'end': 'Cancel an async task by ID'
016:     },
017:     handler: handleTaskCommand
018:   }
019: }
```

## /tasks list Handler

```
025: FUNCTION handleTasksCommand(
026:   args: string[],
027:   context: { asyncTaskManager: AsyncTaskManager }
028: ): CommandResult {
029:
030:   LET subcommand = args[0]?.toLowerCase() ?? 'list'
031:
032:   IF subcommand !== 'list' THEN
033:     RETURN {
034:       success: false,
035:       message: `Unknown subcommand: ${subcommand}. Use '/tasks list'.`
036:     }
037:   END IF
038:
039:   LET tasks = context.asyncTaskManager.getAllTasks()
040:
041:   IF tasks.length === 0 THEN
042:     RETURN {
043:       success: true,
044:       message: 'No async tasks.'
045:     }
046:   END IF
047:
048:   // Build display
049:   LET lines: string[] = []
050:   lines.push('Async Tasks:')
051:   lines.push('')
052:
053:   FOR task IN tasks DO
054:     LET statusIcon = SWITCH task.status {
055:       'running': '[RUNNING]'
056:       'completed': '[DONE]'
057:       'failed': '[FAILED]'
058:       'cancelled': '[CANCELLED]'
059:     }
060:
061:     LET idPrefix = task.id.substring(0, 8)
062:     LET duration = formatDuration(task.launchedAt, task.completedAt)
063:     LET goalPreview = task.goalPrompt.substring(0, 40)
064:     IF task.goalPrompt.length > 40 THEN
065:       goalPreview += '...'
066:     END IF
067:
068:     lines.push(`${statusIcon} ${idPrefix}  ${task.subagentName}  ${duration}`)
069:     lines.push(`   Goal: ${goalPreview}`)
070:     lines.push('')
071:   END FOR
072:
073:   RETURN {
074:     success: true,
075:     message: lines.join('\n')
076:   }
077: }
```

## /task end Handler

```
083: FUNCTION handleTaskCommand(
084:   args: string[],
085:   context: { asyncTaskManager: AsyncTaskManager }
086: ): CommandResult {
087:
088:   LET subcommand = args[0]?.toLowerCase()
089:
090:   IF subcommand !== 'end' THEN
091:     RETURN {
092:       success: false,
093:       message: `Unknown subcommand: ${subcommand}. Use '/task end <id>'.`
094:     }
095:   END IF
096:
097:   LET taskId = args[1]
098:
099:   IF NOT taskId THEN
100:     RETURN {
101:       success: false,
102:       message: 'Usage: /task end <task_id>'
103:     }
104:   END IF
105:
106:   // Try exact match first
107:   LET task = context.asyncTaskManager.getTask(taskId)
108:
109:   IF NOT task THEN
110:     // Try prefix match
111:     LET { task: prefixTask, candidates } = context.asyncTaskManager.getTaskByPrefix(taskId)
112:
113:     IF prefixTask THEN
114:       task = prefixTask
115:     ELSE IF candidates AND candidates.length > 0 THEN
116:       // Ambiguous
117:       LET candidateList = candidates.map(c =>
118:         `  ${c.id.substring(0, 8)}  ${c.subagentName}`
119:       ).join('\n')
120:       RETURN {
121:         success: false,
122:         message: `Ambiguous task ID. Did you mean:\n${candidateList}`
123:       }
124:     ELSE
125:       RETURN {
126:         success: false,
127:         message: `Task not found: ${taskId}`
128:       }
129:     END IF
130:   END IF
131:
132:   // Check if already terminal
133:   IF task.status !== 'running' THEN
134:     RETURN {
135:       success: false,
136:       message: `Task ${task.id.substring(0, 8)} is already ${task.status}.`
137:     }
138:   END IF
139:
140:   // Cancel the task
141:   LET cancelled = context.asyncTaskManager.cancelTask(task.id)
142:
143:   IF cancelled THEN
144:     RETURN {
145:       success: true,
146:       message: `Cancelled task: ${task.subagentName} (${task.id.substring(0, 8)})`
147:     }
148:   ELSE
149:     RETURN {
150:       success: false,
151:       message: `Failed to cancel task ${task.id.substring(0, 8)}. It may have already completed.`
152:     }
153:   END IF
154: }
```

## Duration Formatter (shared)

```
160: FUNCTION formatDuration(startTime: number, endTime?: number): string {
161:   LET end = endTime ?? Date.now()
162:   LET durationMs = end - startTime
163:   LET seconds = Math.floor(durationMs / 1000)
164:
165:   IF seconds < 60 THEN
166:     RETURN `${seconds}s`
167:   END IF
168:
169:   LET minutes = Math.floor(seconds / 60)
170:   LET remainingSeconds = seconds % 60
171:
172:   IF minutes < 60 THEN
173:     RETURN `${minutes}m ${remainingSeconds}s`
174:   END IF
175:
176:   LET hours = Math.floor(minutes / 60)
177:   LET remainingMinutes = minutes % 60
178:   RETURN `${hours}h ${remainingMinutes}m`
179: }
```

## Integration with Existing Slash Commands

```
185: // Find existing slash command registration pattern
186: // Likely in packages/cli/src/commands/ or similar
187:
188: // Register commands with the slash command system
189: FUNCTION registerAsyncTaskCommands(registry: SlashCommandRegistry, asyncTaskManager: AsyncTaskManager): void {
190:   registry.register('tasks', {
191:     description: 'List async tasks',
192:     usage: '/tasks list',
193:     handler: (args) => handleTasksCommand(args, { asyncTaskManager })
194:   })
195:
196:   registry.register('task', {
197:     description: 'Manage async tasks',
198:     usage: '/task end <id>',
199:     handler: (args) => handleTaskCommand(args, { asyncTaskManager })
200:   })
201: }
```

## Anti-Pattern Warnings

```
ERROR: Line 106-130 - MUST handle prefix matching same as tool
  WHY: Consistency with check_async_tasks tool
  CORRECT: Exact match first, then prefix, then ambiguity handling

ERROR: Line 133-138 - MUST check status before cancel
  WHY: User should know if task already finished
  CORRECT: Return informative message about current status

ERROR: Line 141 - MUST use cancelTask not direct state change
  WHY: cancelTask handles abort controller and events
  CORRECT: Always go through AsyncTaskManager methods
```
