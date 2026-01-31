# Phase 12: Check Async Tasks Tool - Stub

## Phase ID
`PLAN-20260130-ASYNCTASK.P12`

## Prerequisites
- Required: Phase 11a completed
- Pseudocode: `analysis/pseudocode/check-async-tasks-tool.md`

## Requirements Implemented

### REQ-ASYNC-007: Check Async Tasks Tool
**Full Text**: The model MUST have a tool to query the status of async tasks.
**Behavior**:
- GIVEN: Model wants to check async task status
- WHEN: check_async_tasks tool called
- THEN: Returns list of tasks with id, name, status, output (if complete)
**Why This Matters**: Model can poll for results instead of only receiving push notifications.

## Implementation Tasks

### Files to Create

- `packages/core/src/tools/check-async-tasks.ts`
  - MUST include: `@plan PLAN-20260130-ASYNCTASK.P12`
  - MUST include: `@requirement REQ-ASYNC-007`
  - Stub implementation

- `packages/core/src/tools/check-async-tasks.test.ts`
  - MUST include: `@plan PLAN-20260130-ASYNCTASK.P12`
  - Empty describe block

### Required Code Structure

```typescript
/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan PLAN-20260130-ASYNCTASK.P12
 * @requirement REQ-ASYNC-007
 */

import {
  BaseDeclarativeTool,
  BaseToolInvocation,
  Kind,
  type ToolResult,
} from './tools.js';
import type { AsyncTaskManager, AsyncTaskInfo } from '../services/asyncTaskManager.js';

export interface CheckAsyncTasksParams {
  task_id?: string;  // Optional: specific task ID or prefix to check
}

export interface CheckAsyncTasksToolDependencies {
  getAsyncTaskManager?: () => AsyncTaskManager | undefined;
}

class CheckAsyncTasksToolInvocation extends BaseToolInvocation<
  CheckAsyncTasksParams,
  ToolResult
> {
  constructor(
    params: CheckAsyncTasksParams,
    private readonly taskManager: AsyncTaskManager,
  ) {
    super(params);
  }

  override getDescription(): string {
    return this.params.task_id
      ? `Check status of async task: ${this.params.task_id}`
      : 'List all async tasks';
  }

  override async execute(): Promise<ToolResult> {
    throw new Error('NotYetImplemented');
  }
}

export class CheckAsyncTasksTool extends BaseDeclarativeTool<
  CheckAsyncTasksParams,
  ToolResult,
  CheckAsyncTasksToolDependencies
> {
  static readonly Name = 'check_async_tasks';

  constructor(deps: CheckAsyncTasksToolDependencies) {
    super(
      CheckAsyncTasksTool.Name,
      'Check Async Tasks',
      'Checks the status of background async tasks. Call with no arguments to list all tasks, or provide task_id (or prefix) to get details of a specific task.',
      Kind.Think,
      {
        type: 'object',
        additionalProperties: false,
        properties: {
          task_id: {
            type: 'string',
            description: 'Optional task ID or unique prefix to check. If omitted, lists all async tasks.',
          },
        },
      },
      deps,
    );
  }

  override createInvocation(
    params: CheckAsyncTasksParams,
  ): BaseToolInvocation<CheckAsyncTasksParams, ToolResult> {
    const taskManager = this.deps.getAsyncTaskManager?.();
    if (!taskManager) {
      throw new Error('AsyncTaskManager not available');
    }
    return new CheckAsyncTasksToolInvocation(params, taskManager);
  }
}
```

### Files to Modify

- `packages/core/src/tools/index.ts` or tool registration file
  - ADD export for CheckAsyncTasksTool

## Verification Commands

```bash
# Check files created
ls -la packages/core/src/tools/check-async-tasks.ts
ls -la packages/core/src/tools/check-async-tasks.test.ts

# Check plan markers
grep -n "@plan PLAN-20260130-ASYNCTASK.P12" packages/core/src/tools/check-async-tasks.ts

# Check requirement markers
grep -n "@requirement REQ-ASYNC-007" packages/core/src/tools/check-async-tasks.ts

# TypeScript compiles
npm run typecheck
```

## Success Criteria

- [ ] check-async-tasks.ts created with stub
- [ ] check-async-tasks.test.ts created
- [ ] TypeScript compiles
- [ ] Plan/requirement markers present

## Phase Completion Marker

Create: `project-plans/20260130issue244/.completed/P12.md`
