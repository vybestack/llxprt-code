<!-- @plan:PLAN-20260622-COREAPIGAP.P08a @requirement:REQ-003 -->
# Phase 08a: Tasks Control Implementation Verification (Pseudocode-Compliance Gate)

## Phase ID

`PLAN-20260622-COREAPIGAP.P08a`

## LLxprt Code Subagent: architect

## Prerequisites

- Required: Phase 08 completed
- Verification: `test -f project-plans/issue2143/.completed/P08.md`

## Pseudocode-Compliance Verification (MANDATORY)

Compare `control/tasksControl.ts` against `analysis/pseudocode/tasks-control.md`. Re-audit the Phase 07
suite for behavioral discipline.

```bash
set -o pipefail
set -e
F=packages/agents/src/api/__tests__/tasksControl.behavior.test.ts
T=packages/agents/src/api/control/tasksControl.ts

npx vitest run "$F"
npx vitest run packages/agents/src/api/__tests__/
npm run typecheck
npm run lint

# Projection safety (BLOCKING).
if grep -nE "\.\.\.task\b" "$T"; then echo "FAIL: spread leaks abortController"; exit 1; fi
if grep -nE "abortController" "$T"; then echo "FAIL: abortController in control"; exit 1; fi

# Undefined-safety (BLOCKING).
grep -qE "if \(mgr === undefined\) return \[\];" "$T" || { echo "FAIL: []-guard"; exit 1; }
grep -qE "return false;" "$T" || { echo "FAIL: cancel false-guard"; exit 1; }
grep -qE "return 0;" "$T" || { echo "FAIL: cancelAllRunning 0-guard"; exit 1; }
grep -qE "const running = mgr\.getRunningTasks\(\);" "$T" || { echo "FAIL: snapshot-before-iterate"; exit 1; }

# No cache (BLOCKING).
if grep -nE "this\.(manager|_manager|tasks|_tasks)[[:space:]]*=" "$T"; then echo "FAIL: cached manager/tasks"; exit 1; fi

# Re-audit test discipline (BLOCKING).
if grep -nE "toHaveBeenCalled|mockResolvedValue|mockReturnValue|vi\.spyOn|vi\.fn\(" "$F"; then echo "FAIL: mock theater in test"; exit 1; fi
if grep -nE "not\.toThrow\(\)" "$F"; then echo "FAIL: reverse test"; exit 1; fi
grep -qE "abortController" "$F" || { echo "FAIL: omission not asserted in test"; exit 1; }
# T9 direct-construction precedent present (real closure, undefined manager).
grep -qE "new TasksControl\(" "$F" || { echo "FAIL: undefined-safe direct construction missing"; exit 1; }

# Deferred scan (NEW + changed).
if grep -nE "(TODO|FIXME|HACK|STUB|XXX|placeholder|for now|in a real)" "$T"; then echo "FAIL: deferred in control"; exit 1; fi
for FILE in packages/agents/src/api/agentImpl.ts packages/agents/src/api/agent.ts; do
  if git diff HEAD -- "$FILE" | grep -E "^\+" | grep -vE "^\+\+\+" | grep -nE "(TODO|FIXME|HACK|STUB|placeholder|for now|in a real)"; then echo "FAIL: deferred in $FILE"; exit 1; fi
done
echo "PASS: pseudocode-compliance + discipline."
```

### Line-by-Line Compliance Table

| Pseudocode lines | Implemented at | Matches? |
|---|---|---|
| 1-13 project (by-name copy, abortController omitted) | | [ ] |
| 20-25 list (undefined→[], map project) | | [ ] |
| 30-35 listRunning | | [ ] |
| 40-47 get (undefined→undefined, miss→undefined) | | [ ] |
| 50-55 cancel (undefined→false) | | [ ] |
| 60-70 cancelAllRunning (snapshot, count) | | [ ] |

### Semantic Verification Checklist

- [ ] Decision table holds (undefined→[]/undefined/false/0; 3 tasks→list 3/running 2; cancelAllRunning N then running empty; get hit/miss; cancel hit/miss).
- [ ] `AgentTaskInfo` never carries `abortController` on REAL output (R-NO-ABORTCONTROLLER).
- [ ] `cancelAllRunning` returns the integer count (R-CANCEL-COUNT); snapshots before iterating.
- [ ] Delegates per call (no cache); test behavioral + ≥30% property; lint/typecheck/full-api-suite green.

## Holistic Functionality Assessment (MANDATORY — into marker)

- **What was implemented?** (TasksControl + projection + interface + wiring)
- **Satisfies REQ-003/.1-.7?** (cite evidence — count, undefined-safety, projection key-absence)
- **Data flow** (agent.tasks → getManager() → Config.getAsyncTaskManager() → real manager; views projected)
- **Risks** (abortController leak via spread, mutation-during-iteration, manager caching, throw on undefined)
- **Verdict** (PASS/FAIL with evidence)

## Success Criteria

- Compliance table complete; assessment written; suites + lint + typecheck green.

## Failure Recovery

- Return to Phase 08 or 07; do not proceed to Phase 09.

## Phase Completion Marker

Create: `project-plans/issue2143/.completed/P08a.md` (include assessment).

```markdown
Phase: P08a
Completed: YYYY-MM-DD HH:MM
Files Created: [list each new file with its line count]
Files Modified: [list each changed file with diff stats]
Tests Added: [count]
Verification: [paste the actual output of THIS phase's verification commands]
Semantic Assessment: [one-line verdict — PASS/FAIL with the key evidence]
```
