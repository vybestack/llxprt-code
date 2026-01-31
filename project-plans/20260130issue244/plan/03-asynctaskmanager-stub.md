# Phase 03: AsyncTaskManager Stub

## Phase ID
`PLAN-20260130-ASYNCTASK.P03`

## Prerequisites
- Required: Phase 02a completed
- Verification: `ls project-plans/20260130issue244/.completed/P02a.md`
- Pseudocode: `analysis/pseudocode/async-task-manager.md`

## Requirements Implemented

### REQ-ASYNC-001: AsyncTaskManager Service
**Full Text**: The system MUST provide an AsyncTaskManager service to track running, completed, failed, and cancelled async tasks.
**Behavior**:
- GIVEN: An async task is launched
- WHEN: The task is registered with AsyncTaskManager
- THEN: The task is tracked with id, subagentName, goalPrompt, status, timestamps
**Why This Matters**: Central tracking enables status queries, notifications, and cleanup.

### REQ-ASYNC-002: History Limits
**Full Text**: Completed task history MUST be limited to prevent unbounded memory growth.
**Behavior**:
- GIVEN: `task-max-async = 5`
- WHEN: 11th task completes
- THEN: Oldest completed task is removed (keep 2 * 5 = 10)
**Why This Matters**: Prevents memory leaks in long-running sessions.

## Implementation Tasks

### Files to Create

- `packages/core/src/services/asyncTaskManager.ts`
  - MUST include: `@plan PLAN-20260130-ASYNCTASK.P03`
  - MUST include: `@requirement REQ-ASYNC-001, REQ-ASYNC-002`
  - Stub implementation that compiles
  - All methods throw `new Error('NotYetImplemented')` OR return empty/default values

- `packages/core/src/services/asyncTaskManager.test.ts`
  - MUST include: `@plan PLAN-20260130-ASYNCTASK.P03`
  - Empty test file with describe block (tests added in P04)

### Files to Modify

- `packages/core/src/services/index.ts`
  - ADD export for AsyncTaskManager and AsyncTaskInfo

### Required Code Structure

```typescript
/**
 * @plan PLAN-20260130-ASYNCTASK.P03
 * @requirement REQ-ASYNC-001, REQ-ASYNC-002
 */

import { EventEmitter } from 'node:events';

export type AsyncTaskStatus = 'running' | 'completed' | 'failed' | 'cancelled';

export interface AsyncTaskInfo {
  id: string;
  subagentName: string;
  goalPrompt: string;
  status: AsyncTaskStatus;
  launchedAt: number;
  completedAt?: number;
  notifiedAt?: number;
  output?: /* OutputObject type */;
  error?: string;
}

export class AsyncTaskManager {
  private readonly tasks: Map<string, AsyncTaskInfo> = new Map();
  private readonly emitter: EventEmitter = new EventEmitter();
  private maxAsyncTasks: number;

  constructor(maxAsyncTasks: number = 5) {
    this.maxAsyncTasks = maxAsyncTasks;
  }

  // All methods: throw new Error('NotYetImplemented') OR return default values
  setMaxAsyncTasks(max: number): void { throw new Error('NotYetImplemented'); }
  getMaxAsyncTasks(): number { return this.maxAsyncTasks; }
  canLaunchAsync(): { allowed: boolean; reason?: string } { throw new Error('NotYetImplemented'); }
  registerTask(/* ... */): AsyncTaskInfo { throw new Error('NotYetImplemented'); }
  completeTask(id: string, output: any): boolean { throw new Error('NotYetImplemented'); }
  failTask(id: string, error: string): boolean { throw new Error('NotYetImplemented'); }
  cancelTask(id: string): boolean { throw new Error('NotYetImplemented'); }
  getTask(id: string): AsyncTaskInfo | undefined { return this.tasks.get(id); }
  getTaskByPrefix(prefix: string): { task?: AsyncTaskInfo; candidates?: AsyncTaskInfo[] } { throw new Error('NotYetImplemented'); }
  getAllTasks(): AsyncTaskInfo[] { return Array.from(this.tasks.values()); }
  getRunningTasks(): AsyncTaskInfo[] { throw new Error('NotYetImplemented'); }
  getPendingNotifications(): AsyncTaskInfo[] { throw new Error('NotYetImplemented'); }
  markNotified(id: string): void { throw new Error('NotYetImplemented'); }
  onTaskCompleted(handler: (task: AsyncTaskInfo) => void): () => void { throw new Error('NotYetImplemented'); }
  onTaskFailed(handler: (task: AsyncTaskInfo) => void): () => void { throw new Error('NotYetImplemented'); }
  onTaskCancelled(handler: (task: AsyncTaskInfo) => void): () => void { throw new Error('NotYetImplemented'); }
}
```

## Verification Commands

```bash
# Check file created
ls -la packages/core/src/services/asyncTaskManager.ts
ls -la packages/core/src/services/asyncTaskManager.test.ts

# Check plan markers
grep -n "@plan PLAN-20260130-ASYNCTASK.P03" packages/core/src/services/asyncTaskManager.ts

# Check requirement markers
grep -n "@requirement REQ-ASYNC-001" packages/core/src/services/asyncTaskManager.ts

# Check exports
grep -n "AsyncTaskManager\|AsyncTaskInfo" packages/core/src/services/index.ts

# TypeScript compiles
npm run typecheck

# Check no TODO (NotYetImplemented is OK in stubs)
grep -n "TODO\|FIXME" packages/core/src/services/asyncTaskManager.ts | grep -v test
# Expected: No matches
```

## Success Criteria

- [ ] asyncTaskManager.ts created with stub implementation
- [ ] asyncTaskManager.test.ts created with empty describe
- [ ] Exported from services/index.ts
- [ ] TypeScript compiles
- [ ] Plan and requirement markers present
- [ ] No TODO/FIXME markers

## Phase Completion Marker

Create: `project-plans/20260130issue244/.completed/P03.md`

Contents:
```markdown
Phase: P03
Completed: [timestamp]
Files Created:
- packages/core/src/services/asyncTaskManager.ts (stub)
- packages/core/src/services/asyncTaskManager.test.ts (empty)
Files Modified:
- packages/core/src/services/index.ts (export added)
TypeScript: Compiles
```
