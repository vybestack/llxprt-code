# Phase 02: Pseudocode Development

## Phase ID
`PLAN-20260130-ASYNCTASK.P02`

## Prerequisites
- Required: Phase 01a completed
- Verification: `ls project-plans/20260130issue244/.completed/P01a.md`
- Domain model reviewed and approved

## Purpose

Create detailed, numbered pseudocode for each component. Implementation phases MUST reference these line numbers.

## Deliverables

Create the following files in `project-plans/20260130issue244/analysis/pseudocode/`:

### 1. async-task-manager.md

```markdown
# AsyncTaskManager Pseudocode

## Interface Contracts

### INPUTS
```typescript
interface RegisterTaskInput {
  id: string;
  subagentName: string;
  goalPrompt: string;
  abortController: AbortController;
}

interface CompleteTaskInput {
  id: string;
  output: OutputObject;
}

interface FailTaskInput {
  id: string;
  error: string;
}
```

### OUTPUTS
```typescript
interface AsyncTaskInfo {
  id: string;
  subagentName: string;
  goalPrompt: string;
  status: AsyncTaskStatus;
  launchedAt: number;
  completedAt?: number;
  notifiedAt?: number;
  output?: OutputObject;
  error?: string;
}
```

### DEPENDENCIES (NEVER stubbed)
```typescript
interface Dependencies {
  eventEmitter: EventEmitter;  // For task lifecycle events
  maxAsyncTasks: number;       // From settings
}
```

## Pseudocode

10: CLASS AsyncTaskManager
11:   PRIVATE tasks: Map<string, AsyncTaskInfo>
12:   PRIVATE emitter: EventEmitter
13:   PRIVATE maxAsyncTasks: number
14:
15:   CONSTRUCTOR(maxAsyncTasks: number)
16:     SET this.tasks = new Map()
17:     SET this.emitter = new EventEmitter()
18:     SET this.maxAsyncTasks = maxAsyncTasks
19:
20:   METHOD setMaxAsyncTasks(max: number): void
21:     SET this.maxAsyncTasks = max
22:     CALL this.enforceHistoryLimit()
23:
24:   METHOD getMaxAsyncTasks(): number
25:     RETURN this.maxAsyncTasks
26:
27:   METHOD canLaunchAsync(): { allowed: boolean; reason?: string }
28:     IF this.maxAsyncTasks === -1
29:       RETURN { allowed: true }
30:     LET runningCount = COUNT tasks WHERE status === 'running'
31:     IF runningCount >= this.maxAsyncTasks
32:       RETURN { allowed: false, reason: `Max async tasks (${this.maxAsyncTasks}) reached` }
33:     RETURN { allowed: true }
34:
35:   METHOD registerTask(input: RegisterTaskInput): AsyncTaskInfo
36:     LET task = {
37:       id: input.id,
38:       subagentName: input.subagentName,
39:       goalPrompt: input.goalPrompt,
40:       status: 'running',
41:       launchedAt: Date.now(),
42:       abortController: input.abortController
43:     }
44:     SET this.tasks.set(input.id, task)
45:     EMIT 'task-launched' WITH task
46:     RETURN task
47:
48:   METHOD completeTask(id: string, output: OutputObject): boolean
49:     LET task = this.tasks.get(id)
50:     IF NOT task OR task.status !== 'running'
51:       RETURN false  // Idempotent: already terminal or not found
52:     SET task.status = 'completed'
53:     SET task.completedAt = Date.now()
54:     SET task.output = output
55:     EMIT 'task-completed' WITH task
56:     CALL this.enforceHistoryLimit()
57:     RETURN true
58:
59:   METHOD failTask(id: string, error: string): boolean
60:     LET task = this.tasks.get(id)
61:     IF NOT task OR task.status !== 'running'
62:       RETURN false  // Idempotent
63:     SET task.status = 'failed'
64:     SET task.completedAt = Date.now()
65:     SET task.error = error
66:     EMIT 'task-failed' WITH task
67:     CALL this.enforceHistoryLimit()
68:     RETURN true
69:
70:   METHOD cancelTask(id: string): boolean
71:     LET task = this.tasks.get(id)
72:     IF NOT task
73:       RETURN false  // Not found
74:     IF task.status !== 'running'
75:       RETURN false  // Idempotent: already terminal
76:     SET task.status = 'cancelled'
77:     SET task.completedAt = Date.now()
78:     IF task.abortController
79:       CALL task.abortController.abort()
80:     EMIT 'task-cancelled' WITH task
81:     CALL this.enforceHistoryLimit()
82:     RETURN true
83:
84:   METHOD getTask(id: string): AsyncTaskInfo | undefined
85:     RETURN this.tasks.get(id)
86:
87:   METHOD getTaskByPrefix(prefix: string): { task?: AsyncTaskInfo; candidates?: AsyncTaskInfo[] }
88:     LET matches = FILTER tasks WHERE id.startsWith(prefix)
89:     IF matches.length === 0
90:       RETURN {}
91:     IF matches.length === 1
92:       RETURN { task: matches[0] }
93:     RETURN { candidates: matches }
94:
95:   METHOD getAllTasks(): AsyncTaskInfo[]
96:     RETURN Array.from(this.tasks.values())
97:
98:   METHOD getRunningTasks(): AsyncTaskInfo[]
99:     RETURN FILTER tasks WHERE status === 'running'
100:
101:  METHOD getPendingNotifications(): AsyncTaskInfo[]
102:    RETURN FILTER tasks WHERE
103:      (status === 'completed' OR status === 'failed')
104:      AND notifiedAt === undefined
105:
106:  METHOD markNotified(id: string): void
107:    LET task = this.tasks.get(id)
108:    IF task AND NOT task.notifiedAt
109:      SET task.notifiedAt = Date.now()
110:
111:  METHOD enforceHistoryLimit(): void
112:    LET historyLimit = this.maxAsyncTasks === -1 ? 10 : this.maxAsyncTasks * 2
113:    LET terminalTasks = FILTER tasks WHERE status !== 'running'
114:    SORT terminalTasks BY completedAt ASC
115:    WHILE terminalTasks.length > historyLimit
116:      LET oldest = terminalTasks.shift()
117:      IF oldest.notifiedAt !== undefined  // Only remove if already notified
118:        DELETE this.tasks.delete(oldest.id)
119:
120:  METHOD onTaskCompleted(handler: (task: AsyncTaskInfo) => void): () => void
121:    CALL this.emitter.on('task-completed', handler)
122:    RETURN () => this.emitter.off('task-completed', handler)
123:
124:  METHOD onTaskFailed(handler: (task: AsyncTaskInfo) => void): () => void
125:    CALL this.emitter.on('task-failed', handler)
126:    RETURN () => this.emitter.off('task-failed', handler)
127:
128:  METHOD onTaskCancelled(handler: (task: AsyncTaskInfo) => void): () => void
129:    CALL this.emitter.on('task-cancelled', handler)
130:    RETURN () => this.emitter.off('task-cancelled', handler)

## Anti-Pattern Warnings

[ERROR] DO NOT: return {} when task not found in completeTask
[OK] DO: return false to indicate no transition happened

[ERROR] DO NOT: delete task immediately on completion
[OK] DO: keep in history until limit exceeded AND notified

[ERROR] DO NOT: allow multiple terminal transitions
[OK] DO: check status === 'running' before any terminal transition
```

### 2. async-task-reminder-service.md

[Similar structure with numbered lines for reminder generation]

### 3. task-tool-async.md

[Similar structure with numbered lines for async execution branch]

### 4. check-async-tasks-tool.md

[Similar structure with numbered lines for list/peek modes]

### 5. slash-commands.md

[Similar structure with numbered lines for /tasks and /task end]

### 6. auto-trigger.md

[Similar structure with numbered lines for completion auto-trigger]

## Verification Commands

```bash
# Check all pseudocode files created
ls project-plans/20260130issue244/analysis/pseudocode/

# Check line numbers present
grep -c "^[0-9]" project-plans/20260130issue244/analysis/pseudocode/*.md

# Check interface contracts present
grep -c "interface\|INPUTS\|OUTPUTS\|DEPENDENCIES" project-plans/20260130issue244/analysis/pseudocode/*.md

# Check anti-pattern warnings present
grep -c "ERROR.*DO NOT\|OK.*DO:" project-plans/20260130issue244/analysis/pseudocode/*.md
```

## Success Criteria

- [ ] All 6 pseudocode files created
- [ ] Every line is numbered
- [ ] Interface contracts defined (INPUTS, OUTPUTS, DEPENDENCIES)
- [ ] Anti-pattern warnings included
- [ ] No actual TypeScript implementation (pseudocode only)
- [ ] Clear algorithmic steps

## Phase Completion Marker

Create: `project-plans/20260130issue244/.completed/P02.md`
