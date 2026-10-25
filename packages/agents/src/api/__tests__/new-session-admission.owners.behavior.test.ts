/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setImmediate, setTimeout as delay } from 'node:timers/promises';
import {
  resolveMaxAsyncTasks,
  resolveShellJobSettings,
} from '@vybestack/llxprt-code-core/config/asyncTaskServices.js';
import { SubagentTerminateMode } from '@vybestack/llxprt-code-core/core/subagentTypes.js';
import { AsyncTaskManager } from '@vybestack/llxprt-code-core/services/asyncTaskManager.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { AgentBusyError } from '../loop/agentBusyError.js';
import { AgentExecutionCoordinator } from '../agentExecutionCoordinator.js';
import { createNewSessionAdmission } from '../new-session-admission.js';
import { TaskLaunchOwner } from '../../session/task-launch-owner.js';
import { ShellJobOwner } from '../../session/shell-job-owner.js';
import { deferred, deadline } from './helpers/shell-owner-gate.js';

async function awaitShellCleanup(shell: ShellJobOwner): Promise<void> {
  await deadline(
    (async () => {
      while (shell.hasPendingWork()) await delay(10);
    })(),
    'shell resource release',
  );
}

/**
 * Windows liveness is a process-table query by PID. POSIX process groups
 * (`process.kill(-pgid, 0)`) do not exist there: a Windows shell job reports
 * the outer PowerShell PID, and its command runs in an inner process.
 */
function windowsProcessIsAlive(pid: number): boolean {
  const query = spawnSync(
    'tasklist',
    ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'],
    { encoding: 'utf8', windowsHide: true },
  );
  if (query.status !== 0)
    throw new Error(`tasklist failed for PID ${pid}: ${query.stderr}`);
  return query.stdout.includes(`"${pid}"`);
}

async function awaitPidFile(path: string, boundary: string): Promise<number> {
  return deadline(
    (async () => {
      for (;;) {
        const text = existsSync(path) ? readFileSync(path, 'utf8').trim() : '';
        if (/^\d+$/.test(text)) return Number(text);
        await delay(10);
      }
    })(),
    boundary,
  );
}

/**
 * The owners and the admission gate are built the way the foreground assembly
 * builds them (`assembleTaskOwner`, `ShellJobOwner` over the resolved shell
 * settings, `bindSessionAdmission` on the coordinator's settings gate,
 * `createNewSessionAdmission`). `startNewSession` runs a counting operation
 * through the gate, so `sessions()` is the number of admitted switches.
 */
function openAdmission(): {
  tasks: TaskLaunchOwner;
  shell: ShellJobOwner;
  startNewSession(): Promise<void>;
  sessions(): number;
  close(): Promise<void>;
} {
  const settings = new SettingsService();
  const readMaxTasks = (): number => resolveMaxAsyncTasks(settings);
  const tasks = new TaskLaunchOwner(
    new AsyncTaskManager(readMaxTasks()),
    readMaxTasks,
  );
  const shell = new ShellJobOwner(() => resolveShellJobSettings(settings));
  const coordinator = new AgentExecutionCoordinator();
  const assertSessionAdmission = (): void => coordinator.assertNoCommit();
  tasks.bindSessionAdmission(assertSessionAdmission);
  shell.bindSessionAdmission(assertSessionAdmission);
  const admit = createNewSessionAdmission(
    tasks,
    shell,
    coordinator,
    { hasPendingClientWork: () => false },
    () => {},
  );
  let admitted = 0;
  return {
    tasks,
    shell,
    startNewSession: () =>
      admit(async () => {
        admitted++;
      }),
    sessions: () => admitted,
    close: async () => {
      shell.closeAdmission();
      tasks.closeAdmissionAndAbort();
      await Promise.allSettled([shell.dispose(), tasks.join()]);
    },
  };
}

async function awaitTaskOwnerIdle(tasks: TaskLaunchOwner): Promise<void> {
  await deadline(
    (async () => {
      while (tasks.hasPendingWork()) await delay(10);
    })(),
    'task owner idle',
  );
}

async function joinFailure(tasks: TaskLaunchOwner): Promise<boolean> {
  const failure = await tasks.join().then(
    () => null,
    (error: unknown) => error,
  );
  return failure instanceof AggregateError;
}

async function failTask(tasks: TaskLaunchOwner, id: string): Promise<void> {
  await tasks.start(async (launch, publish) => {
    tasks.manager.registerTask({
      id,
      subagentName: 'worker',
      goalPrompt: 'work',
      abortController: launch.controller,
    });
    launch.register(id);
    publish({ llmContent: '', returnDisplay: '' });
  });
  tasks.manager.failTask(id, 'failed work');
}

describe('new-session admission over the task and shell owners', () => {
  for (const state of ['completed', 'failed']) {
    it(`recovers a busy-time ${state} notice and admits clear after delivery`, async () => {
      const { tasks, shell, startNewSession, sessions, close } =
        openAdmission();
      const messages: string[] = [];
      const first = tasks.subscribeNotifications(
        () => true,
        async (text) => {
          messages.push(text);
        },
        shell,
      );
      let current = first;
      try {
        await tasks.start(async (launch, publish) => {
          tasks.manager.registerTask({
            id: 'busy-task',
            subagentName: 'worker',
            goalPrompt: 'work',
            abortController: launch.controller,
          });
          launch.register('busy-task');
          publish({ llmContent: '', returnDisplay: '' });
        });
        if (state === 'completed')
          tasks.manager.completeTask('busy-task', {
            terminate_reason: SubagentTerminateMode.GOAL,
            emitted_vars: { result: 'done' },
          });
        else tasks.manager.failTask('busy-task', 'failed work');
        await setImmediate();
        await expect(startNewSession()).rejects.toThrow(
          /^(?!.*cancel).*completion notices/,
        );
        first();
        const delivered = deferred<void>();
        current = tasks.subscribeNotifications(
          () => false,
          async (text) => {
            messages.push(text);
            delivered.resolve();
          },
          shell,
        );
        await deadline(delivered.promise, 'idle notice recovery');
        await current.drain();
        await startNewSession();
        expect(messages).toHaveLength(1);
        expect(tasks.getPendingNotifications()).toHaveLength(0);
        expect(sessions()).toBe(1);
      } finally {
        current();
        await current.drain();
        await close();
      }
    });
  }

  it('keeps cancelled task cleanup owned even when its history is evicted', async () => {
    const { tasks, startNewSession, sessions, close } = openAdmission();
    const release = deferred<void>();
    try {
      await tasks.start(async (launch, publish) => {
        tasks.manager.registerTask({
          id: 'disposing-child',
          subagentName: 'worker',
          goalPrompt: 'work',
          abortController: launch.controller,
        });
        launch.register('disposing-child');
        publish({ llmContent: '', returnDisplay: '' });
        await release.promise;
      });
      tasks.manager.setMaxAsyncTasks(1);
      tasks.cancelTask('disposing-child');
      for (let i = 0; i < 4; i++) {
        tasks.manager.registerTask({
          id: `history-${i}`,
          subagentName: 'worker',
          goalPrompt: 'work',
          abortController: new AbortController(),
        });
        tasks.manager.cancelTask(`history-${i}`);
      }
      expect(tasks.getTask('disposing-child')).toBeUndefined();
      await expect(startNewSession()).rejects.toThrow('cleanup');
      release.resolve();
      await tasks.join();
      await startNewSession();
      expect(sessions()).toBe(1);
    } finally {
      release.resolve();
      await close();
    }
  });

  it.skipIf(process.platform === 'win32')(
    'blocks on acknowledged terminal shell groups until OS resources are released',
    async () => {
      const { shell, startNewSession, sessions, close } = openAdmission();
      const terminal = deferred<void>();
      const off = shell.onJobCompleted(() => terminal.resolve());
      try {
        const job = shell.launch({
          command: 'printf draining-shell',
          cwd: process.cwd(),
        });
        await deadline(terminal.promise, 'terminal shell record');
        if (job.pid === undefined)
          throw new Error('Expected owned shell group pid');
        shell.markNotified([job.id]);
        expect(shell.getRunningJobs()).toHaveLength(0);
        expect(shell.getPendingNotifications()).toHaveLength(0);
        const pgid = job.pid;
        expect(() => process.kill(-pgid, 0)).not.toThrow();
        await expect(startNewSession()).rejects.toThrow('shell cleanup');
        await awaitShellCleanup(shell);
        expect(() => process.kill(-pgid, 0)).toThrow('ESRCH');
        await startNewSession();
        expect(sessions()).toBe(1);
      } finally {
        off();
        await close();
      }
    },
  );

  // Windows has no process groups. The job's PID is the outer PowerShell,
  // which waits for the inner PowerShell that runs the command, so the job is
  // terminal only after both are gone and there is no post-terminal drain
  // window to observe. The session gate is therefore proven while the held
  // inner process is alive, and the release is proven by a process-table query
  // of both PIDs the job owns.
  it.skipIf(process.platform !== 'win32')(
    'blocks on a running shell job until its Windows processes are released',
    async () => {
      const { shell, startNewSession, sessions, close } = openAdmission();
      const terminal = deferred<void>();
      const off = shell.onJobCompleted(() => terminal.resolve());
      const dir = mkdtempSync(join(tmpdir(), 'shell-held-'));
      const pidFile = join(dir, 'inner.pid');
      const pendingPidFile = join(dir, 'inner.pid.tmp');
      const releaseFile = join(dir, 'release');
      const quoted = (value: string): string =>
        `'${value.replaceAll("'", "''")}'`;
      try {
        // Publish by rename: Windows rejects opening a file Set-Content still
        // has open, so the reader only ever sees a complete inner.pid.
        const job = shell.launch({
          command:
            `Set-Content -LiteralPath ${quoted(pendingPidFile)} -Value $PID; ` +
            `Move-Item -LiteralPath ${quoted(pendingPidFile)} -Destination ${quoted(pidFile)}; ` +
            `while (-not (Test-Path -LiteralPath ${quoted(releaseFile)})) ` +
            '{ Start-Sleep -Milliseconds 20 }',
          cwd: process.cwd(),
        });
        if (job.pid === undefined)
          throw new Error('Expected owned shell outer pid');
        const outerPid = job.pid;
        const innerPid = await awaitPidFile(
          pidFile,
          'inner shell process started',
        );
        expect(windowsProcessIsAlive(outerPid)).toBe(true);
        expect(windowsProcessIsAlive(innerPid)).toBe(true);
        await expect(startNewSession()).rejects.toThrow('running shell jobs');
        writeFileSync(releaseFile, 'release');
        await deadline(terminal.promise, 'terminal shell record');
        shell.markNotified([job.id]);
        expect(shell.getRunningJobs()).toHaveLength(0);
        expect(shell.getPendingNotifications()).toHaveLength(0);
        expect(windowsProcessIsAlive(innerPid)).toBe(false);
        expect(windowsProcessIsAlive(outerPid)).toBe(false);
        await awaitShellCleanup(shell);
        await startNewSession();
        expect(sessions()).toBe(1);
      } finally {
        off();
        await close();
        rmSync(dir, { recursive: true, force: true });
      }
    },
  );

  it.skipIf(process.platform === 'win32')(
    'requires restart after the OS cannot confirm a shell group drained',
    async () => {
      const { shell, startNewSession, close } = openAdmission();
      const terminal = deferred<void>();
      const off = shell.onJobCompleted(() => terminal.resolve());
      const originalKill = process.kill;
      try {
        const job = shell.launch({
          command: 'printf ownership-probe',
          cwd: process.cwd(),
        });
        if (job.pid === undefined)
          throw new Error('Expected shell group identity');
        const pgid = job.pid;
        process.kill = (pid, signal): true => {
          if (pid === -pgid && signal === 0)
            throw Object.assign(new Error('probe denied'), { code: 'EPERM' });
          return originalKill.call(process, pid, signal);
        };
        await deadline(terminal.promise, 'terminal shell record');
        shell.markNotified([job.id]);
        await expect(startNewSession()).rejects.toThrow(
          'wait for owned process groups to drain',
        );
        await expect(shell.current()?.cancel(job.id)).rejects.toThrow(
          'Cannot confirm shell process group',
        );
        expect(shell.hasPendingWork()).toBe(true);
        await expect(startNewSession()).rejects.toThrow(
          'shell cleanup failed (restart the CLI)',
        );
        process.kill = originalKill;
        await expect(shell.dispose()).rejects.toThrow(
          'Shell process group cleanup failed',
        );
        await expect(startNewSession()).rejects.toThrow(
          'shell cleanup failed (restart the CLI)',
        );
      } finally {
        process.kill = originalKill;
        off();
        await close();
      }
    },
    15000,
  );

  it('rejects a running subagent and its completed but undelivered notice', async () => {
    const { tasks, startNewSession, sessions, close } = openAdmission();
    try {
      await tasks.start(async (launch, publish) => {
        tasks.manager.registerTask({
          id: 'old-task',
          subagentName: 'worker',
          goalPrompt: 'work',
          abortController: launch.controller,
        });
        launch.register('old-task');
        publish({ llmContent: '', returnDisplay: '' });
      });
      await setImmediate();
      await expect(startNewSession()).rejects.toThrow(AgentBusyError);
      tasks.manager.completeTask('old-task', {
        terminate_reason: SubagentTerminateMode.GOAL,
        emitted_vars: { result: 'old-session result' },
      });
      await expect(startNewSession()).rejects.toThrow('background');
      expect(sessions()).toBe(0);
      tasks.markNotified('old-task');
      await startNewSession();
      expect(sessions()).toBe(1);
      expect(sessions()).toBe(1);
    } finally {
      await close();
    }
  });

  it('rejects an already queued delivery until the submission is consumed', async () => {
    const { tasks, shell, startNewSession, sessions, close } = openAdmission();
    const entered = deferred<void>();
    const consumed = deferred<void>();
    const unsubscribe = tasks.subscribeNotifications(
      () => false,
      async () => {
        entered.resolve();
        await consumed.promise;
      },
      shell,
    );
    try {
      await tasks.start(async (launch, publish) => {
        tasks.manager.registerTask({
          id: 'queued-task',
          subagentName: 'worker',
          goalPrompt: 'work',
          abortController: launch.controller,
        });
        launch.register('queued-task');
        publish({ llmContent: '', returnDisplay: '' });
      });
      tasks.manager.completeTask('queued-task', {
        terminate_reason: SubagentTerminateMode.GOAL,
        emitted_vars: { result: 'queued output' },
      });
      await deadline(entered.promise, 'queued notice');
      tasks.markNotified('queued-task');
      await expect(startNewSession()).rejects.toThrow('background');
      consumed.resolve();
      await unsubscribe.drain();
      await startNewSession();
      expect(sessions()).toBe(1);
    } finally {
      consumed.resolve();
      unsubscribe();
      await unsubscribe.drain();
      await close();
    }
  });

  it('rejects running shell jobs and their completed but undelivered notices', async () => {
    const { shell, startNewSession, sessions, close } = openAdmission();
    try {
      const terminal = deferred<void>();
      const off = shell.onJobCompleted(() => terminal.resolve());
      const job = shell.launch({
        command: 'printf old-shell-output',
        cwd: process.cwd(),
      });
      const switchWhileShellRunning = startNewSession();
      await expect(switchWhileShellRunning).rejects.toThrow('background');
      await deadline(terminal.promise, 'shell completion');
      off();
      const switchWithUndeliveredShellNotice = startNewSession();
      await expect(switchWithUndeliveredShellNotice).rejects.toThrow(
        'background',
      );
      shell.markNotified([job.id]);
      await awaitShellCleanup(shell);
      await setImmediate();
      await startNewSession();
      expect(sessions()).toBe(1);
    } finally {
      await close();
    }
  });
  for (const delivery of ['throws', 'defers']) {
    it(`retains a failed-task notice after a delivery that ${delivery} until a replacement delivers it`, async () => {
      const { tasks, shell, startNewSession, sessions, close } =
        openAdmission();
      const entered = deferred<void>();
      const first = tasks.subscribeNotifications(
        () => false,
        async () => {
          entered.resolve();
          if (delivery === 'throws')
            throw new Error('notice transport unavailable');
          return 'deferred';
        },
        shell,
      );
      let current = first;
      const messages: string[] = [];
      const reportsFailure = delivery === 'throws';
      try {
        await failTask(tasks, 'retained-task');
        await deadline(entered.promise, 'first delivery attempt');
        first();
        expect(await joinFailure(tasks)).toBe(reportsFailure);
        await awaitTaskOwnerIdle(tasks);
        expect(tasks.getPendingNotifications()).toHaveLength(1);
        expect(tasks.getTask('retained-task')?.notifiedAt).toBeUndefined();
        await expect(startNewSession()).rejects.toThrow('completion notices');
        expect(sessions()).toBe(0);
        const delivered = deferred<void>();
        current = tasks.subscribeNotifications(
          () => false,
          async (text) => {
            messages.push(text);
            delivered.resolve();
          },
          shell,
        );
        await deadline(delivered.promise, 'replacement delivery');
        await current.drain();
        await awaitTaskOwnerIdle(tasks);
        expect(messages).toHaveLength(1);
        expect(tasks.getPendingNotifications()).toHaveLength(0);
        expect(tasks.getTask('retained-task')?.notifiedAt).toBeDefined();
        await startNewSession();
        expect(sessions()).toBe(1);
        expect(await joinFailure(tasks)).toBe(reportsFailure);
      } finally {
        current();
        await current.drain();
        await close();
      }
    });
  }

  it('retires a subscription before any delivery without recording a failure', async () => {
    const { tasks, shell, startNewSession, sessions, close } = openAdmission();
    const retire = tasks.subscribeNotifications(
      () => true,
      async () => {
        throw new Error('unexpected delivery while busy');
      },
      shell,
    );
    try {
      await failTask(tasks, 'undelivered-task');
      await setImmediate();
      retire();
      await tasks.join();
      expect(tasks.hasPendingWork()).toBe(false);
      expect(tasks.getPendingNotifications()).toHaveLength(1);
      expect(tasks.getTask('undelivered-task')?.notifiedAt).toBeUndefined();
      await expect(startNewSession()).rejects.toThrow('completion notices');
      expect(sessions()).toBe(0);
    } finally {
      retire();
      await close();
    }
  });

  it('keeps ownership of an in-flight delivery after its subscription retires', async () => {
    const { tasks, shell, startNewSession, sessions, close } = openAdmission();
    const entered = deferred<void>();
    const release = deferred<void>();
    const retire = tasks.subscribeNotifications(
      () => false,
      async () => {
        entered.resolve();
        await release.promise;
        return 'deferred';
      },
      shell,
    );
    try {
      await failTask(tasks, 'in-flight-task');
      await deadline(entered.promise, 'delivery attempt');
      retire();
      expect(tasks.hasPendingWork()).toBe(true);
      await expect(startNewSession()).rejects.toThrow('completion delivery');
      release.resolve();
      await awaitTaskOwnerIdle(tasks);
      expect(tasks.getPendingNotifications()).toHaveLength(1);
      expect(tasks.getTask('in-flight-task')?.notifiedAt).toBeUndefined();
      await expect(startNewSession()).rejects.toThrow('completion notices');
      expect(sessions()).toBe(0);
      await tasks.join();
    } finally {
      release.resolve();
      retire();
      await close();
    }
  });
});
