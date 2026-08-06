/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan PLAN-20260130-ASYNCTASK.P13
 */

import { describe, expect, it } from 'bun:test';
import { CheckAsyncTasksTool } from './check-async-tasks.js';
import type {
  AsyncTaskInfo,
  IAsyncTaskService,
  SubagentTaskInfo,
  ShellJobInfo,
  AsyncOutputTailResult,
} from '../interfaces/index.js';

class MockAsyncTaskService implements IAsyncTaskService {
  private readonly tasks = new Map<string, AsyncTaskInfo>();
  private readonly shellJobs = new Map<string, ShellJobInfo>();
  private readonly tails = new Map<string, string>();

  async checkAsyncTask(taskId: string) {
    const task = this.getTask(taskId) ?? this.getTaskByPrefix(taskId).task;
    if (!task) {
      throw new Error(`Task not found: ${taskId}`);
    }
    return task.status;
  }

  getTaskStatus(): AsyncTaskInfo[] {
    return [...this.tasks.values(), ...this.shellJobs.values()];
  }

  getTask(taskId: string): AsyncTaskInfo | undefined {
    const task = this.tasks.get(taskId);
    if (task) {
      return task;
    }
    return this.shellJobs.get(taskId);
  }

  getTaskByPrefix(prefix: string) {
    const all = [...this.tasks.values(), ...this.shellJobs.values()];
    const matches = all.filter((task) => task.id.startsWith(prefix));
    if (matches.length === 1) {
      return { task: matches[0] };
    }
    if (matches.length > 1) {
      return { candidates: matches };
    }
    return {};
  }

  getOutputTail(taskId: string): AsyncOutputTailResult {
    const output = this.tails.get(taskId);
    if (output === undefined) {
      return { id: taskId, output: '', truncated: false };
    }
    return { id: taskId, output, truncated: false };
  }

  async cancel(taskId: string): Promise<boolean> {
    const task = this.getTask(taskId);
    if (!task || task.status !== 'running') {
      return false;
    }
    task.status = 'cancelled';
    return true;
  }

  registerTask(task: SubagentTaskInfo): void {
    this.tasks.set(task.id, task);
  }

  registerShellJob(job: ShellJobInfo): void {
    this.shellJobs.set(job.id, job);
  }

  setTail(taskId: string, output: string): void {
    this.tails.set(taskId, output);
  }
}

function createTask(
  id: string,
  subagentName: string,
  goalPrompt: string,
): SubagentTaskInfo {
  return {
    kind: 'subagent',
    id,
    subagentName,
    goalPrompt,
    status: 'running',
    launchedAt: Date.now(),
  };
}

function createShellJob(id: string, command: string): ShellJobInfo {
  return {
    kind: 'shell',
    id,
    command,
    cwd: '/tmp',
    status: 'running',
    launchedAt: Date.now(),
  };
}

describe('CheckAsyncTasksTool', () => {
  const buildDependencies = (service?: IAsyncTaskService) => ({
    getAsyncTaskService: () => service,
  });

  describe('List Mode', () => {
    it('returns summary of all tasks', async () => {
      const service = new MockAsyncTaskService();
      const completedTask = createTask(
        'task-abc123',
        'deepthinker',
        'Analyze codebase',
      );
      completedTask.status = 'completed';
      completedTask.output = { emitted_vars: {} };
      completedTask.completedAt = Date.now();
      service.registerTask(completedTask);
      service.registerTask(
        createTask('task-def456', 'typescriptexpert', 'Refactor module'),
      );

      const tool = new CheckAsyncTasksTool(buildDependencies(service));
      const invocation = tool.build({});
      const result = await invocation.execute(new AbortController().signal);

      expect(result.error).toBeUndefined();
      expect(result.metadata).toMatchObject({
        count: 2,
        running: 1,
        completed: 1,
        failed: 0,
        cancelled: 0,
      });
      expect(result.llmContent).toContain('Async Tasks Summary');
      expect(result.llmContent).toContain('Running: 1');
      expect(result.llmContent).toContain('Completed: 1');
      expect(result.llmContent).toContain('task-abc123');
      expect(result.llmContent).toContain('task-def456');
    });

    it('uses [FAILED] status label (not [ERROR]) for failed tasks', async () => {
      const service = new MockAsyncTaskService();
      const failedTask = createTask(
        'task-failed-123',
        'typescriptexpert',
        'Fix boundary issue',
      );
      failedTask.status = 'failed';
      failedTask.error = 'Subagent execution failed';
      failedTask.completedAt = Date.now();
      service.registerTask(failedTask);

      const tool = new CheckAsyncTasksTool(buildDependencies(service));
      const invocation = tool.build({});
      const result = await invocation.execute(new AbortController().signal);

      expect(result.error).toBeUndefined();
      expect(result.returnDisplay).toContain(
        '[FAILED] **task-failed-123** - failed',
      );
      expect(result.returnDisplay).not.toContain('[ERROR]');
    });

    it('returns "no tasks" when empty', async () => {
      const service = new MockAsyncTaskService();

      const tool = new CheckAsyncTasksTool(buildDependencies(service));
      const invocation = tool.build({});
      const result = await invocation.execute(new AbortController().signal);

      expect(result.error).toBeUndefined();
      expect(result.metadata).toStrictEqual({ count: 0 });
      expect(result.llmContent).toBe('No async tasks.');
      expect(result.returnDisplay).toContain(
        'No async tasks are currently running or completed',
      );
    });
  });

  describe('Peek Mode', () => {
    it('returns detailed task info by exact ID', async () => {
      const service = new MockAsyncTaskService();
      const task = createTask('task-exact-match', 'deepthinker', 'Review PR');
      task.status = 'completed';
      task.output = { emitted_vars: { result: 'approved' } };
      task.completedAt = Date.now();
      service.registerTask(task);

      const tool = new CheckAsyncTasksTool(buildDependencies(service));
      const invocation = tool.build({ task_id: 'task-exact-match' });
      const result = await invocation.execute(new AbortController().signal);

      expect(result.error).toBeUndefined();
      expect(result.llmContent).toContain('"id": "task-exact-match"');
      expect(result.llmContent).toContain('"subagentName": "deepthinker"');
      expect(result.llmContent).toContain('"goalPrompt": "Review PR"');
      expect(result.llmContent).toContain('"status": "completed"');
      expect(result.llmContent).toContain('"result": "approved"');
    });

    it('returns detailed task info by prefix', async () => {
      const service = new MockAsyncTaskService();
      service.registerTask(
        createTask(
          'task-prefix-test-12345',
          'typescriptexpert',
          'Implement feature',
        ),
      );

      const tool = new CheckAsyncTasksTool(buildDependencies(service));
      const invocation = tool.build({ task_id: 'task-prefix' });
      const result = await invocation.execute(new AbortController().signal);

      expect(result.error).toBeUndefined();
      expect(result.llmContent).toContain('"id": "task-prefix-test-12345"');
      expect(result.llmContent).toContain('"subagentName": "typescriptexpert"');
    });

    it('returns error for ambiguous prefix with candidates', async () => {
      const service = new MockAsyncTaskService();
      service.registerTask(createTask('task-abc-111', 'deepthinker', 'Task 1'));
      service.registerTask(
        createTask('task-abc-222', 'typescriptexpert', 'Task 2'),
      );

      const tool = new CheckAsyncTasksTool(buildDependencies(service));
      const invocation = tool.build({ task_id: 'task-abc' });
      const result = await invocation.execute(new AbortController().signal);

      expect(result.error).toBeDefined();
      expect(result.error?.message).toBe('Ambiguous task ID');
      expect(result.llmContent).toContain(
        "Ambiguous task ID prefix 'task-abc'",
      );
      expect(result.llmContent).toContain('task-abc-111');
      expect(result.llmContent).toContain('task-abc-222');
    });

    it('uses [FAILED] status label in detailed display for failed tasks', async () => {
      const service = new MockAsyncTaskService();
      const task = createTask(
        'task-failed-detail-123',
        'typescriptexpert',
        'Refactor module',
      );
      task.status = 'failed';
      task.error = 'Compilation failed';
      task.completedAt = Date.now();
      service.registerTask(task);

      const tool = new CheckAsyncTasksTool(buildDependencies(service));
      const invocation = tool.build({ task_id: 'task-failed-detail-123' });
      const result = await invocation.execute(new AbortController().signal);

      expect(result.error).toBeUndefined();
      expect(result.returnDisplay).toContain('[FAILED] **typescriptexpert**');
      expect(result.returnDisplay).not.toContain('[ERROR]');
    });

    it('returns error for not found', async () => {
      const service = new MockAsyncTaskService();

      const tool = new CheckAsyncTasksTool(buildDependencies(service));
      const invocation = tool.build({ task_id: 'nonexistent' });
      const result = await invocation.execute(new AbortController().signal);

      expect(result.error).toBeDefined();
      expect(result.error?.message).toBe('Task not found');
      expect(result.llmContent).toContain(
        "No async task found with ID or prefix 'nonexistent'",
      );
    });

    it('renders shell job detail with command and bounded output tail', async () => {
      const service = new MockAsyncTaskService();
      const job = createShellJob('shell_abc123', 'echo hello');
      job.status = 'running';
      service.registerShellJob(job);
      service.setTail('shell_abc123', 'hello\nworld\n');

      const tool = new CheckAsyncTasksTool(buildDependencies(service));
      const invocation = tool.build({ task_id: 'shell_abc123' });
      const result = await invocation.execute(new AbortController().signal);

      expect(result.error).toBeUndefined();
      expect(result.llmContent).toContain('"kind": "shell"');
      expect(result.llmContent).toContain('"command": "echo hello"');
      expect(result.llmContent).toContain('"outputTail"');
      expect(result.returnDisplay).toContain('Kind: shell');
      expect(result.returnDisplay).toContain('Output tail:');
    });
  });

  describe('Cancel Mode', () => {
    it('cancels a running subagent task', async () => {
      const service = new MockAsyncTaskService();
      service.registerTask(
        createTask('task-cancel-1', 'deepthinker', 'Running work'),
      );

      const tool = new CheckAsyncTasksTool(buildDependencies(service));
      const invocation = tool.build({
        task_id: 'task-cancel-1',
        action: 'cancel',
      });
      const result = await invocation.execute(new AbortController().signal);

      expect(result.error).toBeUndefined();
      expect(result.llmContent).toContain('cancelled successfully');
      expect(service.getTask('task-cancel-1')?.status).toBe('cancelled');
    });

    it('cancels a running shell job', async () => {
      const service = new MockAsyncTaskService();
      service.registerShellJob(createShellJob('shell_cancel', 'sleep 100'));

      const tool = new CheckAsyncTasksTool(buildDependencies(service));
      const invocation = tool.build({
        task_id: 'shell_cancel',
        action: 'cancel',
      });
      const result = await invocation.execute(new AbortController().signal);

      expect(result.error).toBeUndefined();
      expect(result.llmContent).toContain('cancelled successfully');
      expect(service.getTask('shell_cancel')?.status).toBe('cancelled');
    });

    it('reports already-terminal when task is not running', async () => {
      const service = new MockAsyncTaskService();
      const task = createTask('task-done', 'deepthinker', 'Done work');
      task.status = 'completed';
      task.completedAt = Date.now();
      service.registerTask(task);

      const tool = new CheckAsyncTasksTool(buildDependencies(service));
      const invocation = tool.build({
        task_id: 'task-done',
        action: 'cancel',
      });
      const result = await invocation.execute(new AbortController().signal);

      expect(result.error).toBeUndefined();
      expect(result.llmContent).toContain('already terminal');
    });

    it('returns error when cancelling nonexistent task', async () => {
      const service = new MockAsyncTaskService();

      const tool = new CheckAsyncTasksTool(buildDependencies(service));
      const invocation = tool.build({
        task_id: 'nope',
        action: 'cancel',
      });
      const result = await invocation.execute(new AbortController().signal);

      expect(result.error).toBeDefined();
      expect(result.error?.message).toBe('Task not found');
    });
  });

  describe('Duration Formatting', () => {
    it('formats seconds correctly', async () => {
      const service = new MockAsyncTaskService();
      const launchedAt = Date.now();
      const task = createTask('task-seconds', 'deepthinker', 'Quick task');
      task.launchedAt = launchedAt - 15000;
      task.completedAt = launchedAt;
      task.status = 'completed';
      service.registerTask(task);

      const tool = new CheckAsyncTasksTool(buildDependencies(service));
      const invocation = tool.build({ task_id: 'task-seconds' });
      const result = await invocation.execute(new AbortController().signal);

      expect(result.llmContent).toContain('"duration": "15s"');
    });

    it('formats minutes correctly', async () => {
      const service = new MockAsyncTaskService();
      const launchedAt = Date.now();
      const task = createTask('task-minutes', 'deepthinker', 'Medium task');
      task.launchedAt = launchedAt - 150000;
      task.completedAt = launchedAt;
      task.status = 'completed';
      service.registerTask(task);

      const tool = new CheckAsyncTasksTool(buildDependencies(service));
      const invocation = tool.build({ task_id: 'task-minutes' });
      const result = await invocation.execute(new AbortController().signal);

      expect(result.llmContent).toContain('"duration": "2m 30s"');
    });

    it('formats hours correctly', async () => {
      const service = new MockAsyncTaskService();
      const launchedAt = Date.now();
      const task = createTask('task-hours', 'deepthinker', 'Long task');
      task.launchedAt = launchedAt - 4500000;
      task.completedAt = launchedAt;
      task.status = 'completed';
      service.registerTask(task);

      const tool = new CheckAsyncTasksTool(buildDependencies(service));
      const invocation = tool.build({ task_id: 'task-hours' });
      const result = await invocation.execute(new AbortController().signal);

      expect(result.llmContent).toContain('"duration": "1h 15m"');
    });
  });

  it('throws when async task service is unavailable', () => {
    const tool = new CheckAsyncTasksTool(buildDependencies(undefined));
    expect(() => tool.build({})).toThrow(
      'Async task service is unavailable. Please configure async tasks before invoking this tool.',
    );
  });
});
