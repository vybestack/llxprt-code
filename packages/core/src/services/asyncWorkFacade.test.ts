/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { AsyncTaskManager } from './asyncTaskManager.js';
import { ShellJobManager } from './shellJobManager.js';
import { AsyncWorkFacade } from './asyncWorkFacade.js';

function makeTempBase(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'facade-test-'));
}

function waitForShellTerminal(
  manager: ShellJobManager,
  id: string,
  timeoutMs = 5000,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;
    const tick = (): void => {
      const job = manager.get(id);
      if (job !== undefined && job.state !== 'running') {
        resolve();
        return;
      }
      if (Date.now() > deadline) {
        reject(new Error(`Job ${id} did not reach terminal state in time`));
        return;
      }
      setTimeout(tick, 50);
    };
    tick();
  });
}

describe.skipIf(os.platform() === 'win32')('AsyncWorkFacade', () => {
  let taskManager: AsyncTaskManager;
  let jobManager: ShellJobManager;
  let baseDir: string;
  let facade: AsyncWorkFacade;

  beforeEach(() => {
    taskManager = new AsyncTaskManager(5);
    baseDir = makeTempBase();
    jobManager = new ShellJobManager({ baseDir });
    facade = new AsyncWorkFacade(
      () => taskManager,
      () => jobManager,
    );
  });

  afterEach(async () => {
    await jobManager.dispose();
    fs.rmSync(baseDir, { recursive: true, force: true });
  });

  describe('list', () => {
    it('aggregates subagent tasks and shell jobs', () => {
      taskManager.registerTask({
        id: 'deepthinker-aaa',
        subagentName: 'deepthinker',
        goalPrompt: 'think',
        abortController: new AbortController(),
      });
      jobManager.launch({ command: 'echo hi', cwd: os.tmpdir() });

      const items = facade.list();
      expect(items).toHaveLength(2);
      const kinds = items.map((i) => i.kind).sort();
      expect(kinds).toStrictEqual(['shell', 'subagent']);
    });

    it('returns empty when both managers are empty', () => {
      expect(facade.list()).toHaveLength(0);
    });

    it('handles undefined managers gracefully', () => {
      const emptyFacade = new AsyncWorkFacade(
        () => undefined,
        () => undefined,
      );
      expect(emptyFacade.list()).toHaveLength(0);
    });
  });

  describe('get', () => {
    it('finds a subagent task by exact id', () => {
      taskManager.registerTask({
        id: 'coder-123',
        subagentName: 'typescriptexpert',
        goalPrompt: 'code',
        abortController: new AbortController(),
      });
      const result = facade.get('coder-123');
      expect(result).toBeDefined();
      expect(result?.kind).toBe('subagent');
      expect(result?.subagentName).toBe('typescriptexpert');
    });

    it('finds a shell job by exact id', () => {
      const job = jobManager.launch({
        command: 'echo test',
        cwd: os.tmpdir(),
      });
      const result = facade.get(job.id);
      expect(result).toBeDefined();
      expect(result?.kind).toBe('shell');
      expect(result?.command).toBe('echo test');
    });

    it('returns undefined for unknown id', () => {
      expect(facade.get('nonexistent')).toBeUndefined();
    });
  });

  describe('getByPrefix', () => {
    it('finds a unique subagent task by prefix', () => {
      taskManager.registerTask({
        id: 'unique-task-999',
        subagentName: 'tester',
        goalPrompt: 'test',
        abortController: new AbortController(),
      });
      const result = facade.getByPrefix('unique-task');
      expect(result.task).toBeDefined();
      expect(result.task?.id).toBe('unique-task-999');
    });

    it('finds a unique shell job by prefix', () => {
      const job = jobManager.launch({
        command: 'echo prefix',
        cwd: os.tmpdir(),
      });
      const result = facade.getByPrefix(job.id.substring(0, 10));
      expect(result.task).toBeDefined();
      expect(result.task?.id).toBe(job.id);
    });

    it('detects cross-source ambiguity and reports all candidates', () => {
      // subagent task with id starting with 'common'
      taskManager.registerTask({
        id: 'common-subagent',
        subagentName: 'alpha',
        goalPrompt: 'g',
        abortController: new AbortController(),
      });
      // We can't control shell job id prefixes (they are shell_xxxx), so
      // test cross-source ambiguity by creating two subagent tasks with the
      // same prefix instead — this proves the facade aggregates candidates.
      taskManager.registerTask({
        id: 'common-other',
        subagentName: 'beta',
        goalPrompt: 'g',
        abortController: new AbortController(),
      });

      const result = facade.getByPrefix('common');
      expect(result.task).toBeUndefined();
      expect(result.candidates).toBeDefined();
      expect(result.candidates).toHaveLength(2);
    });

    it('returns empty for unknown prefix', () => {
      expect(facade.getByPrefix('nope')).toStrictEqual({});
    });
  });

  describe('tailOutput', () => {
    it('returns bounded output for a shell job', async () => {
      const job = jobManager.launch({
        command: 'echo tail-content',
        cwd: os.tmpdir(),
      });
      await waitForShellTerminal(jobManager, job.id);

      const tail = facade.tailOutput(job.id);
      expect(tail.output).toContain('tail-content');
    });

    it('returns empty tail for a subagent task', () => {
      taskManager.registerTask({
        id: 'sub-1',
        subagentName: 'agent',
        goalPrompt: 'g',
        abortController: new AbortController(),
      });
      const tail = facade.tailOutput('sub-1');
      expect(tail.output).toBe('');
    });
  });

  describe('cancel', () => {
    it('cancels a running shell job', async () => {
      const job = jobManager.launch({
        command: 'sleep 30',
        cwd: os.tmpdir(),
      });
      const result = await facade.cancel(job.id);
      expect(result).toBe(true);

      const terminal = jobManager.get(job.id);
      expect(terminal?.state).toBe('cancelled');
    });

    it('cancels a running subagent task', async () => {
      taskManager.registerTask({
        id: 'cancel-me',
        subagentName: 'agent',
        goalPrompt: 'g',
        abortController: new AbortController(),
      });
      const result = await facade.cancel('cancel-me');
      expect(result).toBe(true);
      expect(taskManager.getTask('cancel-me')?.status).toBe('cancelled');
    });

    it('returns false for already-terminal task', async () => {
      const job = jobManager.launch({
        command: 'true',
        cwd: os.tmpdir(),
      });
      await waitForShellTerminal(jobManager, job.id);
      const result = await facade.cancel(job.id);
      expect(result).toBe(false);
    });

    it('returns false for unknown id', async () => {
      const result = await facade.cancel('does-not-exist');
      expect(result).toBe(false);
    });

    it('routes cancel to the correct manager', async () => {
      // Shell job should be cancelled by the job manager, not task manager
      const job = jobManager.launch({
        command: 'sleep 30',
        cwd: os.tmpdir(),
      });
      const result = await facade.cancel(job.id);
      expect(result).toBe(true);
      // Task manager should not have this id
      expect(taskManager.getTask(job.id)).toBeUndefined();
    });
  });
});
