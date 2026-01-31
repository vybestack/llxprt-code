# Async Subagent Execution with Notifications

## Issue Reference
- **Issue**: #244 - Background Subagent Execution
- **Milestone**: 0.9.0

## Problem Statement

Currently, when an agent uses the `task` tool to launch a subagent, execution **blocks** until the subagent completes. While multiple subagents can run in parallel if the model makes multiple tool calls in the same response (via `Promise.all()` in the executor), the foreground agent's turn is still blocked until **all** parallel subagents complete.

This design proposes adding an `async=true` parameter to the Task tool that allows subagents to run without blocking the foreground agent, with proper notifications when they complete.

## Design Goals

1. **Non-blocking execution**: Foreground agent continues immediately after launching async subagents
2. **Same UI treatment**: Async tasks display in the UI identically to sync tasks (no "background" appearance)
3. **Tool scheduler integration**: Async tasks still route through `CoreToolScheduler` for consistency
4. **Automatic notification**: System auto-triggers agent turn on completion (if model is idle)
5. **Status reminder on every turn**: Model sees async task status via system reminder (like todos)
6. **User control**: Slash commands `/tasks list` and `/task end <id>` for management
7. **Resource limits**: Configurable max concurrent async tasks via `/set task-max-async <num>`

## Key Insight: Leverage Existing Patterns

This design leverages **existing patterns** already proven in the codebase:

### 1. Todo Reminder Pattern
The `TodoReminderService` already injects system notes into model turns:
```
---
System Note: <message>
---
```
These are appended via `appendSystemReminderToRequest()` in `client.ts`. We use the **same pattern** for async task status.

### 2. Subagent Tool Scheduling Already Works
When a subagent runs (sync), its tool calls already:
- Route through `CoreToolScheduler`
- Display in the UI
- Handle confirmations via `MessageBus`
- Are **isolated from parent agent's history**

For async, **nothing changes** about how the subagent runs - we just don't await it.

### 3. Acknowledgement Pattern
Like todos, completed async tasks need to be "consumed" so they stop appearing in reminders. We mark tasks as `notified` once the model has seen the completion (either via auto-trigger or status reminder).

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                    Status Reminder (Every Turn)                     │
│  ---                                                                │
│  System Note: Async tasks status:                                   │
│  Running: [abc123] researcher, [def456] analyzer                    │
│  Completed (pending): [ghi789] codereviewer                         │
│  ---                                                                │
└─────────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌────────────────┐    ┌────────────────────┐    ┌─────────────────────┐
│   Task Tool    │───▶│ AsyncTaskManager   │───▶│  CoreToolScheduler  │
│  (async=true)  │    │  (tracks tasks)    │    │  (existing, works)  │
└────────────────┘    └────────────────────┘    └─────────────────────┘
                                │
                                ▼
                      ┌────────────────────┐
                      │ AsyncTaskReminder  │
                      │    Service         │
                      │ (like TodoReminder)│
                      └────────────────────┘
                                │
              ┌─────────────────┴─────────────────┐
              ▼                                   ▼
┌──────────────────────────┐      ┌──────────────────────────┐
│  On Every Turn:          │      │  On Completion (idle):   │
│  Inject status reminder  │      │  Auto-trigger turn with  │
│  via existing pattern    │      │  completion notification │
└──────────────────────────┘      └──────────────────────────┘
```

## Detailed Design

### 1. New MessageBus Types

Extend `packages/core/src/confirmation-bus/types.ts`:

```typescript
export enum MessageBusType {
  // ... existing types ...
  ASYNC_TASK_LAUNCHED = 'async-task-launched',
  ASYNC_TASK_COMPLETED = 'async-task-completed',
  ASYNC_TASK_FAILED = 'async-task-failed',
  ASYNC_TASK_CANCELLED = 'async-task-cancelled',
}

export interface AsyncTaskLaunched {
  type: MessageBusType.ASYNC_TASK_LAUNCHED;
  taskId: string;
  subagentName: string;
  goalPrompt: string;
  timestamp: number;
}

export interface AsyncTaskCompleted {
  type: MessageBusType.ASYNC_TASK_COMPLETED;
  taskId: string;
  subagentName: string;
  output: OutputObject;
  timestamp: number;
}

export interface AsyncTaskFailed {
  type: MessageBusType.ASYNC_TASK_FAILED;
  taskId: string;
  subagentName: string;
  error: string;
  timestamp: number;
}

export interface AsyncTaskCancelled {
  type: MessageBusType.ASYNC_TASK_CANCELLED;
  taskId: string;
  subagentName: string;
  timestamp: number;
}
```

### 2. AsyncTaskManager Service

New file: `packages/core/src/services/asyncTaskManager.ts`

```typescript
import { EventEmitter } from 'node:events';
import type { OutputObject } from '../core/subagent.js';
import type { SubAgentScope } from '../core/subagent.js';

export type AsyncTaskStatus = 'running' | 'completed' | 'failed' | 'cancelled';

export interface AsyncTaskInfo {
  id: string;
  subagentName: string;
  goalPrompt: string;
  status: AsyncTaskStatus;
  launchedAt: number;
  completedAt?: number;
  notifiedAt?: number;      // When model was notified of completion (for acknowledgement)
  output?: OutputObject;
  error?: string;
  scope?: SubAgentScope;    // Reference for cancellation and peeking at partial output
  abortController?: AbortController;
}

export class AsyncTaskManager {
  private tasks: Map<string, AsyncTaskInfo> = new Map();
  private emitter: EventEmitter = new EventEmitter();
  private maxAsyncTasks: number = 5;

  constructor(maxAsyncTasks: number = 5) {
    this.maxAsyncTasks = maxAsyncTasks;
    this.emitter.setMaxListeners(50);
  }

  setMaxAsyncTasks(max: number): void {
    this.maxAsyncTasks = max;
  }

  getMaxAsyncTasks(): number {
    return this.maxAsyncTasks;
  }

  canLaunchAsync(): boolean {
    if (this.maxAsyncTasks === -1) return true;
    const runningCount = this.getRunningTasks().length;
    return runningCount < this.maxAsyncTasks;
  }

  registerTask(
    id: string,
    subagentName: string,
    goalPrompt: string,
    scope?: SubAgentScope,
    abortController?: AbortController,
  ): void {
    this.tasks.set(id, {
      id,
      subagentName,
      goalPrompt,
      status: 'running',
      launchedAt: Date.now(),
      scope,
      abortController,
    });
    this.emitter.emit('task-launched', this.tasks.get(id));
  }

  completeTask(id: string, output: OutputObject): void {
    const task = this.tasks.get(id);
    if (task && task.status === 'running') {
      task.status = 'completed';
      task.completedAt = Date.now();
      task.output = output;
      // Keep scope for peek access, release abortController
      task.abortController = undefined;
      this.emitter.emit('task-completed', task);
      this.enforceHistoryLimit();
    }
  }

  failTask(id: string, error: string): void {
    const task = this.tasks.get(id);
    if (task && task.status === 'running') {
      task.status = 'failed';
      task.completedAt = Date.now();
      task.error = error;
      task.scope = undefined;
      task.abortController = undefined;
      this.emitter.emit('task-failed', task);
      this.enforceHistoryLimit();
    }
  }

  cancelTask(id: string): boolean {
    const task = this.tasks.get(id);
    if (!task || task.status !== 'running') {
      return false;
    }
    
    // Abort the task (idempotent - safe to call even if already aborted)
    if (!task.abortController?.signal.aborted) {
      task.abortController?.abort();
    }
    task.status = 'cancelled';
    task.completedAt = Date.now();
    task.scope = undefined;
    task.abortController = undefined;
    this.emitter.emit('task-cancelled', task);
    this.enforceHistoryLimit();
    return true;
  }

  /**
   * Mark task as notified (model has seen the completion).
   * Called after injecting completion into a turn.
   */
  markNotified(id: string): void {
    const task = this.tasks.get(id);
    if (task && !task.notifiedAt) {
      task.notifiedAt = Date.now();
      // Release scope reference after notification
      task.scope = undefined;
    }
  }

  /**
   * Check if a task has been notified to the model
   */
  isNotified(id: string): boolean {
    const task = this.tasks.get(id);
    return task?.notifiedAt !== undefined;
  }

  getTask(id: string): AsyncTaskInfo | undefined {
    return this.tasks.get(id);
  }

  getAllTasks(): AsyncTaskInfo[] {
    return Array.from(this.tasks.values());
  }

  getRunningTasks(): AsyncTaskInfo[] {
    return Array.from(this.tasks.values()).filter(t => t.status === 'running');
  }

  getCompletedTasks(): AsyncTaskInfo[] {
    return Array.from(this.tasks.values()).filter(
      t => t.status === 'completed' || t.status === 'failed' || t.status === 'cancelled'
    );
  }

  /**
   * Get tasks that completed but model hasn't been notified yet.
   * Used for injecting completion into next agent turn.
   */
  getPendingNotifications(): AsyncTaskInfo[] {
    return Array.from(this.tasks.values()).filter(
      t => (t.status === 'completed' || t.status === 'failed') && !t.notifiedAt
    );
  }

  /**
   * Get completed/failed/cancelled tasks (terminal states)
   */
  getTerminalTasks(): AsyncTaskInfo[] {
    return Array.from(this.tasks.values()).filter(t => t.status !== 'running');
  }

  /**
   * Enforce history limit on completed tasks.
   * Called after each task completion.
   * 
   * History limit:
   * - If maxAsyncTasks > 0: keep 2x maxAsyncTasks completed tasks
   * - If maxAsyncTasks == -1 (unlimited): keep max 10 completed tasks
   * 
   * When limit exceeded, oldest completed task is forgotten.
   */
  enforceHistoryLimit(): void {
    const historyLimit = this.maxAsyncTasks === -1 ? 10 : this.maxAsyncTasks * 2;
    
    const terminalTasks = this.getTerminalTasks()
      .sort((a, b) => (a.completedAt ?? 0) - (b.completedAt ?? 0)); // oldest first
    
    while (terminalTasks.length > historyLimit) {
      const oldest = terminalTasks.shift();
      if (oldest) {
        this.tasks.delete(oldest.id);
      }
    }
  }

  // Event subscriptions
  onTaskLaunched(handler: (task: AsyncTaskInfo) => void): () => void {
    this.emitter.on('task-launched', handler);
    return () => this.emitter.off('task-launched', handler);
  }

  onTaskCompleted(handler: (task: AsyncTaskInfo) => void): () => void {
    this.emitter.on('task-completed', handler);
    return () => this.emitter.off('task-completed', handler);
  }

  onTaskFailed(handler: (task: AsyncTaskInfo) => void): () => void {
    this.emitter.on('task-failed', handler);
    return () => this.emitter.off('task-failed', handler);
  }

  onTaskCancelled(handler: (task: AsyncTaskInfo) => void): () => void {
    this.emitter.on('task-cancelled', handler);
    return () => this.emitter.off('task-cancelled', handler);
  }

  /**
   * Generate status summary for system instruction injection
   */
  getStatusSummary(): string {
    const tasks = this.getAllTasks();
    if (tasks.length === 0) return '';

    const running = tasks.filter(t => t.status === 'running');
    const completed = tasks.filter(t => t.status === 'completed');
    const failed = tasks.filter(t => t.status === 'failed');

    const lines = [
      `\n[ASYNC TASKS: ${tasks.length} total - ${running.length} running, ${completed.length} completed, ${failed.length} failed]`,
    ];

    tasks.forEach((task, index) => {
    const statusIcon = {
        running: '[RUNNING]',
        completed: '[DONE]',
        failed: '[FAILED]',
        cancelled: '[CANCELLED]',
      }[task.status];
      
      lines.push(`[${index + 1}] ${task.subagentName} (${task.id.slice(0, 8)}) - ${statusIcon} ${task.status}`);
    });

    return lines.join('\n');
  }

  dispose(): void {
    // Cancel all running tasks
    for (const task of this.tasks.values()) {
      if (task.status === 'running') {
        task.abortController?.abort();
      }
    }
    this.tasks.clear();
    this.emitter.removeAllListeners();
  }
}
```

### 3. Task Tool Parameter Extension

Update `packages/core/src/tools/task.ts`:

```typescript
export interface TaskToolParams {
  // ... existing params ...
  async?: boolean;  // NEW: Launch in background without blocking
}

// In schema definition:
{
  async: {
    type: 'boolean',
    description: 'When true, launches the subagent asynchronously without blocking. ' +
      'The foreground agent continues immediately and receives a notification when the task completes. ' +
      'Use check_async_tasks tool to monitor status.',
  },
}
```

### 4. Task Tool Execution Modification

In `TaskToolInvocation.execute()`:

```typescript
override async execute(
  signal: AbortSignal,
  updateOutput?: (output: string) => void,
): Promise<ToolResult> {
  // ... existing timeout setup ...

  if (this.normalized.async) {
    return this.executeAsync(signal, updateOutput);
  }
  
  // ... existing sync execution ...
}

private async executeAsync(
  signal: AbortSignal,
  updateOutput?: (output: string) => void,
): Promise<ToolResult> {
  const asyncTaskManager = this.deps.getAsyncTaskManager?.();
  if (!asyncTaskManager) {
    return {
      llmContent: 'Async task execution is not available in this environment.',
      returnDisplay: '[ERROR] Async tasks not supported',
      error: { message: 'AsyncTaskManager not available', type: ToolErrorType.UNHANDLED_EXCEPTION },
    };
  }

  // Check resource limits
  if (!asyncTaskManager.canLaunchAsync()) {
    const max = asyncTaskManager.getMaxAsyncTasks();
    const running = asyncTaskManager.getRunningTasks().length;
    return {
      llmContent: `Cannot launch async task: maximum concurrent async tasks (${max}) reached. ` +
        `Currently ${running} tasks running. Wait for tasks to complete or use check_async_tasks to review.`,
      returnDisplay: `[ERROR] Max async tasks (${max}) reached - ${running} running`,
      error: { 
        message: `Max async tasks (${max}) reached`, 
        type: ToolErrorType.EXECUTION_FAILED 
      },
    };
  }

  // Create dedicated abort controller for this async task
  const asyncAbortController = new AbortController();
  
  // Wire up parent signal to abort async task if parent is cancelled
  const abortHandler = () => asyncAbortController.abort();
  signal.addEventListener('abort', abortHandler, { once: true });

  let orchestrator: SubagentOrchestrator;
  try {
    orchestrator = this.deps.createOrchestrator();
  } catch (error) {
    signal.removeEventListener('abort', abortHandler);
    return this.createErrorResult(error, 'Failed to create orchestrator for async task.');
  }

  const launchRequest = this.createLaunchRequest();
  let launchResult: SubagentLaunchResult;

  try {
    launchResult = await orchestrator.launch(launchRequest, asyncAbortController.signal);
  } catch (error) {
    signal.removeEventListener('abort', abortHandler);
    return this.createErrorResult(error, `Failed to launch async subagent '${this.normalized.subagentName}'.`);
  }

  const { scope, agentId } = launchResult;

  // Register with AsyncTaskManager
  asyncTaskManager.registerTask(
    agentId,
    this.normalized.subagentName,
    this.normalized.goalPrompt,
    scope,
    asyncAbortController,
  );

  // Publish launch notification via MessageBus
  const messageBus = this.deps.getMessageBus?.();
  messageBus?.publish({
    type: MessageBusType.ASYNC_TASK_LAUNCHED,
    taskId: agentId,
    subagentName: this.normalized.subagentName,
    goalPrompt: this.normalized.goalPrompt,
    timestamp: Date.now(),
  });

  // Execute in background (do NOT await)
  this.executeAsyncInBackground(
    scope,
    launchResult,
    agentId,
    asyncAbortController,
    asyncTaskManager,
    messageBus,
    updateOutput,
  );

  // Return immediately
  return {
    llmContent: `Async task '${this.normalized.subagentName}' launched with ID ${agentId}. ` +
      `The task is now running in the background. You will be notified when it completes. ` +
      `Use check_async_tasks to monitor progress.`,
    returnDisplay: ` Launched async task: **${this.normalized.subagentName}** (\`${agentId.slice(0, 8)}\`)`,
    metadata: {
      agentId,
      async: true,
      status: 'running',
    },
  };
}

private executeAsyncInBackground(
  scope: SubAgentScope,
  launchResult: SubagentLaunchResult,
  agentId: string,
  abortController: AbortController,
  asyncTaskManager: AsyncTaskManager,
  messageBus?: MessageBus,
  updateOutput?: (output: string) => void,
): void {
  const contextState = this.buildContextState();
  
  // Wire up output streaming (tasks still display in UI)
  if (updateOutput) {
    const existingHandler = scope.onMessage;
    scope.onMessage = (message: string) => {
      updateOutput(`[async:${agentId.slice(0, 8)}] ${message}`);
      existingHandler?.(message);
    };
  }

  // Run async (not awaited by caller)
  (async () => {
    try {
      const environmentInteractive = this.deps.isInteractiveEnvironment?.() ?? true;
      
      if (environmentInteractive && typeof scope.runInteractive === 'function') {
        const schedulerFactory = this.deps.getSchedulerFactory?.();
        const interactiveOptions = schedulerFactory ? { schedulerFactory } : undefined;
        await scope.runInteractive(contextState, interactiveOptions);
      } else {
        await scope.runNonInteractive(contextState);
      }

      // Task completed successfully
      const output = scope.output ?? {
        terminate_reason: SubagentTerminateMode.GOAL,
        emitted_vars: {},
      };

      asyncTaskManager.completeTask(agentId, output);

      messageBus?.publish({
        type: MessageBusType.ASYNC_TASK_COMPLETED,
        taskId: agentId,
        subagentName: this.normalized.subagentName,
        output,
        timestamp: Date.now(),
      });
    } catch (error) {
      // Check if this was an abort
      if (abortController.signal.aborted) {
        asyncTaskManager.cancelTask(agentId);
        messageBus?.publish({
          type: MessageBusType.ASYNC_TASK_CANCELLED,
          taskId: agentId,
          subagentName: this.normalized.subagentName,
          timestamp: Date.now(),
        });
        return;
      }

      // Task failed
      const errorMessage = error instanceof Error ? error.message : String(error);
      asyncTaskManager.failTask(agentId, errorMessage);

      messageBus?.publish({
        type: MessageBusType.ASYNC_TASK_FAILED,
        taskId: agentId,
        subagentName: this.normalized.subagentName,
        error: errorMessage,
        timestamp: Date.now(),
      });
    } finally {
      // Cleanup
      try {
        await launchResult.dispose();
      } catch {
        // Ignore dispose errors
      }
    }
  })();
}
```

### 5. New Tool: `check_async_tasks`

New file: `packages/core/src/tools/check-async-tasks.ts`

This tool has two modes:
- **List mode** (no args): Shows simple status list of all async tasks
- **Peek mode** (with task_id): Shows detailed status and emitted output for a specific task

```typescript
import { BaseDeclarativeTool, BaseToolInvocation, Kind, type ToolResult } from './tools.js';
import type { AsyncTaskManager, AsyncTaskInfo } from '../services/asyncTaskManager.js';

interface CheckAsyncTasksParams {
  task_id?: string;
}

export interface CheckAsyncTasksToolDependencies {
  getAsyncTaskManager?: () => AsyncTaskManager | undefined;
}

class CheckAsyncTasksToolInvocation extends BaseToolInvocation<CheckAsyncTasksParams, ToolResult> {
  constructor(
    params: CheckAsyncTasksParams,
    private readonly taskManager: AsyncTaskManager,
  ) {
    super(params);
  }

  override getDescription(): string {
    return this.params.task_id
      ? `Peek at async task ${this.params.task_id}`
      : 'List all async tasks';
  }

  override async execute(): Promise<ToolResult> {
    // Peek mode: specific task details
    if (this.params.task_id) {
      return this.executePeekMode(this.params.task_id);
    }

    // List mode: all tasks status
    return this.executeListMode();
  }

  private executeListMode(): ToolResult {
    const tasks = this.taskManager.getAllTasks();

    if (tasks.length === 0) {
      return {
        llmContent: 'No async tasks.',
        returnDisplay: 'No async tasks.',
        metadata: { count: 0 },
      };
    }

    const lines = ['Async Tasks:'];
    for (const task of tasks) {
      lines.push(`- ${task.status}: ${task.subagentName} (${task.id.slice(0, 8)})`);
    }

    const content = lines.join('\n');

    return {
      llmContent: content,
      returnDisplay: content,
      metadata: { count: tasks.length },
    };
  }

  private executePeekMode(taskId: string): ToolResult {
    const tasks = this.taskManager.getAllTasks();
    
    // Find all tasks matching ID or prefix
    const matches = tasks.filter(t => t.id === taskId || t.id.startsWith(taskId));

    if (matches.length === 0) {
      return {
        llmContent: `Task not found: ${taskId}`,
        returnDisplay: `Task not found: ${taskId}`,
        error: { message: `Task not found: ${taskId}`, type: 'NOT_FOUND' },
      };
    }

    if (matches.length > 1) {
      // Ambiguous - list candidates
      const candidates = matches.map(t => `- ${t.id.slice(0, 8)}: ${t.subagentName} (${t.status})`).join('
');
      return {
        llmContent: `Multiple tasks match '${taskId}'. Be more specific:
${candidates}`,
        returnDisplay: `Ambiguous ID. Matches:
${candidates}`,
        error: { message: `Ambiguous task ID: ${taskId}`, type: 'AMBIGUOUS' },
      };
    }

    const task = matches[0];

    const elapsed = task.completedAt
      ? ((task.completedAt - task.launchedAt) / 1000).toFixed(1)
      : ((Date.now() - task.launchedAt) / 1000).toFixed(1);
    const timeLabel = task.completedAt ? 'Duration' : 'Elapsed';

    const lines = [
      `Task: ${task.subagentName} (${task.id})`,
      `Status: ${task.status}`,
      `${timeLabel}: ${elapsed}s`,
      `Goal: ${task.goalPrompt}`,
      '',
    ];

    if (task.status === 'running') {
      // Show what's been emitted so far (peek at partial progress)
      const partialOutput = task.scope?.output;
      if (partialOutput && Object.keys(partialOutput.emitted_vars || {}).length > 0) {
        lines.push('Emitted so far:');
        lines.push(JSON.stringify(partialOutput.emitted_vars, null, 2));
      } else {
        lines.push('Emitted so far: (none)');
      }
    } else if (task.status === 'completed' && task.output) {
      // Show full output in sync format
      lines.push('Output:');
      lines.push(JSON.stringify({
        agent_id: task.id,
        terminate_reason: task.output.terminate_reason,
        emitted_vars: task.output.emitted_vars,
        ...(task.output.final_message ? { final_message: task.output.final_message } : {}),
      }, null, 2));
    } else if (task.status === 'failed' && task.error) {
      lines.push(`Error: ${task.error}`);
    } else if (task.status === 'cancelled') {
      lines.push('Task was cancelled.');
    }

    const content = lines.join('\n');

    return {
      llmContent: content,
      returnDisplay: content,
      metadata: {
        taskId: task.id,
        status: task.status,
      },
    };
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
      'Check the status of async subagent tasks. ' +
      'With no arguments, lists all async tasks and their status. ' +
      'With a task_id, shows detailed status and emitted output for that specific task (useful for peeking at progress).',
      Kind.Think,
      {
        type: 'object',
        properties: {
          task_id: {
            type: 'string',
            description: 'Optional. The ID (or ID prefix) of a specific task to inspect. ' +
              'If provided, shows detailed status and any emitted output. ' +
              'If omitted, lists all async tasks with their status.',
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

### 6. Slash Commands

#### `/tasks list` (alias: `/tasks`)

Add to `packages/cli/src/ui/commands/`:

```typescript
// tasksCommand.ts
export const tasksCommand: SlashCommand = {
  name: 'tasks',
  kind: CommandKind.BUILT_IN,
  description: 'Manage async subagent tasks',
  subCommands: [
    {
      name: 'list',
      description: 'List all async tasks and their status',
      kind: CommandKind.BUILT_IN,
      action: (context) => {
        const asyncTaskManager = context.config?.getAsyncTaskManager?.();
        if (!asyncTaskManager) {
          context.ui.addItem({
            type: MessageType.ERROR,
            text: 'Async task manager not available',
          }, Date.now());
          return;
        }

        const tasks = asyncTaskManager.getAllTasks();
        if (tasks.length === 0) {
          context.ui.addItem({
            type: MessageType.INFO,
            text: 'No async tasks',
          }, Date.now());
          return;
        }

        const lines = ['Async Tasks:', ''];
        tasks.forEach((task, idx) => {
          const icon = { running: '', completed: '[OK]', failed: '[ERROR]', cancelled: '' }[task.status];
          const duration = task.completedAt 
            ? `${((task.completedAt - task.launchedAt) / 1000).toFixed(1)}s`
            : `${((Date.now() - task.launchedAt) / 1000).toFixed(1)}s elapsed`;
          lines.push(`${idx + 1}. ${icon} [${task.id.slice(0, 8)}] ${task.subagentName}`);
          lines.push(`   Status: ${task.status} | Duration: ${duration}`);
          lines.push(`   Goal: ${task.goalPrompt.slice(0, 60)}...`);
          lines.push('');
        });

        context.ui.addItem({
          type: MessageType.INFO,
          text: lines.join('\n'),
        }, Date.now());
      },
    },
  ],
  action: (context) => {
    // Default action is list
    const listSubcommand = tasksCommand.subCommands?.find(c => c.name === 'list');
    return listSubcommand?.action?.(context, '');
  },
};
```

#### `/task end <id>`

```typescript
// In tasksCommand.ts
{
  name: 'end',
  description: 'Cancel a running async task. Usage: /task end <id>',
  kind: CommandKind.BUILT_IN,
  action: (context, args) => {
    const asyncTaskManager = context.config?.getAsyncTaskManager?.();
    if (!asyncTaskManager) {
      context.ui.addItem({
        type: MessageType.ERROR,
        text: 'Async task manager not available',
      }, Date.now());
      return;
    }

    if (!args?.trim()) {
      context.ui.addItem({
        type: MessageType.INFO,
        text: 'Usage: /task end <task-id>\n\nUse /tasks list to see task IDs.',
      }, Date.now());
      return;
    }

    const taskId = args.trim();
    const tasks = asyncTaskManager.getAllTasks();
    
    // Find all tasks matching ID or prefix
    const matches = tasks.filter(t => 
      t.id === taskId || t.id.startsWith(taskId)
    );

    if (matches.length === 0) {
      context.ui.addItem({
        type: MessageType.ERROR,
        text: `Task not found: ${taskId}`,
      }, Date.now());
      return;
    }

    if (matches.length > 1) {
      // Ambiguous - list candidates
      const candidates = matches.map(t => `  ${t.id.slice(0, 8)}: ${t.subagentName} (${t.status})`).join('
');
      context.ui.addItem({
        type: MessageType.ERROR,
        text: `Multiple tasks match '${taskId}'. Be more specific:
${candidates}`,
      }, Date.now());
      return;
    }

    const task = matches[0];

    if (task.status !== 'running') {
      context.ui.addItem({
        type: MessageType.ERROR,
        text: `Task ${task.id.slice(0, 8)} is not running (status: ${task.status})`,
      }, Date.now());
      return;
    }

    const cancelled = asyncTaskManager.cancelTask(task.id);
    if (cancelled) {
      context.ui.addItem({
        type: MessageType.INFO,
        text: `Cancelled task: ${task.subagentName} (${task.id.slice(0, 8)})`,
      }, Date.now());
    } else {
      context.ui.addItem({
        type: MessageType.ERROR,
        text: `Failed to cancel task: ${task.id.slice(0, 8)}`,
      }, Date.now());
    }
  },
},
```

### 7. Settings Registry Extension

Add to `packages/core/src/settings/settingsRegistry.ts`:

```typescript
{
  key: 'task-max-async',
  category: 'cli-behavior',
  description: 'Maximum number of concurrent async tasks (default: 5, -1 for unlimited)',
  type: 'number',
  default: 5,
  persistToProfile: true,
  validate: (value: unknown): ValidationResult => {
    if (typeof value === 'number' && (value === -1 || value > 0)) {
      return { success: true, value };
    }
    return {
      success: false,
      message: 'task-max-async must be a positive number or -1 for unlimited',
    };
  },
},
```

### 8. AsyncTaskReminderService (Following TodoReminderService Pattern)

New file: `packages/core/src/services/async-task-reminder-service.ts`

This service follows the **exact same pattern** as `TodoReminderService`, generating system notes that get injected via `appendSystemReminderToRequest()`.

```typescript
import type { AsyncTaskInfo, AsyncTaskManager } from './asyncTaskManager.js';

/**
 * Generates system reminders for async task status.
 * Follows the same pattern as TodoReminderService.
 */
export class AsyncTaskReminderService {
  constructor(private readonly asyncTaskManager: AsyncTaskManager) {}

  /**
   * Format message as system reminder (same format as TodoReminderService)
   */
  private formatSystemReminder(message: string): string {
    return `---\nSystem Note: ${message}\n---`;
  }

  /**
   * Get status reminder to inject on every model turn.
   * Returns null if no async tasks to report.
   */
  getStatusReminder(): string | null {
    const running = this.asyncTaskManager.getRunningTasks();
    const pending = this.asyncTaskManager.getPendingNotifications();

    if (running.length === 0 && pending.length === 0) {
      return null;
    }

    const lines: string[] = ['Async tasks status:'];

    if (running.length > 0) {
      const runningList = running.map(t => `[${t.id.slice(0, 8)}] ${t.subagentName}`).join(', ');
      lines.push(`Running: ${runningList}`);
    }

    if (pending.length > 0) {
      const pendingList = pending.map(t => `[${t.id.slice(0, 8)}] ${t.subagentName}`).join(', ');
      lines.push(`Completed (pending acknowledgement): ${pendingList}`);
    }

    return this.formatSystemReminder(lines.join('\n'));
  }

  /**
   * Get completion notification for a specific task.
   * Used when auto-triggering a turn on task completion.
   * Format matches sync task output exactly.
   */
  getCompletionReminder(task: AsyncTaskInfo): string {
    const output = {
      agent_id: task.id,
      terminate_reason: task.output?.terminate_reason ?? 'GOAL',
      emitted_vars: task.output?.emitted_vars ?? {},
      ...(task.output?.final_message ? { final_message: task.output.final_message } : {}),
    };

    return this.formatSystemReminder(
      `Async task '${task.subagentName}' completed:\n${JSON.stringify(output, null, 2)}`
    );
  }

  /**
   * Get failure notification for a specific task.
   * Format matches sync task error output.
   */
  getFailureReminder(task: AsyncTaskInfo): string {
    const output = {
      agent_id: task.id,
      terminate_reason: 'ERROR',
      emitted_vars: {},
      error: task.error,
    };

    return this.formatSystemReminder(
      `Async task '${task.subagentName}' failed:\n${JSON.stringify(output, null, 2)}`
    );
  }
}
```

### 9. Integration with Client (Like Todos)

In `packages/core/src/core/client.ts`, integrate async task reminders the same way todo reminders work:

```typescript
// Add to Client class
private readonly asyncTaskReminderService?: AsyncTaskReminderService;

// In constructor or initialization
if (this.config.getAsyncTaskManager?.()) {
  this.asyncTaskReminderService = new AsyncTaskReminderService(
    this.config.getAsyncTaskManager()
  );
}

// In the method that builds the request (where todo reminders are added)
private async buildRequestWithReminders(request: PartListUnion): Promise<PartListUnion> {
  let result = request;

  // Existing todo reminder logic...
  const todoReminder = await this.getTodoReminder();
  if (todoReminder) {
    result = this.appendSystemReminderToRequest(result, todoReminder);
  }

  // NEW: Add async task status reminder
  const asyncTaskReminder = this.asyncTaskReminderService?.getStatusReminder();
  if (asyncTaskReminder) {
    result = this.appendSystemReminderToRequest(result, asyncTaskReminder);
  }

  return result;
}
```

### 10. Auto-Trigger on Completion (When Model is Idle)

The auto-trigger mechanism fires when a task completes **and** the model is idle (not mid-turn, not waiting for confirmation). This uses the existing turn infrastructure.

```typescript
// In useGeminiStream or main CLI loop
useEffect(() => {
  const asyncTaskManager = config.getAsyncTaskManager?.();
  const reminderService = asyncTaskReminderService;
  if (!asyncTaskManager || !reminderService) return;

  const handleCompletion = async (task: AsyncTaskInfo) => {
    // Mark as notified immediately to prevent duplicate notifications
    asyncTaskManager.markNotified(task.id);

    // Only auto-trigger if model is idle
    // If model is busy, the status reminder on next turn will show it
    if (!isModelResponding && !isWaitingForConfirmation) {
      const notification = reminderService.getCompletionReminder(task);
      await triggerAgentTurn(notification);
    }
    // If model is busy, it will see the completion in the status reminder
    // on its next turn (already marked notified, so it won't show as "pending")
  };

  const handleFailure = async (task: AsyncTaskInfo) => {
    asyncTaskManager.markNotified(task.id);

    if (!isModelResponding && !isWaitingForConfirmation) {
      const notification = reminderService.getFailureReminder(task);
      await triggerAgentTurn(notification);
    }
  };

  const unsubComplete = asyncTaskManager.onTaskCompleted(handleCompletion);
  const unsubFailed = asyncTaskManager.onTaskFailed(handleFailure);

  return () => {
    unsubComplete();
    unsubFailed();
  };
}, [config, isModelResponding, isWaitingForConfirmation]);
```

### 11. Config Integration

Add to `packages/core/src/config/config.ts`:

```typescript
private asyncTaskManager?: AsyncTaskManager;

getAsyncTaskManager(): AsyncTaskManager | undefined {
  if (!this.asyncTaskManager) {
    const maxAsync = this.getEphemeralSetting('task-max-async') as number | undefined ?? 5;
    this.asyncTaskManager = new AsyncTaskManager(maxAsync);
  }
  return this.asyncTaskManager;
}
```

## Why This Design Works: Leveraging Existing Patterns

This design deliberately reuses proven patterns from the codebase rather than inventing new mechanisms:

### 1. Tool Scheduling (Already Works)

The existing Task tool already runs subagents whose tool calls:
- Route through `CoreToolScheduler`
- Display in the UI with live output
- Handle confirmations via `MessageBus`
- Are **isolated from parent agent's history**

For async tasks, **nothing changes** about how the subagent runs internally. We simply don't `await` it from the parent's perspective. The subagent still uses the same scheduler, same confirmation flow, same UI rendering.

### 2. Status Reminders (Following TodoReminderService)

The `TodoReminderService` pattern is already battle-tested:
- Generates `---
System Note: ...
---` formatted reminders
- Injected via `appendSystemReminderToRequest()` in `client.ts`
- Model sees these on every turn

`AsyncTaskReminderService` follows the **exact same pattern** - no new injection mechanism needed.

### 3. Acknowledgement and History Limits

For async tasks:
- `notifiedAt` timestamp tracks when model was informed
- Once notified (via auto-trigger or status reminder), task is marked
- Model can still peek at completed tasks via `check_async_tasks <id>`

**History limit** (prevents unbounded memory growth):
- If `task-max-async > 0`: keep `2 * task-max-async` completed tasks (e.g., default 5 → keep 10)
- If `task-max-async == -1` (unlimited): keep max 10 completed tasks
- When limit exceeded, oldest completed task is forgotten

### 4. Tool Confirmations (Identical to Sync Tasks)

Async tasks are **not background tasks** - they display and behave identically to sync tasks. The only difference is the foreground agent doesn't wait.

When an async subagent's tool needs confirmation:
- Same `MessageBus` flow as sync tasks
- Same UI rendering  
- Same blocking semantics (the subagent blocks, not the foreground)
- Same user experience - confirmations appear the same way

No special handling needed - the confirmation system doesn't know or care that the parent isn't waiting. There is no "background confirmation UX" because there is no background - async tasks are just as visible as sync tasks.

## Design Decisions & Answers to Open Questions

### 1. Resource Limits
**Decision**: Default `task-max-async = 5`, configurable via `/set task-max-async <num>` (or `-1` for unlimited).

**Rationale**: 5 is a reasonable default that prevents runaway resource consumption while allowing meaningful parallelism. Users can increase or disable the limit if needed.

### 2. Timeout Handling
**Decision**: Use the same timeout settings as sync tasks (`task-default-timeout-seconds` and `task-max-timeout-seconds`).

**Rationale**: There's no reason async tasks should have different timeout behavior. The existing ephemeral settings already handle this well.

### 3. Error Handling
**Decision**: Errors are just a different completion state (like success). The `AsyncTaskManager` tracks `failed` status, and the model is notified via the same auto-trigger mechanism.

**Rationale**: This keeps the design consistent - completion, failure, and cancellation all flow through the same notification pipeline.

### 4. Cancellation
**Decision**: Provide `/task end <id>` command for user control. The model does NOT get a cancellation tool to avoid complexity.

**Rationale**: User-initiated cancellation is the primary use case. If the model needs to cancel, it can instruct the user or simply not use the results.

### 5. Persistence
**Decision**: Task state is NOT persisted across sessions (kept in-memory only).

**Rationale**: Async tasks are session-scoped. If a session ends, running tasks are cancelled. Persisting would add significant complexity for minimal benefit.

### 6. UI/UX Display
**Decision**: Async tasks display **identically** to sync tasks in the CLI UI. They still route through `CoreToolScheduler` and show live output.

**Rationale**: Per the user's requirement, async tasks "aren't really background so much as the foreground doesn't wait and gets notified." The visual treatment should be the same.

### 7. History Limits
**Decision**: Keep `2 * task-max-async` completed tasks in history. If `task-max-async == -1`, keep max 10.

**Rationale**: Prevents unbounded memory growth while keeping enough history for the model to reference recent completions. Oldest completed tasks are forgotten when limit exceeded.

### 8. ID Collision Handling
**Decision**: For `/task end` and `check_async_tasks` peek mode, require unique prefix match. If multiple tasks match, list candidates and ask user to be more specific.

**Rationale**: Prevents accidentally cancelling or inspecting the wrong task.

## Implementation Phases

### Phase 1: Core Infrastructure
1. Add `AsyncTaskManager` service (`packages/core/src/services/asyncTaskManager.ts`)
2. Add `AsyncTaskReminderService` (`packages/core/src/services/async-task-reminder-service.ts`)
3. Add MessageBus types for async task events
4. Add `task-max-async` setting to settings registry
5. Wire `AsyncTaskManager` into `Config`

### Phase 2: Task Tool Changes
1. Add `async` parameter to `TaskToolParams`
2. Implement `executeAsync()` method in `TaskToolInvocation`
3. Ensure async tasks still route through `CoreToolScheduler` for UI display
4. Wire up abort controller for proper cancellation

### Phase 3: Reminder Integration (Following Todo Pattern)
1. Add `AsyncTaskReminderService.getStatusReminder()` injection in `client.ts`
2. Use existing `appendSystemReminderToRequest()` pattern
3. Add auto-trigger handler for completion events
4. Implement `markNotified()` / cleanup logic

### Phase 4: Tools & Commands
1. Add `check_async_tasks` tool (list mode + peek mode)
2. Add `/tasks` slash command (with `list` subcommand)
3. Add `/task end <id>` slash command
4. Handle ID prefix collision (require unique match)

### Phase 5: Testing
1. Unit tests for `AsyncTaskManager` (state transitions, notifications, cleanup)
2. Unit tests for `AsyncTaskReminderService` (format matches TodoReminderService)
3. Integration tests for async task execution
4. E2E tests for auto-notification flow
5. Tests for resource limits and cancellation

## Summary

This design enables non-blocking subagent execution while **reusing proven patterns**:

| Feature | Existing Pattern Used |
|---------|----------------------|
| Tool scheduling | `CoreToolScheduler` (unchanged) |
| Tool confirmations | `MessageBus` (unchanged) |
| Status reminders | `TodoReminderService` → `AsyncTaskReminderService` |
| Request injection | `appendSystemReminderToRequest()` |
| Acknowledgement | Notification timestamp (like todo completion) |

The key insight is that async tasks are **not fundamentally different** from sync tasks - the subagent runs identically. The only change is that the foreground agent doesn't wait, and gets notified when it completes.

**What's actually new**:
- `AsyncTaskManager` - tracks running/completed tasks
- `AsyncTaskReminderService` - generates status reminders (following todo pattern)
- `async` parameter on Task tool - triggers non-blocking execution
- `check_async_tasks` tool - list/peek at tasks
- `/tasks` and `/task end` commands - user control

**What's unchanged**:
- Subagent execution (same `CoreToolScheduler`, same UI)
- Tool confirmations (same `MessageBus` flow)
- System reminder injection (same `appendSystemReminderToRequest`)
- Timeout handling (same ephemeral settings)
