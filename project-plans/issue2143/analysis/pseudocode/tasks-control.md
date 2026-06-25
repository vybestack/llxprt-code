<!-- @plan:PLAN-20260622-COREAPIGAP.P02 @requirement:REQ-003 -->
# Pseudocode: Tasks Control (`agent.tasks`)

Plan ID: PLAN-20260622-COREAPIGAP
Component: G3 — `AgentTasksControl` (new sub-controller, undefined-safe)
Source of truth: specification.md REQ-003; domain-model.md R-NO-ABORTCONTROLLER, R-CANCEL-COUNT,
R-UNDEFINED-SAFE.
Analysis only — NO implementation code is written in this document.

---

## Interface Contracts

```typescript
// Declared in packages/agents/src/api/agent.ts alongside the other controls (:223-321)
interface AgentTasksControl {
  list(): readonly AgentTaskInfo[];
  listRunning(): readonly AgentTaskInfo[];
  get(id: string): AgentTaskInfo | undefined;
  cancel(id: string): boolean;
  cancelAllRunning(): number;
}

// Added to the Agent interface: `readonly tasks: AgentTasksControl;`

// Projected public type — OMITS abortController (asyncTaskManager.ts:28) and any other
// non-serializable internal (REQ-003.7 / R-NO-ABORTCONTROLLER).
interface AgentTaskInfo {
  readonly id: string;
  readonly subagentName: string;
  readonly goalPrompt: string;
  readonly status: 'running' | 'completed' | 'failed' | 'cancelled';  // = core AsyncTaskStatus
  readonly launchedAt: number;
  readonly completedAt?: number;
  readonly error?: string;
}
```

### Dependencies (NEVER stubbed)

```typescript
// packages/agents/src/api/control/tasksControl.ts
export interface TasksControlDeps {
  // Resolves the live AsyncTaskManager from the bound Config PER CALL. MAY be undefined
  // (config.getAsyncTaskManager(): AsyncTaskManager | undefined — config.ts:601 / abstract
  // configBase.ts:33). The controller MUST be undefined-safe.
  readonly getManager: () => AsyncTaskManager | undefined;
}
// Wired by AgentImpl.buildTasksControl(): getManager: () => this.deps.config.getAsyncTaskManager()
```

`AsyncTaskManager` + `AsyncTaskInfo` (core) are re-exported through the core barrel
(`core/src/index.ts:58,59`). The projection maps the core `AsyncTaskInfo` (which carries
`abortController?` at `asyncTaskManager.ts:28`) to the public `AgentTaskInfo` (which does not).

---

## Numbered Pseudocode

### PRIVATE project(task): AgentTaskInfo  (the abortController-omitting projection)

```
1: // @pseudocode REQ-003.7 — explicit field copy; abortController is NEVER copied
2: METHOD project(task) RETURNS AgentTaskInfo
3:   RETURN {
4:     id: task.id,
5:     subagentName: task.subagentName,
6:     goalPrompt: task.goalPrompt,
7:     status: task.status,
8:     launchedAt: task.launchedAt,
9:     completedAt: task.completedAt,           // optional; copied only if present
10:    error: task.error,                        // optional; copied only if present
11:    // NOTE: task.abortController is DELIBERATELY NOT copied (R-NO-ABORTCONTROLLER)
12:  }
13: END METHOD
```

### METHOD list(): readonly AgentTaskInfo[]

```
20: // @pseudocode REQ-003.1 + REQ-003.6 (undefined-safe)
21: METHOD list() RETURNS readonly AgentTaskInfo[]
22:   SET mgr = this.deps.getManager()
23:   IF mgr IS undefined THEN RETURN []          // R-UNDEFINED-SAFE
24:   RETURN mgr.getAllTasks().map(t => this.project(t))   // asyncTaskManager.ts:77
25: END METHOD
```

### METHOD listRunning(): readonly AgentTaskInfo[]

```
30: // @pseudocode REQ-003.2 + REQ-003.6
31: METHOD listRunning() RETURNS readonly AgentTaskInfo[]
32:   SET mgr = this.deps.getManager()
33:   IF mgr IS undefined THEN RETURN []
34:   RETURN mgr.getRunningTasks().map(t => this.project(t))  // asyncTaskManager.ts:319
35: END METHOD
```

### METHOD get(id): AgentTaskInfo | undefined

```
40: // @pseudocode REQ-003.3 + REQ-003.6
41: METHOD get(id) RETURNS AgentTaskInfo | undefined
42:   SET mgr = this.deps.getManager()
43:   IF mgr IS undefined THEN RETURN undefined
44:   SET task = mgr.getTask(id)                  // asyncTaskManager.ts:273
45:   IF task IS undefined THEN RETURN undefined
46:   RETURN this.project(task)
47: END METHOD
```

### METHOD cancel(id): boolean

```
50: // @pseudocode REQ-003.4 + REQ-003.6
51: METHOD cancel(id) RETURNS boolean
52:   SET mgr = this.deps.getManager()
53:   IF mgr IS undefined THEN RETURN false       // R-UNDEFINED-SAFE
54:   RETURN mgr.cancelTask(id)                    // asyncTaskManager.ts:239 (idempotent boolean)
55: END METHOD
```

### METHOD cancelAllRunning(): number

```
60: // @pseudocode REQ-003.5 — returns COUNT cancelled (R-CANCEL-COUNT); core has no native variant
61: METHOD cancelAllRunning() RETURNS number
62:   SET mgr = this.deps.getManager()
63:   IF mgr IS undefined THEN RETURN 0
64:   SET running = mgr.getRunningTasks()          // snapshot BEFORE cancelling
65:   SET count = 0
66:   FOR EACH task IN running
67:     IF mgr.cancelTask(task.id) IS true THEN INCREMENT count
68:   END FOR
69:   RETURN count
70: END METHOD
```

---

## Integration Points (Line-by-Line, REAL symbols)

| Pseudocode line | Real symbol / call | File:line (verified) |
|---|---|---|
| 22/32/42/52/62 | `Config.getAsyncTaskManager(): AsyncTaskManager \| undefined` | `config.ts:601`; abstract `configBase.ts:33` |
| 24 | `AsyncTaskManager.getAllTasks(): AsyncTaskInfo[]` | `services/asyncTaskManager.ts:77` |
| 34/64 | `AsyncTaskManager.getRunningTasks(): AsyncTaskInfo[]` | `services/asyncTaskManager.ts:319` |
| 44 | `AsyncTaskManager.getTask(id): AsyncTaskInfo \| undefined` | `services/asyncTaskManager.ts:273` |
| 54/67 | `AsyncTaskManager.cancelTask(id): boolean` (idempotent) | `services/asyncTaskManager.ts:239` |
| 11 | core `AsyncTaskInfo.abortController?: AbortController` (OMITTED) | `services/asyncTaskManager.ts:28` |
| 7 | core `AsyncTaskStatus = 'running'\|'completed'\|'failed'\|'cancelled'` | `services/asyncTaskManager.ts:16` |
| n/a (wiring) | `buildTasksControl()` near other builders | `agentImpl.ts:431-510`; field near `:194-200`; ctor near `:328-332` |

CLI consumers this unblocks (#1595): `tasksCommand.ts` (`getAllTasks:80,117`, `getTask:189`,
`getTaskByPrefix:193` [prefix matched CLI-side over `list()`], `cancelTask:236`);
`useGeminiStreamOrchestration.ts` ESC-cancel (`getRunningTasks().forEach(cancelTask)` → `cancelAllRunning()`).

---

## Anti-Pattern Warnings

- [ERROR] DO NOT: return the core `AsyncTaskInfo` objects directly (leaks `abortController`).
  [OK] DO: map through `project()` which copies only the public fields (R-NO-ABORTCONTROLLER).
- [ERROR] DO NOT: spread `{ ...task }` in `project()` (that WOULD copy `abortController`).
  [OK] DO: copy fields EXPLICITLY by name.
- [ERROR] DO NOT: throw or return `null` when the manager is undefined.
  [OK] DO: return `[]` / `undefined` / `false` / `0` per REQ-003.6 (R-UNDEFINED-SAFE).
- [ERROR] DO NOT: make `cancelAllRunning()` return `void`.
  [OK] DO: return the integer count cancelled (R-CANCEL-COUNT).
- [ERROR] DO NOT: iterate the LIVE running list while cancelling (mutation-during-iteration hazard).
  [OK] DO: snapshot `getRunningTasks()` into `running` first, then cancel by id.
- [ERROR] DO NOT: add a `getByPrefix` to the public API.
  [OK] DO: leave prefix matching to the CLI over `list()` (REQ-003 note).

---

## Behavior Decision Table

| GIVEN manager state | Method | Result |
|---|---|---|
| undefined manager | `list()` / `listRunning()` | `[]` |
| undefined manager | `get(id)` | `undefined` |
| undefined manager | `cancel(id)` | `false` |
| undefined manager | `cancelAllRunning()` | `0` |
| 3 tasks (2 running, 1 completed) | `list()` | length 3, none has `abortController` key |
| same | `listRunning()` | length 2 |
| same | `cancelAllRunning()` | `2`; subsequent `listRunning()` → `[]` |
| task "known" exists | `get("known")` | projected view (no `abortController`) |
| no task "missing" | `get("missing")` | `undefined` |
| cancellable "known" | `cancel("known")` | `true` |
| absent "missing" | `cancel("missing")` | `false` |
