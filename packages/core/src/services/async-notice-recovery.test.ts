/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import {
  setImmediate as nextTurn,
  setTimeout as delay,
} from 'node:timers/promises';
import { AsyncTaskManager } from './asyncTaskManager.js';
import { SubagentTerminateMode } from '../core/subagentTypes.js';
import { AsyncTaskReminderService } from './asyncTaskReminderService.js';
import { AsyncTaskAutoTrigger } from './asyncTaskAutoTrigger.js';
import { ShellJobManager, type ShellJob } from './shellJobManager.js';
import { ShellNotificationAdapter } from './shellNotificationAdapter.js';

type ShellOutcome = 'completed' | 'failed' | 'cancelled';
const shellOutcomes: ShellOutcome[] = ['completed', 'failed', 'cancelled'];
const shellScenarios = shellOutcomes.flatMap((state) =>
  ['idle update', 'subscription replacement'].map((recovery) => ({
    state,
    recovery,
  })),
);

/**
 * Bounds the wait for a real shell job to reach a terminal event. The timer
 * is ref'd, so it also keeps the event loop alive while the job's child
 * process (which the manager unrefs) is the only other pending work.
 */
const SHELL_TERMINAL_WAIT_MS = process.platform === 'win32' ? 15_000 : 5_000;

function awaitShellOutcome(
  terminal: Promise<ShellOutcome>,
): Promise<ShellOutcome | 'timeout'> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => resolve('timeout'), SHELL_TERMINAL_WAIT_MS);
    terminal.then(
      (outcome) => {
        clearTimeout(timer);
        resolve(outcome);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/**
 * Launches a real shell job that ends in `expected` and returns once the
 * manager reports a terminal event. Every terminal outcome is observed, so a
 * job that ends differently fails here with its actual state and output
 * instead of leaving the test waiting for an event that will not come.
 */
async function finishShell(
  shell: ShellJobManager,
  expected: ShellOutcome,
): Promise<ShellJob> {
  const terminal = deferred<ShellOutcome>();
  const unsubscribe = [
    shell.onJobCompleted(() => terminal.resolve('completed')),
    shell.onJobFailed(() => terminal.resolve('failed')),
    shell.onJobCancelled(() => terminal.resolve('cancelled')),
  ];
  // Each command is valid for both POSIX sh and PowerShell, the shell the
  // manager launches on Windows.
  const commands = {
    completed: 'echo shell-output',
    failed: 'exit 7',
    cancelled: 'sleep 30',
  };
  try {
    const job = shell.launch({
      command: commands[expected],
      cwd: process.cwd(),
    });
    if (expected === 'cancelled') await shell.cancel(job.id);
    const actual = await awaitShellOutcome(terminal.promise);
    if (actual !== expected) {
      const reached =
        actual === 'timeout'
          ? `no terminal event within ${SHELL_TERMINAL_WAIT_MS}ms`
          : `a ${actual} event`;
      throw new Error(
        `Expected shell job ${job.id} to end ${expected} but saw ${reached}. ` +
          `Job: ${JSON.stringify(shell.get(job.id))}. ` +
          `Output: ${JSON.stringify(shell.tailOutput(job.id).output)}`,
      );
    }
    return job;
  } finally {
    for (const off of unsubscribe) off();
  }
}

function register(manager: AsyncTaskManager, id: string): void {
  manager.registerTask({
    id,
    subagentName: 'worker',
    goalPrompt: 'work',
    abortController: new AbortController(),
  });
}

function complete(manager: AsyncTaskManager, id: string): void {
  manager.completeTask(id, {
    terminate_reason: SubagentTerminateMode.GOAL,
    emitted_vars: { result: id },
  });
}

async function settle(): Promise<void> {
  await nextTurn();
  await nextTurn();
}

function deferred<T = void>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe('completion notice lifecycle recovery', () => {
  it('retains deferred notices without retrying on unrelated completions until an idle opportunity', async () => {
    const manager = new AsyncTaskManager();
    let attempts = 0;
    const delivered: string[] = [];
    const trigger = new AsyncTaskAutoTrigger(
      manager,
      new AsyncTaskReminderService(manager),
      () => false,
      async (text) => {
        attempts++;
        if (attempts === 1) return 'deferred';
        delivered.push(text);
        return undefined;
      },
    );
    const off = trigger.subscribe();
    try {
      register(manager, 'deferred-result');
      complete(manager, 'deferred-result');
      await settle();
      await off.drain();
      expect(attempts).toBe(1);
      expect(manager.getPendingNotifications()).toHaveLength(1);
      register(manager, 'later-result');
      complete(manager, 'later-result');
      await settle();
      expect(attempts).toBe(1);
      expect(manager.getPendingNotifications()).toHaveLength(2);
      off.schedule();
      await settle();
      await off.drain();
      expect(attempts).toBe(2);
      expect(delivered).toHaveLength(1);
      expect(delivered[0]).toContain('deferred-result');
      expect(delivered[0]).toContain('later-result');
      expect(manager.getPendingNotifications()).toHaveLength(0);
    } finally {
      off();
      await off.drain();
    }
  });

  it('preserves an idle opportunity requested while a deferred delivery is still settling', async () => {
    const manager = new AsyncTaskManager();
    const entered = deferred();
    const release = deferred();
    let attempts = 0;
    const trigger = new AsyncTaskAutoTrigger(
      manager,
      new AsyncTaskReminderService(manager),
      () => false,
      async () => {
        attempts++;
        if (attempts === 1) {
          entered.resolve();
          await release.promise;
          return 'deferred';
        }
        return undefined;
      },
    );
    const off = trigger.subscribe();
    try {
      register(manager, 'settling-result');
      complete(manager, 'settling-result');
      await entered.promise;
      off.schedule();
      await settle();
      expect(attempts).toBe(1);
      release.resolve();
      await off.drain();
      await settle();
      expect(attempts).toBe(2);
      expect(manager.getPendingNotifications()).toHaveLength(0);
    } finally {
      release.resolve();
      off();
      await off.drain();
    }
  });

  for (const state of ['completed', 'failed']) {
    it(`delivers a ${state} task on callback idle update without another event`, async () => {
      const manager = new AsyncTaskManager();
      const delivered: string[] = [];
      const deliver = async (text: string): Promise<void> => {
        delivered.push(text);
      };
      const trigger = new AsyncTaskAutoTrigger(
        manager,
        new AsyncTaskReminderService(manager),
        () => true,
        deliver,
      );
      const off = trigger.subscribe();
      try {
        register(manager, 'busy-result');
        if (state === 'completed') complete(manager, 'busy-result');
        else manager.failTask('busy-result', 'failed work');
        await settle();
        expect(manager.getPendingNotifications()).toHaveLength(1);
        expect(delivered).toHaveLength(0);
        trigger.updateCallbacks(() => false, deliver);
        await settle();
        expect(manager.getPendingNotifications()).toHaveLength(0);
        expect(delivered).toHaveLength(1);
        expect(delivered[0]).toContain('busy-result');
      } finally {
        off();
        await off.drain();
      }
    });
  }

  it('delivers results already pending at initial subscription', async () => {
    const manager = new AsyncTaskManager();
    register(manager, 'before-subscribe');
    complete(manager, 'before-subscribe');
    const delivered: string[] = [];
    const trigger = new AsyncTaskAutoTrigger(
      manager,
      new AsyncTaskReminderService(manager),
      () => false,
      async (text) => {
        delivered.push(text);
      },
    );
    const off = trigger.subscribe();
    try {
      await settle();
      expect(manager.getPendingNotifications()).toHaveLength(0);
      expect(delivered).toHaveLength(1);
    } finally {
      off();
      await off.drain();
    }
  });

  it('reconciles an immediate retired before it fires', async () => {
    const manager = new AsyncTaskManager();
    const delivered: string[] = [];
    const trigger = new AsyncTaskAutoTrigger(
      manager,
      new AsyncTaskReminderService(manager),
      () => false,
      async (text) => {
        delivered.push(text);
      },
    );
    const first = trigger.subscribe();
    register(manager, 'retired-result');
    complete(manager, 'retired-result');
    first();
    const second = trigger.subscribe();
    try {
      await settle();
      expect(manager.getPendingNotifications()).toHaveLength(0);
      expect(delivered).toHaveLength(1);
    } finally {
      second();
      await first.drain();
      await second.drain();
    }
  });

  it('serializes replacement during delivery and acknowledges only the delivered batch', async () => {
    const manager = new AsyncTaskManager();
    const entered = deferred();
    const release = deferred();
    const delivered: string[] = [];
    const trigger = new AsyncTaskAutoTrigger(
      manager,
      new AsyncTaskReminderService(manager),
      () => false,
      async (text) => {
        delivered.push(text);
        entered.resolve();
        await release.promise;
      },
    );
    const first = trigger.subscribe();
    register(manager, 'first-result');
    complete(manager, 'first-result');
    await entered.promise;
    first();
    register(manager, 'second-result');
    manager.failTask('second-result', 'failure');
    const second = trigger.subscribe();
    try {
      await settle();
      expect(delivered).toHaveLength(1);
      expect(manager.getPendingNotifications()).toHaveLength(2);
      release.resolve();
      await first.drain();
      await settle();
      expect(delivered).toHaveLength(2);
      expect(delivered[0]).not.toContain('second-result');
      expect(delivered[1]).not.toContain('first-result');
      expect(manager.getPendingNotifications()).toHaveLength(0);
    } finally {
      release.resolve();
      second();
      await second.drain();
    }
  });

  it('retains failed deliveries without event-driven retry until explicit lifecycle recovery', async () => {
    const manager = new AsyncTaskManager();
    let attempts = 0;
    const trigger = new AsyncTaskAutoTrigger(
      manager,
      new AsyncTaskReminderService(manager),
      () => false,
      async () => {
        attempts++;
        throw new Error('delivery unavailable');
      },
    );
    const first = trigger.subscribe();
    register(manager, 'failed-delivery');
    complete(manager, 'failed-delivery');
    await settle();
    await expect(first.drain()).rejects.toThrow('Async notice delivery failed');
    register(manager, 'later-result');
    complete(manager, 'later-result');
    await settle();
    expect(attempts).toBe(1);
    expect(manager.getPendingNotifications()).toHaveLength(2);
    first();
    const delivered: string[] = [];
    trigger.updateCallbacks(
      () => false,
      async (text) => {
        delivered.push(text);
      },
    );
    const second = trigger.subscribe();
    try {
      await settle();
      expect(manager.getPendingNotifications()).toHaveLength(0);
      expect(delivered).toHaveLength(1);
      await expect(first.drain()).rejects.toThrow(
        'Async notice delivery failed',
      );
    } finally {
      second();
      await second.drain();
    }
  });

  it('recovers once when a replacement subscribes before a rejected delivery settles', async () => {
    const manager = new AsyncTaskManager();
    const entered = deferred();
    const release = deferred();
    const delivered: string[] = [];
    const trigger = new AsyncTaskAutoTrigger(
      manager,
      new AsyncTaskReminderService(manager),
      () => false,
      async () => {
        entered.resolve();
        await release.promise;
        throw new Error('retired delivery discarded');
      },
    );
    const first = trigger.subscribe();
    register(manager, 'replacement-result');
    complete(manager, 'replacement-result');
    await entered.promise;
    first();
    trigger.updateCallbacks(
      () => false,
      async (text) => {
        delivered.push(text);
      },
    );
    const replacement = trigger.subscribe();
    await settle();
    release.resolve();
    try {
      await expect(first.drain()).rejects.toThrow(
        'Async notice delivery failed',
      );
      await settle();
      expect(manager.getPendingNotifications()).toHaveLength(0);
      expect(delivered).toHaveLength(1);
    } finally {
      replacement();
      await replacement.drain();
    }
  });

  for (const { state, recovery } of shellScenarios) {
    it(`delivers real ${state} shell work through ${recovery}`, async () => {
      const manager = new AsyncTaskManager();
      const shell = new ShellJobManager();
      const source = new ShellNotificationAdapter(shell);
      const reminder = new AsyncTaskReminderService(manager);
      reminder.setShellNotificationSource(source);
      const delivered: string[] = [];
      const deliver = async (text: string): Promise<void> => {
        delivered.push(text);
      };
      const trigger = new AsyncTaskAutoTrigger(
        manager,
        reminder,
        () => true,
        deliver,
      );
      trigger.setShellNotificationSource(source);
      const first = trigger.subscribe();
      let current = first;
      try {
        const job = await finishShell(shell, state);
        if (recovery === 'idle update') await delay(350);
        else first();
        expect(shell.getPendingNotifications()).toHaveLength(1);
        trigger.updateCallbacks(() => false, deliver);
        if (recovery === 'subscription replacement')
          current = trigger.subscribe();
        await settle();
        expect(shell.getPendingNotifications()).toHaveLength(0);
        expect(delivered).toHaveLength(1);
        expect(delivered[0]).toContain(job.id);
      } finally {
        current();
        await current.drain();
        await shell.dispose();
      }
    });
  }
});

describe('terminal task history retention', () => {
  it('bounds cancelled history without claiming notification delivery or aborting active work', () => {
    const manager = new AsyncTaskManager(1);
    for (let i = 0; i < 6; i++) {
      register(manager, `cancel-${i}`);
      manager.cancelTask(`cancel-${i}`);
    }
    register(manager, 'active');
    expect(manager.getAllTasks()).toHaveLength(3);
    expect(manager.getTask('cancel-5')?.notifiedAt).toBeUndefined();
    expect(manager.getTask('active')?.abortController?.signal.aborted).toBe(
      false,
    );
    expect(manager.getPendingNotifications()).toHaveLength(0);
  });

  it('protects an unread oldest result while evicting other eligible rows', () => {
    const manager = new AsyncTaskManager(1);
    register(manager, 'unread');
    complete(manager, 'unread');
    for (let i = 0; i < 5; i++) {
      register(manager, `eligible-${i}`);
      manager.cancelTask(`eligible-${i}`);
    }
    expect(manager.getAllTasks()).toHaveLength(2);
    expect(
      manager.getPendingNotifications().map((task) => task.id),
    ).toStrictEqual(['unread']);
  });

  it('prunes immediately after acknowledgement without another terminal event', () => {
    const manager = new AsyncTaskManager(1);
    for (let i = 0; i < 4; i++) {
      register(manager, `result-${i}`);
      complete(manager, `result-${i}`);
    }
    expect(manager.getAllTasks()).toHaveLength(4);
    manager.markNotified('result-0');
    expect(manager.getAllTasks()).toHaveLength(3);
    manager.markNotified('result-1');
    expect(manager.getAllTasks()).toHaveLength(2);
    expect(manager.getPendingNotifications()).toHaveLength(2);
  });
});
