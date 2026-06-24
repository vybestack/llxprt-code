<!-- @plan:PLAN-20260622-COREAPIGAP.P07 @requirement:REQ-003 -->
# Phase 07: Tasks Control (`agent.tasks`) — Behavioral TDD

## Phase ID

`PLAN-20260622-COREAPIGAP.P07`

## LLxprt Code Subagent: typescriptexpert

## Prerequisites

- Required: Phase 06a completed (PASS)
- Verification: `test -f project-plans/issue2143/.completed/P06a.md`

## Requirements Implemented (Expanded)

### REQ-003: Async-task administration via `agent.tasks`

**Full Text**: `Agent` MUST expose an undefined-safe `tasks` sub-controller (`AgentTasksControl`):
`list()`, `listRunning()`, `get(id)`, `cancel(id)`, `cancelAllRunning()`, each delegating to the live
`Config.getAsyncTaskManager()` (`config.ts:601`, typed `AsyncTaskManager | undefined`).
- **REQ-003.1-.4**: `list`/`listRunning`/`get`/`cancel` mirror manager `getAllTasks`/`getRunningTasks`/
  `getTask`/`cancelTask` (`asyncTaskManager.ts:77/319/273/239`).
- **REQ-003.5**: `cancelAllRunning(): number` returns the COUNT cancelled (R-CANCEL-COUNT).
- **REQ-003.6**: every method is undefined-safe (manager absent → `[]`/`undefined`/`false`/`0`)
  (R-UNDEFINED-SAFE).
- **REQ-003.7**: the public `AgentTaskInfo` OMITS `abortController` and any non-serializable internal
  (R-NO-ABORTCONTROLLER).

**Behavior (GIVEN/WHEN/THEN)**:
- GIVEN a real manager with 2 running + 1 completed task → `list()` length 3, `listRunning()` length 2.
- GIVEN those running tasks → `cancelAllRunning()` returns `2`; afterwards `listRunning()` is `[]`.
- GIVEN any task view from `list()` → it has NO `abortController` key.
- GIVEN a manager that is `undefined` → all methods no-op (`[]`/`undefined`/`false`/`0`), never throw.

## Implementation Tasks

### Files to Create

- `packages/agents/src/api/__tests__/tasksControl.behavior.test.ts`

  Two REAL drive modes (BOTH are real data, NO mock theater):

  1. **Public-harness mode (T7/T8/T10)** — `buildAgent('plain-text.jsonl')` (`helpers/agentHarness.ts:79`).
     The concrete `Config.getAsyncTaskManager()` lazily creates and returns a REAL `AsyncTaskManager`
     (verified P00a: `getOrCreateAsyncTaskManager` always returns one). Obtain that SAME instance via
     the PUBLIC `agent.getConfig().getAsyncTaskManager()` (`agent.ts:339`) and SEED real running tasks:
     ```ts
     const mgr = agent.getConfig().getAsyncTaskManager()!;
     mgr.registerTask({ id, subagentName, goalPrompt, abortController: new AbortController() });
     ```
     `registerTask(RegisterTaskInput)` (`asyncTaskManager.ts:148`) marks the task running. Then assert
     through `agent.tasks.list()/listRunning()/get(id)/cancel(id)/cancelAllRunning()`. This is the SAME
     manager the control resolves (`buildTasksControl` closes over `this.deps.config.getAsyncTaskManager()`,
     and `getConfig()` returns that same `this.deps.config`), so the read-path is causally real.

  2. **Direct-construction mode (T9 undefined-safe)** — mirror the BLESSED precedent
     `new McpControl(deps)` (`mcp-discovery.spec.ts:306+`). `.behavior.test.ts` is T17-EXEMPT, so deep
     import is allowed: `import { TasksControl } from '../control/tasksControl.js';` then
     `new TasksControl({ getManager: () => undefined })`. The closure RETURNS a real value (`undefined`)
     — this is NOT a spy/stub. Assert every method no-ops.

  - Markers `@plan:PLAN-20260622-COREAPIGAP.P07`, `@requirement:REQ-003`.

### Required scenarios

```
T7    seed N running tasks on the real manager → agent.tasks.cancelAllRunning() === N AND a subsequent
      agent.tasks.listRunning() has length 0 (count + idempotent terminal state)
T8    seed 1 running task → const [info] = agent.tasks.list(); assert Object.keys(info) does NOT include
      'abortController' (and the running task DID carry one on the core manager) — projection strips it
T9    new TasksControl({ getManager: () => undefined }) → list()/listRunning() === [] ; get('x') ===
      undefined ; cancel('x') === false ; cancelAllRunning() === 0 ; NONE throw
T10   seed 2 running + complete 1 (registerTask then cancel/complete) → list() length reflects all;
      listRunning() reflects only running; get(knownId) returns the projected view with matching id;
      get('missing') === undefined ; cancel(knownId) === true ; cancel('missing') === false
PROP  projection fidelity: for a generated list of N (1..5) running tasks (random ids/goalPrompts),
      agent.tasks.list() length === N, the id set matches, and NO returned view has an 'abortController'
      key; MIN-2 cases
PROP  cancelAllRunning count: for a generated N (0..5) running tasks, cancelAllRunning() === N and
      listRunning() afterwards is empty; MIN-2 cases
```

### Constraints

- Assert real VALUES (counts, ids, key-absence, booleans) — NEVER `toHaveBeenCalled`, NEVER `vi.fn()`.
- The undefined-safe deps closure `() => undefined` is a REAL closure (allowed), not a mock.
- ≥30% property-based (fast-check), MIN-2 distinct property cases.
- Use `Object.keys(view)` (or `'abortController' in view`) to PROVE the projection omits the field —
  this is a behavioral assertion on real output, not structure-only theater (it is the REQ-003.7 contract).
- Positive cases fail at RED because `agent.tasks` / `TasksControl` do not exist yet (missing-property /
  missing-module → but NOTE: the direct-import T9 will be a `Cannot find module` until P08 creates the
  file; therefore author T9 in the SAME file but ensure at least the public-harness positives produce a
  behavioral RED. See RED note below.)

### RED note (important)

Because T9 deep-imports `../control/tasksControl.js` which does not exist until P08, the WHOLE file
would fail to resolve at RED (a `Cannot find module` — which the RED gate REJECTS as non-behavioral).
To keep RED behavioral, in THIS phase author T9 against the PUBLIC agent surface too: drive the
undefined-safe branch by constructing a second agent and asserting the public `agent.tasks` methods are
undefined-safe is NOT possible (real mgr is always defined). Therefore:
- Author T9's direct-construction `import` as a **dynamic import inside the test body**
  (`const { TasksControl } = await import('../control/tasksControl.js');`) so the file still PARSES and
  the public-harness positives (T7/T8/T10) drive a behavioral RED (missing `agent.tasks` → TypeError).
  The T9 dynamic import will throw `Cannot find module` at RED only INSIDE that one test — acceptable
  because the GATE inspects the whole-file run for a behavioral failure among the positives and only
  REJECTS if the ENTIRE failure set is module/compile errors. Confirm `/tmp/p07_red.log` shows the
  TypeError positives, not solely module errors.

## Verification Commands

```bash
set -o pipefail
set -e
F=packages/agents/src/api/__tests__/tasksControl.behavior.test.ts
test -f "$F"

if grep -nE "toHaveBeenCalled" "$F"; then echo "FAIL: mock theater"; exit 1; fi
if grep -nE "mockResolvedValue|mockReturnValue|vi\.spyOn|vi\.fn\(" "$F"; then echo "FAIL: mock theater (spy/stub)"; exit 1; fi
if grep -nE "not\.toThrow\(\)" "$F"; then echo "FAIL: reverse test"; exit 1; fi

# abortController omission asserted (BLOCKING — the REQ-003.7 contract).
grep -qE "abortController" "$F" || { echo "FAIL: abortController omission not asserted"; exit 1; }

# Property-based >= 30% (BLOCKING; MIN-2).
TOTAL=$(grep -cE "(^|[^A-Za-z0-9_])it\(|(^|[^A-Za-z0-9_])test\(|(^|[^A-Za-z0-9_])it\.prop\(|(^|[^A-Za-z0-9_])test\.prop\(" "$F" || true)
PROP_CASE_FORMS=$(grep -cE "(^|[^A-Za-z0-9_])it\.prop\(|(^|[^A-Za-z0-9_])test\.prop\(" "$F" || true)
CLASSIC_PROP_BLOCKS=$(awk '
  /(^|[^A-Za-z0-9_])it\(|(^|[^A-Za-z0-9_])test\(/ { blk++; counted[blk]=0 }
  /fc\.assert|fc\.property/ { if (blk>0 && counted[blk]==0) { counted[blk]=1; n++ } }
  END { print n+0 }' "$F")
PROP=$(( PROP_CASE_FORMS + CLASSIC_PROP_BLOCKS ))
if [ "$TOTAL" -eq 0 ]; then echo "FAIL: no tests"; exit 1; fi
PCT=$(( PROP * 100 / TOTAL ))
echo "property CASES: $PROP / $TOTAL = ${PCT}%"
if [ "$PROP" -lt 2 ]; then echo "FAIL: <2 property cases"; exit 1; fi
if [ "$PCT" -lt 30 ]; then echo "FAIL: property ${PCT}% < 30%"; exit 1; fi

# RED-state enforcement (positives must be behavioral, not solely module errors).
set +e
npx vitest run "$F" > /tmp/p07_red.log 2>&1
STATUS=$?
set -e
tail -40 /tmp/p07_red.log
if [ "$STATUS" -eq 0 ]; then echo "FAIL: unexpectedly all-green before P08"; exit 1; fi
# There MUST be at least one behavioral failure (TypeError / assertion) among the positives,
# not ONLY module-resolution errors.
if ! grep -qiE "TypeError|AssertionError|expected|is not a function|Cannot read" /tmp/p07_red.log; then
  echo "FAIL: RED shows no behavioral failure (only module/compile?)"; exit 1
fi
echo "RED confirmed behavioral (expected until P08)."
```

### Semantic Verification Checklist (BLOCKS progression)

- [ ] T7/T8/T10 drive the REAL lazily-created manager via the public `agent.getConfig().getAsyncTaskManager()`
      seam + `registerTask`; reads go through `agent.tasks`.
- [ ] T9 uses direct `new TasksControl({ getManager: () => undefined })` (real closure) for the
      undefined-safe branch.
- [ ] `abortController` omission proven via key inspection on real output.
- [ ] ≥30% property; MIN-2; no mock theater; no reverse tests; behavioral RED.

## Success Criteria

- Behavioral RED suite covering count/undefined-safety/projection through real data paths.

## Failure Recovery

- `git checkout -- "$F"`; rewrite.

## Deferred Implementation Detection (MANDATORY — scoped)

```bash
set -o pipefail
set -e
F=packages/agents/src/api/__tests__/tasksControl.behavior.test.ts
test -f "$F" || { echo "missing test"; exit 1; }
if grep -nE "(TODO|FIXME|HACK|XXX|TEMPORARY|WIP|placeholder|for now|in a real|coming soon)" "$F"; then echo "FAIL: deferred marker"; exit 1; fi
if grep -niE "toThrow\(.*NotYetImplemented|should (not )?be implemented" "$F"; then echo "FAIL: reverse pattern"; exit 1; fi
if grep -nE "\b(it|test|describe)\.skip\b|\bxit\b|\bxdescribe\b" "$F"; then echo "FAIL: skipped test"; exit 1; fi
echo "PASS: no deferred markers."
```

## Phase Completion Marker

Create: `project-plans/issue2143/.completed/P07.md`

```markdown
Phase: P07
Completed: YYYY-MM-DD HH:MM
Files Created: [list each new file with its line count]
Files Modified: [list each changed file with diff stats]
Tests Added: [count]
Verification: [paste the actual output of THIS phase's verification commands]
Semantic Assessment: [one-line holistic assessment]
```
