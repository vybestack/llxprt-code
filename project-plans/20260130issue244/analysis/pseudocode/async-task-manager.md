# AsyncTaskManager Pseudocode

## Phase ID
`PLAN-20260130-ASYNCTASK.P02`

## Interface Contract

```
INPUTS:
  - maxAsyncTasks: number (from settings, default 5)
  
OUTPUTS:
  - Task registration, state transitions, queries
  - Events: task-completed, task-failed, task-cancelled
  
DEPENDENCIES:
  - EventEmitter from node:events
```

## Data Structures

```
001: TYPE AsyncTaskStatus = 'running' | 'completed' | 'failed' | 'cancelled'
002:
003: INTERFACE AsyncTaskInfo {
004:   id: string
005:   subagentName: string
006:   goalPrompt: string
007:   status: AsyncTaskStatus
008:   launchedAt: number
009:   completedAt?: number
010:   notifiedAt?: number
011:   output?: OutputObject
012:   error?: string
013:   abortController?: AbortController
014: }
015:
016: INTERFACE RegisterTaskInput {
017:   id: string
018:   subagentName: string
019:   goalPrompt: string
020:   abortController: AbortController
021: }
```

## Class Implementation

```
030: CLASS AsyncTaskManager {
031:   PRIVATE tasks: Map<string, AsyncTaskInfo>
032:   PRIVATE emitter: EventEmitter
033:   PRIVATE maxAsyncTasks: number
034:
035:   CONSTRUCTOR(maxAsyncTasks: number = 5) {
036:     this.tasks = new Map()
037:     this.emitter = new EventEmitter()
038:     this.maxAsyncTasks = maxAsyncTasks
039:   }
```

### setMaxAsyncTasks

```
045:   METHOD setMaxAsyncTasks(max: number): void {
046:     this.maxAsyncTasks = max
047:     this.enforceHistoryLimit()  // Re-check limit with new max
048:   }
049:
050:   METHOD getMaxAsyncTasks(): number {
051:     RETURN this.maxAsyncTasks
052:   }
```

### canLaunchAsync

```
058:   METHOD canLaunchAsync(): { allowed: boolean; reason?: string } {
059:     // Unlimited mode
060:     IF this.maxAsyncTasks === -1 THEN
061:       RETURN { allowed: true }
062:     END IF
063:
064:     // Count running tasks
065:     LET runningCount = 0
066:     FOR task IN this.tasks.values() DO
067:       IF task.status === 'running' THEN
068:         runningCount++
069:       END IF
070:     END FOR
071:
072:     // Check limit
073:     IF runningCount >= this.maxAsyncTasks THEN
074:       RETURN { allowed: false, reason: `Max async tasks (${this.maxAsyncTasks}) reached` }
075:     END IF
076:
077:     RETURN { allowed: true }
078:   }
```

### registerTask

```
084:   METHOD registerTask(input: RegisterTaskInput): AsyncTaskInfo {
085:     LET task: AsyncTaskInfo = {
086:       id: input.id,
087:       subagentName: input.subagentName,
088:       goalPrompt: input.goalPrompt,
089:       status: 'running',
090:       launchedAt: Date.now(),
091:       abortController: input.abortController
092:     }
093:
094:     this.tasks.set(input.id, task)
095:     // NOTE: No event for launch - only terminal states emit events
096:     RETURN task
097:   }
```

### completeTask

```
103:   METHOD completeTask(id: string, output: OutputObject): boolean {
104:     LET task = this.tasks.get(id)
105:
106:     // Task not found
107:     IF task === undefined THEN
108:       RETURN false
109:     END IF
110:
111:     // ERROR: Already in terminal state - idempotent, first wins
112:     // DO NOT throw, DO NOT change state
113:     IF task.status !== 'running' THEN
114:       RETURN false
115:     END IF
116:
117:     // Transition to completed
118:     task.status = 'completed'
119:     task.completedAt = Date.now()
120:     task.output = output
121:
122:     // Emit event AFTER state change
123:     this.emitter.emit('task-completed', task)
124:
125:     // Enforce history limit
126:     this.enforceHistoryLimit()
127:
128:     RETURN true
129:   }
```

### failTask

```
135:   METHOD failTask(id: string, error: string): boolean {
136:     LET task = this.tasks.get(id)
137:
138:     IF task === undefined THEN
139:       RETURN false
140:     END IF
141:
142:     // ERROR: Already in terminal state - idempotent
143:     IF task.status !== 'running' THEN
144:       RETURN false
145:     END IF
146:
147:     task.status = 'failed'
148:     task.completedAt = Date.now()
149:     task.error = error
150:
151:     this.emitter.emit('task-failed', task)
152:     this.enforceHistoryLimit()
153:
154:     RETURN true
155:   }
```

### cancelTask

```
161:   METHOD cancelTask(id: string): boolean {
162:     LET task = this.tasks.get(id)
163:
164:     IF task === undefined THEN
165:       RETURN false
166:     END IF
167:
168:     // ERROR: Already in terminal state - idempotent
169:     IF task.status !== 'running' THEN
170:       RETURN false
171:     END IF
172:
173:     task.status = 'cancelled'
174:     task.completedAt = Date.now()
175:
176:     // Abort the running subagent
177:     IF task.abortController THEN
178:       task.abortController.abort()
179:     END IF
180:
181:     this.emitter.emit('task-cancelled', task)
182:     this.enforceHistoryLimit()
183:
184:     RETURN true
185:   }
```

### Query Methods

```
191:   METHOD getTask(id: string): AsyncTaskInfo | undefined {
192:     RETURN this.tasks.get(id)
193:   }
194:
195:   METHOD getTaskByPrefix(prefix: string): { task?: AsyncTaskInfo; candidates?: AsyncTaskInfo[] } {
196:     LET matches: AsyncTaskInfo[] = []
197:
198:     FOR task IN this.tasks.values() DO
199:       IF task.id.startsWith(prefix) THEN
200:         matches.push(task)
201:       END IF
202:     END FOR
203:
204:     IF matches.length === 0 THEN
205:       RETURN {}
206:     END IF
207:
208:     IF matches.length === 1 THEN
209:       RETURN { task: matches[0] }
210:     END IF
211:
212:     RETURN { candidates: matches }
213:   }
214:
215:   METHOD getAllTasks(): AsyncTaskInfo[] {
216:     RETURN Array.from(this.tasks.values())
217:   }
218:
219:   METHOD getRunningTasks(): AsyncTaskInfo[] {
220:     RETURN this.getAllTasks().filter(t => t.status === 'running')
221:   }
222:
223:   METHOD getPendingNotifications(): AsyncTaskInfo[] {
224:     RETURN this.getAllTasks().filter(t =>
225:       (t.status === 'completed' OR t.status === 'failed') AND
226:       t.notifiedAt === undefined
227:     )
228:   }
```

### markNotified

```
234:   METHOD markNotified(id: string): void {
235:     LET task = this.tasks.get(id)
236:     IF task AND task.notifiedAt === undefined THEN
237:       task.notifiedAt = Date.now()
238:     END IF
239:   }
```

### enforceHistoryLimit

```
245:   PRIVATE METHOD enforceHistoryLimit(): void {
246:     // Calculate limit: 2*max or 10 if unlimited
247:     LET historyLimit = this.maxAsyncTasks === -1 ? 10 : this.maxAsyncTasks * 2
248:
249:     // Get terminal tasks sorted by completedAt (oldest first)
250:     LET terminalTasks = this.getAllTasks()
251:       .filter(t => t.status !== 'running')
252:       .sort((a, b) => (a.completedAt ?? 0) - (b.completedAt ?? 0))
253:
254:     // Remove oldest until under limit
255:     WHILE terminalTasks.length > historyLimit DO
256:       LET oldest = terminalTasks[0]
257:
258:       // ERROR: Never remove unnotified tasks - they need delivery
259:       // DO NOT remove tasks without notifiedAt set
260:       IF oldest.notifiedAt === undefined THEN
261:         BREAK  // Stop - can't remove unnotified
262:       END IF
263:
264:       this.tasks.delete(oldest.id)
265:       terminalTasks.shift()
266:     END WHILE
267:   }
```

### Event Subscriptions

```
273:   METHOD onTaskCompleted(handler: (task: AsyncTaskInfo) => void): () => void {
274:     this.emitter.on('task-completed', handler)
275:     RETURN () => this.emitter.off('task-completed', handler)
276:   }
277:
278:   METHOD onTaskFailed(handler: (task: AsyncTaskInfo) => void): () => void {
279:     this.emitter.on('task-failed', handler)
280:     RETURN () => this.emitter.off('task-failed', handler)
281:   }
282:
283:   METHOD onTaskCancelled(handler: (task: AsyncTaskInfo) => void): () => void {
284:     this.emitter.on('task-cancelled', handler)
285:     RETURN () => this.emitter.off('task-cancelled', handler)
286:   }
287: }
```

## Anti-Pattern Warnings

```
ERROR: Line 113-115 - DO NOT throw on repeat transition
  WHY: Subagent might complete while being cancelled - race condition
  CORRECT: Return false, keep original state

ERROR: Line 259-261 - DO NOT remove unnotified tasks
  WHY: Model would never receive completion notification
  CORRECT: Stop removal, let history grow temporarily

ERROR: Line 123 - DO NOT emit before state change
  WHY: Handler might query task and see old state
  CORRECT: Change state first, then emit
```
