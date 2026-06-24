<!-- @plan:PLAN-20260622-COREAPIGAP.P08 @requirement:REQ-003 -->
# Phase 08: Tasks Control (`agent.tasks`) — Implementation

## Phase ID

`PLAN-20260622-COREAPIGAP.P08`

## LLxprt Code Subagent: typescriptexpert

## Prerequisites

- Required: Phase 07 completed (PASS, suite RED)
- Verification: `test -f project-plans/issue2143/.completed/P07.md`
- Pseudocode: `analysis/pseudocode/tasks-control.md` (project 1-13; list 20-25; listRunning 30-35; get 40-47; cancel 50-55; cancelAllRunning 60-70)

## Requirements Implemented (Expanded)

### REQ-003 / .1-.7

Add `AgentTasksControl` + projected `AgentTaskInfo` to `agent.ts`, implement `TasksControl` in
`control/tasksControl.ts`, wire `readonly tasks` into `AgentImpl`. See Phase 07 GIVEN/WHEN/THEN.

## Implementation Tasks

### Files to Modify / Create

1. `packages/agents/src/api/agent.ts` — add the projected type + interface near the other control
   interfaces, and `readonly tasks: AgentTasksControl;` to the `Agent` controls block:

   ```typescript
   /**
    * Projected public view of an async task. OMITS abortController and any
    * non-serializable internal (REQ-003.7).
    * @plan:PLAN-20260622-COREAPIGAP.P08
    * @requirement:REQ-003
    */
   export interface AgentTaskInfo {
     readonly id: string;
     readonly subagentName: string;
     readonly goalPrompt: string;
     readonly status: 'running' | 'completed' | 'failed' | 'cancelled';
     readonly launchedAt: number;
     readonly completedAt?: number;
     readonly error?: string;
   }

   /**
    * Undefined-safe async-task administration (REQ-003).
    * @plan:PLAN-20260622-COREAPIGAP.P08
    * @requirement:REQ-003
    */
   export interface AgentTasksControl {
     list(): readonly AgentTaskInfo[];
     listRunning(): readonly AgentTaskInfo[];
     get(id: string): AgentTaskInfo | undefined;
     cancel(id: string): boolean;
     cancelAllRunning(): number;
   }
   ```

   Keep the `status` union identical to core `AsyncTaskStatus` (`asyncTaskManager.ts:16`).

2. `packages/agents/src/api/control/tasksControl.ts` — NEW. Follow the pseudocode EXACTLY. The
   `project()` helper copies fields BY NAME (never spreads — that would copy `abortController`):

   ```typescript
   /**
    * @plan:PLAN-20260622-COREAPIGAP.P08
    * @requirement:REQ-003
    */
   import type { AgentTasksControl, AgentTaskInfo } from '../agent.js';
   import type { AsyncTaskManager, AsyncTaskInfo } from '@vybestack/llxprt-code-core';

   export interface TasksControlDeps {
     readonly getManager: () => AsyncTaskManager | undefined;
   }

   export class TasksControl implements AgentTasksControl {
     constructor(private readonly deps: TasksControlDeps) {}

     /** @requirement:REQ-003 @pseudocode lines 1-13 */
     private project(task: AsyncTaskInfo): AgentTaskInfo {
       return {
         id: task.id,
         subagentName: task.subagentName,
         goalPrompt: task.goalPrompt,
         status: task.status,
         launchedAt: task.launchedAt,
         ...(task.completedAt !== undefined ? { completedAt: task.completedAt } : {}),
         ...(task.error !== undefined ? { error: task.error } : {}),
       };
     }

     /** @requirement:REQ-003 @pseudocode lines 20-25 */
     list(): readonly AgentTaskInfo[] {
       const mgr = this.deps.getManager();
       if (mgr === undefined) return [];
       return mgr.getAllTasks().map((t) => this.project(t));
     }

     /** @requirement:REQ-003 @pseudocode lines 30-35 */
     listRunning(): readonly AgentTaskInfo[] {
       const mgr = this.deps.getManager();
       if (mgr === undefined) return [];
       return mgr.getRunningTasks().map((t) => this.project(t));
     }

     /** @requirement:REQ-003 @pseudocode lines 40-47 */
     get(id: string): AgentTaskInfo | undefined {
       const mgr = this.deps.getManager();
       if (mgr === undefined) return undefined;
       const task = mgr.getTask(id);
       if (task === undefined) return undefined;
       return this.project(task);
     }

     /** @requirement:REQ-003 @pseudocode lines 50-55 */
     cancel(id: string): boolean {
       const mgr = this.deps.getManager();
       if (mgr === undefined) return false;
       return mgr.cancelTask(id);
     }

     /** @requirement:REQ-003 @pseudocode lines 60-70 */
     cancelAllRunning(): number {
       const mgr = this.deps.getManager();
       if (mgr === undefined) return 0;
       const running = mgr.getRunningTasks();
       let count = 0;
       for (const task of running) {
         if (mgr.cancelTask(task.id)) count++;
       }
       return count;
     }
   }
   ```

3. `packages/agents/src/api/agentImpl.ts`:
   - Add `readonly tasks: TasksControl;` near the controls field block (`:194-200`).
   - In the ctor controls block (`:328-332`), add `this.tasks = this.buildTasksControl();`.
   - Add the builder near the other `build*Control()` methods:

     ```typescript
     /**
      * @plan:PLAN-20260622-COREAPIGAP.P08
      * @requirement:REQ-003
      */
     private buildTasksControl(): TasksControl {
       const tasksDeps: TasksControlDeps = {
         getManager: () => this.deps.config.getAsyncTaskManager(),
       };
       return new TasksControl(tasksDeps);
     }
     ```
   - Import `TasksControl` + `TasksControlDeps` from `./control/tasksControl.js`.

### Constraints

- Follow pseudocode line-by-line; cite `@pseudocode` markers as shown.
- `project()` copies fields BY NAME — NEVER `{ ...task }` (R-NO-ABORTCONTROLLER).
- Every method undefined-safe (`[]`/`undefined`/`false`/`0`); never throw on absent manager.
- `cancelAllRunning()` snapshots `getRunningTasks()` FIRST, returns the integer count.
- Resolve `getManager()` per call; no cache. Do NOT add `getByPrefix` to the public API.
- Do NOT modify Phase 07 tests.

## Verification Commands

```bash
set -o pipefail
set -e
npx vitest run packages/agents/src/api/__tests__/tasksControl.behavior.test.ts
npm run typecheck

T=packages/agents/src/api/control/tasksControl.ts
test -f "$T"

# project() must NOT spread the task (would leak abortController) (BLOCKING).
if grep -nE "\.\.\.task\b|\{\s*\.\.\.t\s*\}" "$T"; then echo "FAIL: project spreads task (abortController leak)"; exit 1; fi
# abortController must never be referenced as a copied field.
if grep -nE "abortController" "$T"; then echo "FAIL: abortController referenced in projection"; exit 1; fi

# Undefined-safe guards present for all five methods (BLOCKING).
for M in "getAllTasks" "getRunningTasks" "getTask" "cancelTask"; do
  grep -qE "$M" "$T" || { echo "FAIL: missing delegate $M"; exit 1; }
done
grep -qE "if \(mgr === undefined\) return \[\];" "$T" || { echo "FAIL: missing []-guard"; exit 1; }
grep -qE "return 0;" "$T" || { echo "FAIL: cancelAllRunning 0-guard missing"; exit 1; }

# cancelAllRunning snapshots before iterating (BLOCKING).
grep -qE "const running = mgr\.getRunningTasks\(\);" "$T" || { echo "FAIL: no running snapshot"; exit 1; }

# Wiring present (BLOCKING).
grep -qE "this\.tasks = this\.buildTasksControl\(\)" packages/agents/src/api/agentImpl.ts || { echo "FAIL: tasks not wired"; exit 1; }
grep -qE "readonly tasks: TasksControl;" packages/agents/src/api/agentImpl.ts || { echo "FAIL: tasks field missing"; exit 1; }
grep -qE "readonly tasks: AgentTasksControl;" packages/agents/src/api/agent.ts || { echo "FAIL: Agent.tasks interface field missing"; exit 1; }

# Pseudocode markers.
grep -q "@pseudocode lines 1-13" "$T" || { echo "FAIL: project pseudocode marker missing"; exit 1; }
grep -q "@pseudocode lines 60-70" "$T" || { echo "FAIL: cancelAllRunning pseudocode marker missing"; exit 1; }
```

### Deferred Implementation Detection (MANDATORY — scoped to CHANGED + NEW files, MIN-3)

```bash
set -o pipefail
NEW=packages/agents/src/api/control/tasksControl.ts
if grep -nE "(TODO|FIXME|HACK|STUB|XXX|placeholder|for now|in a real)" "$NEW"; then echo "FAIL: deferred marker in new control"; exit 1; fi
for FILE in packages/agents/src/api/agentImpl.ts packages/agents/src/api/agent.ts; do
  if git diff HEAD -- "$FILE" | grep -E "^\+" | grep -vE "^\+\+\+" | grep -nE "(TODO|FIXME|HACK|STUB|placeholder|for now|in a real)"; then
    echo "FAIL: deferred marker in changed lines of $FILE"; exit 1
  fi
done
echo "PASS: no deferred markers."
```

### Semantic Verification Checklist

- [ ] Phase 07 tests pass (T7/T8/T9/T10 + both PROPs).
- [ ] `project()` copies by name; no spread; `abortController` never present on output.
- [ ] All methods undefined-safe; `cancelAllRunning` snapshots + returns count.
- [ ] Wired via `buildTasksControl`; delegates per call; pseudocode cited; typecheck clean.

## Success Criteria

- Tasks tests green; projection strips internals; undefined-safety holds; wiring in place.

## Failure Recovery

- `git checkout -- packages/agents/src/api/agentImpl.ts packages/agents/src/api/agent.ts` and
  `rm packages/agents/src/api/control/tasksControl.ts`; re-implement from pseudocode.

## Phase Completion Marker

Create: `project-plans/issue2143/.completed/P08.md`

```markdown
Phase: P08
Completed: YYYY-MM-DD HH:MM
Files Created: [list each new file with its line count]
Files Modified: [list each changed file with diff stats]
Tests Added: [count]
Verification: [paste the actual output of THIS phase's verification commands]
Semantic Assessment: [one-line holistic assessment]
```
