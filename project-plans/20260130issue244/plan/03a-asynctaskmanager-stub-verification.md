# Phase 03a: AsyncTaskManager Stub Verification

## Phase ID
`PLAN-20260130-ASYNCTASK.P03a`

## Prerequisites
- Required: Phase 03 completed
- Expected: `packages/core/src/services/asyncTaskManager.ts` exists

## Structural Verification

```bash
# Check files exist
ls -la packages/core/src/services/asyncTaskManager.ts
# Expected: File exists

ls -la packages/core/src/services/asyncTaskManager.test.ts
# Expected: File exists

# Check plan markers
grep "@plan PLAN-20260130-ASYNCTASK.P03" packages/core/src/services/asyncTaskManager.ts
# Expected: At least 1 match

# Check requirement markers
grep "@requirement REQ-ASYNC-001\|@requirement REQ-ASYNC-002" packages/core/src/services/asyncTaskManager.ts
# Expected: At least 1 match

# Check exports
grep "AsyncTaskManager" packages/core/src/services/index.ts
# Expected: Export present

grep "AsyncTaskInfo" packages/core/src/services/index.ts
# Expected: Export present

# TypeScript compiles
npm run typecheck
# Expected: No errors

# No TODO/FIXME (NotYetImplemented is OK)
grep -n "TODO\|FIXME" packages/core/src/services/asyncTaskManager.ts | grep -v "test\|NotYetImplemented"
# Expected: No matches
```

## Semantic Verification Checklist

### Interface Correctness

1. **AsyncTaskStatus type defined?**
   - [ ] Type is: `'running' | 'completed' | 'failed' | 'cancelled'`
   - [ ] Exported from module

2. **AsyncTaskInfo interface complete?**
   - [ ] Has id: string
   - [ ] Has subagentName: string
   - [ ] Has goalPrompt: string
   - [ ] Has status: AsyncTaskStatus
   - [ ] Has launchedAt: number
   - [ ] Has completedAt?: number
   - [ ] Has notifiedAt?: number
   - [ ] Has output?: OutputObject (or appropriate type)
   - [ ] Has error?: string
   - [ ] Exported from module

3. **AsyncTaskManager class structure?**
   - [ ] Constructor takes maxAsyncTasks parameter
   - [ ] Has private tasks Map
   - [ ] Has private emitter EventEmitter
   - [ ] Has all methods from pseudocode (even if throwing NotYetImplemented)

### Method Signatures Correct?

- [ ] setMaxAsyncTasks(max: number): void
- [ ] getMaxAsyncTasks(): number
- [ ] canLaunchAsync(): { allowed: boolean; reason?: string }
- [ ] registerTask(...): AsyncTaskInfo
- [ ] completeTask(id: string, output: ...): boolean
- [ ] failTask(id: string, error: string): boolean
- [ ] cancelTask(id: string): boolean
- [ ] getTask(id: string): AsyncTaskInfo | undefined
- [ ] getTaskByPrefix(prefix: string): { task?: AsyncTaskInfo; candidates?: AsyncTaskInfo[] }
- [ ] getAllTasks(): AsyncTaskInfo[]
- [ ] getRunningTasks(): AsyncTaskInfo[]
- [ ] getPendingNotifications(): AsyncTaskInfo[]
- [ ] markNotified(id: string): void
- [ ] onTaskCompleted(handler): () => void
- [ ] onTaskFailed(handler): () => void
- [ ] onTaskCancelled(handler): () => void

### Export Verification

```bash
# Verify exports work
node -e "
const { AsyncTaskManager, AsyncTaskInfo } = require('./packages/core/dist/services/index.js');
console.log('AsyncTaskManager:', typeof AsyncTaskManager);
"
```

## Blocking Issues

If any check fails:
1. Document the issue
2. Return to Phase 03 to fix
3. Re-run verification

## Success Criteria

- [ ] All structural verification commands pass
- [ ] All semantic verification questions answered YES
- [ ] TypeScript compiles without errors
- [ ] Exports work correctly

## Phase Completion

Create: `project-plans/20260130issue244/.completed/P03a.md`

Contents:
```markdown
Phase: P03a
Completed: [timestamp]
Verification: All checks passed
Stub: Complete and compilable
Exports: Working
```
