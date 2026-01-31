# CheckAsyncTasksTool Pseudocode

## Phase ID
`PLAN-20260130-ASYNCTASK.P02`

## Interface Contract

```
INPUTS:
  - task_id?: string (optional, for peek mode or prefix match)
  
OUTPUTS:
  - List mode: All tasks with status summary
  - Peek mode: Detailed info for specific task
  
DEPENDENCIES:
  - AsyncTaskManager
```

## Schema Definition

```
001: // Tool declaration (follows pattern from list-subagents.ts)
002: CLASS CheckAsyncTasksTool EXTENDS BaseDeclarativeTool<Params, ToolResult> {
003:   STATIC Name = 'check_async_tasks'
004:
005:   CONSTRUCTOR(deps: { getAsyncTaskManager: () => AsyncTaskManager }) {
006:     SUPER(
007:       CheckAsyncTasksTool.Name,
008:       'Check Async Tasks',
009:       'Check the status of background async tasks. Call with no arguments to list all tasks, ' +
010:         'or provide a task_id (or prefix) to get detailed info about a specific task.',
011:       Kind.Think,  // Low-risk informational tool
012:       {
013:         type: 'object',
014:         additionalProperties: false,
015:         properties: {
016:           task_id: {
017:             type: 'string',
018:             description: 'Optional task ID or unique prefix to get details for a specific task.'
019:           }
020:         }
021:       },
022:       deps
023:     )
024:   }
025: }
```

## Parameters Interface

```
031: INTERFACE CheckAsyncTasksParams {
032:   task_id?: string
033: }
```

## Invocation Class

```
039: CLASS CheckAsyncTasksInvocation EXTENDS BaseToolInvocation<Params, ToolResult> {
040:
041:   CONSTRUCTOR(
042:     params: CheckAsyncTasksParams,
043:     taskManager: AsyncTaskManager
044:   ) {
045:     SUPER(params)
046:     this.taskManager = taskManager
047:   }
048:
049:   METHOD getDescription(): string {
050:     IF this.params.task_id THEN
051:       RETURN `Check status of async task '${this.params.task_id}'`
052:     END IF
053:     RETURN 'List all async tasks'
054:   }
```

## Execute - List Mode

```
060:   METHOD execute(signal: AbortSignal): Promise<ToolResult> {
061:     // Peek mode: specific task requested
062:     IF this.params.task_id THEN
063:       RETURN this.executePeek(this.params.task_id)
064:     END IF
065:
066:     // List mode: show all tasks
067:     RETURN this.executeList()
068:   }
069:
070:   PRIVATE METHOD executeList(): ToolResult {
071:     LET tasks = this.taskManager.getAllTasks()
072:
073:     IF tasks.length === 0 THEN
074:       RETURN {
075:         llmContent: 'No async tasks.',
076:         returnDisplay: 'No async tasks are currently running or completed.',
077:         metadata: { count: 0 }
078:       }
079:     END IF
080:
081:     // Build summary
082:     LET running = tasks.filter(t => t.status === 'running')
083:     LET completed = tasks.filter(t => t.status === 'completed')
084:     LET failed = tasks.filter(t => t.status === 'failed')
085:     LET cancelled = tasks.filter(t => t.status === 'cancelled')
086:
087:     LET lines: string[] = []
088:     lines.push(`Async Tasks Summary:`)
089:     lines.push(`- Running: ${running.length}`)
090:     lines.push(`- Completed: ${completed.length}`)
091:     lines.push(`- Failed: ${failed.length}`)
092:     lines.push(`- Cancelled: ${cancelled.length}`)
093:     lines.push('')
094:     lines.push('Details:')
095:
096:     FOR task IN tasks DO
097:       LET statusIcon = SWITCH task.status {
098:         'running': ''
099:         'completed': '[OK]'
100:         'failed': '[ERROR]'
101:         'cancelled': ''
102:       }
103:       LET idPrefix = task.id.substring(0, 8)
104:       LET duration = this.formatDuration(task.launchedAt, task.completedAt)
105:       lines.push(`${statusIcon} [${idPrefix}] ${task.subagentName} - ${task.status} (${duration})`)
106:     END FOR
107:
108:     LET llmContent = lines.join('\n')
109:
110:     // Display version (same content, maybe markdown)
111:     LET displayLines = tasks.map(t => {
112:       LET icon = t.status === 'running' ? '' : t.status === 'completed' ? '[OK]' : t.status === 'failed' ? '[ERROR]' : ''
113:       RETURN `${icon} **${t.subagentName}** (\`${t.id.substring(0, 8)}\`) - ${t.status}`
114:     })
115:
116:     RETURN {
117:       llmContent: llmContent,
118:       returnDisplay: displayLines.join('\n'),
119:       metadata: {
120:         count: tasks.length,
121:         running: running.length,
122:         completed: completed.length,
123:         failed: failed.length,
124:         cancelled: cancelled.length
125:       }
126:     }
127:   }
```

## Execute - Peek Mode

```
133:   PRIVATE METHOD executePeek(taskId: string): ToolResult {
134:     // Try exact match first
135:     LET task = this.taskManager.getTask(taskId)
136:
137:     IF task THEN
138:       RETURN this.formatTaskDetails(task)
139:     END IF
140:
141:     // Try prefix match
142:     LET { task: prefixTask, candidates } = this.taskManager.getTaskByPrefix(taskId)
143:
144:     IF prefixTask THEN
145:       RETURN this.formatTaskDetails(prefixTask)
146:     END IF
147:
148:     IF candidates AND candidates.length > 0 THEN
149:       // Ambiguous prefix
150:       LET candidateList = candidates.map(c => `- ${c.id.substring(0, 8)}... (${c.subagentName})`).join('\n')
151:       RETURN {
152:         llmContent: `Ambiguous task ID prefix '${taskId}'. Candidates:\n${candidateList}`,
153:         returnDisplay: `Ambiguous prefix. Did you mean:\n${candidateList}`,
154:         error: { message: 'Ambiguous task ID', type: ToolErrorType.PARAMETER_VALIDATION }
155:       }
156:     END IF
157:
158:     // Not found
159:     RETURN {
160:       llmContent: `No async task found with ID or prefix '${taskId}'.`,
161:       returnDisplay: `Task not found: ${taskId}`,
162:       error: { message: 'Task not found', type: ToolErrorType.PARAMETER_VALIDATION }
163:     }
164:   }
165:
166:   PRIVATE METHOD formatTaskDetails(task: AsyncTaskInfo): ToolResult {
167:     LET details: Record<string, unknown> = {
168:       id: task.id,
169:       subagentName: task.subagentName,
170:       goalPrompt: task.goalPrompt,
171:       status: task.status,
172:       launchedAt: new Date(task.launchedAt).toISOString(),
173:       duration: this.formatDuration(task.launchedAt, task.completedAt)
174:     }
175:
176:     IF task.completedAt THEN
177:       details.completedAt = new Date(task.completedAt).toISOString()
178:     END IF
179:
180:     IF task.output THEN
181:       details.output = task.output
182:     END IF
183:
184:     IF task.error THEN
185:       details.error = task.error
186:     END IF
187:
188:     RETURN {
189:       llmContent: JSON.stringify(details, null, 2),
190:       returnDisplay: this.formatTaskDisplay(task),
191:       metadata: details
192:     }
193:   }
```

## Helper Methods

```
199:   PRIVATE METHOD formatDuration(startTime: number, endTime?: number): string {
200:     LET end = endTime ?? Date.now()
201:     LET durationMs = end - startTime
202:     LET seconds = Math.floor(durationMs / 1000)
203:
204:     IF seconds < 60 THEN
205:       RETURN `${seconds}s`
206:     END IF
207:
208:     LET minutes = Math.floor(seconds / 60)
209:     LET remainingSeconds = seconds % 60
210:
211:     IF minutes < 60 THEN
212:       RETURN `${minutes}m ${remainingSeconds}s`
213:     END IF
214:
215:     LET hours = Math.floor(minutes / 60)
216:     LET remainingMinutes = minutes % 60
217:     RETURN `${hours}h ${remainingMinutes}m`
218:   }
219:
220:   PRIVATE METHOD formatTaskDisplay(task: AsyncTaskInfo): string {
221:     LET lines: string[] = []
222:     LET icon = task.status === 'running' ? '' : task.status === 'completed' ? '[OK]' : task.status === 'failed' ? '[ERROR]' : ''
223:
224:     lines.push(`${icon} **${task.subagentName}**`)
225:     lines.push(`ID: \`${task.id}\``)
226:     lines.push(`Status: ${task.status}`)
227:     lines.push(`Goal: ${task.goalPrompt.substring(0, 100)}${task.goalPrompt.length > 100 ? '...' : ''}`)
228:     lines.push(`Duration: ${this.formatDuration(task.launchedAt, task.completedAt)}`)
229:
230:     IF task.output?.emitted_vars AND Object.keys(task.output.emitted_vars).length > 0 THEN
231:       lines.push('Emitted variables:')
232:       FOR [key, value] IN Object.entries(task.output.emitted_vars) DO
233:         lines.push(`  - ${key}: ${String(value).substring(0, 50)}...`)
234:       END FOR
235:     END IF
236:
237:     IF task.error THEN
238:       lines.push(`Error: ${task.error}`)
239:     END IF
240:
241:     RETURN lines.join('\n')
242:   }
243: }
```

## Anti-Pattern Warnings

```
ERROR: Line 135-139 - DO NOT skip exact match
  WHY: User might provide full ID, prefix match would waste cycles
  CORRECT: Try exact match first, then prefix

ERROR: Line 148-156 - MUST handle ambiguity gracefully
  WHY: Model needs to know which task to choose
  CORRECT: Return candidate list with enough info to distinguish

ERROR: Line 230-235 - DO NOT dump full output
  WHY: Output could be huge, context window waste
  CORRECT: Truncate values, show keys and preview
```
