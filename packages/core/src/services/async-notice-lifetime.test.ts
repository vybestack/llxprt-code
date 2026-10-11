/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import { SubagentTerminateMode } from '../core/subagentTypes.js';
import { AsyncTaskManager } from './asyncTaskManager.js';
import { AsyncTaskReminderService } from './asyncTaskReminderService.js';
import { AsyncTaskAutoTrigger } from './asyncTaskAutoTrigger.js';

function barrier(): {
  promise: Promise<void>;
  resolve: () => void;
  reject: (error: Error) => void;
} {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((accept, fail) => {
    resolve = accept;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function tick(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

function fixture(): {
  manager: AsyncTaskManager;
  trigger: AsyncTaskAutoTrigger;
  messages: string[];
  entered: ReturnType<typeof barrier>;
  acknowledgement: ReturnType<typeof barrier>;
  complete: (id: string) => void;
} {
  const manager = new AsyncTaskManager();
  const entered = barrier();
  const acknowledgement = barrier();
  const messages: string[] = [];
  const trigger = new AsyncTaskAutoTrigger(
    manager,
    new AsyncTaskReminderService(manager),
    () => false,
    async (text) => {
      messages.push(text);
      entered.resolve();
      await acknowledgement.promise;
    },
  );
  return {
    manager,
    trigger,
    messages,
    entered,
    acknowledgement,
    complete: (id) => {
      manager.registerTask({
        id,
        subagentName: 'same-label',
        goalPrompt: id,
        abortController: new AbortController(),
      });
      manager.completeTask(id, {
        emitted_vars: {},
        terminate_reason: SubagentTerminateMode.GOAL,
      });
    },
  };
}

describe('async notice subscription lifetime', () => {
  it('allows a replacement subscription to deliver without extending the retired drain', async () => {
    const f = fixture();
    const retired = f.trigger.subscribe();
    f.complete('old');
    await f.entered.promise;
    retired();
    const nextAck = barrier();
    const nextMessages: string[] = [];
    f.trigger.updateCallbacks(
      () => false,
      async (text) => {
        nextMessages.push(text);
        await nextAck.promise;
      },
    );
    const replacement = f.trigger.subscribe();
    f.complete('new');
    await tick();
    f.acknowledgement.resolve();
    await retired.drain();
    await tick();
    try {
      expect(nextMessages[0]).toContain('new');
      expect(nextMessages[0]).not.toContain('"agent_id": "old"');
      expect(f.manager.getTask('new')?.notifiedAt).toBeUndefined();
    } finally {
      replacement();
      nextAck.resolve();
      await replacement.drain();
    }
    expect(f.manager.getTask('new')?.notifiedAt).toBeDefined();
  }, 30000);

  it('cancels queued task checks synchronously before delivery', async () => {
    const f = fixture();
    const unsubscribe = f.trigger.subscribe();
    f.complete('queued');
    expect(unsubscribe()).toBeUndefined();
    f.acknowledgement.resolve();
    await tick();
    expect(f.messages).toStrictEqual([]);
    expect(f.manager.getTask('queued')?.notifiedAt).toBeUndefined();
  }, 30000);

  it('joins an admitted acknowledgement after retirement without delivering later IDs', async () => {
    const f = fixture();
    const unsubscribe = f.trigger.subscribe();
    f.complete('first');
    await f.entered.promise;
    f.complete('second');
    unsubscribe();
    let drained = false;
    const drain = unsubscribe.drain().then(() => {
      drained = true;
    });
    await tick();
    expect(drained).toBe(false);
    expect(f.manager.getTask('first')?.notifiedAt).toBeUndefined();
    f.acknowledgement.resolve();
    await drain;
    await tick();
    expect(f.messages).toHaveLength(1);
    expect(f.messages[0]).toContain('first');
    expect(f.messages[0]).not.toContain('second');
    expect(f.manager.getTask('first')?.notifiedAt).toBeDefined();
    expect(f.manager.getTask('second')?.notifiedAt).toBeUndefined();
  }, 30000);

  it('retains a failed acknowledgement for drain without marking or detached rejection', async () => {
    const f = fixture();
    const unsubscribe = f.trigger.subscribe();
    f.complete('failed-ack');
    await f.entered.promise;
    unsubscribe();
    const error = new Error('queue rejected');
    f.acknowledgement.reject(error);
    await tick();
    await expect(unsubscribe.drain()).rejects.toMatchObject({
      errors: [error],
    });
    expect(f.manager.getTask('failed-ack')?.notifiedAt).toBeUndefined();
    expect(f.messages).toHaveLength(1);
  }, 30000);

  it('keeps equal-label owners independent when one retires', async () => {
    const retired = fixture();
    const live = fixture();
    const stopRetired = retired.trigger.subscribe();
    const stopLive = live.trigger.subscribe();
    retired.complete('equal-id');
    live.complete('equal-id');
    stopRetired();
    retired.acknowledgement.resolve();
    live.acknowledgement.resolve();
    await live.entered.promise;
    await tick();
    stopLive();
    expect(retired.messages).toStrictEqual([]);
    expect(retired.manager.getTask('equal-id')?.notifiedAt).toBeUndefined();
    expect(live.messages[0]).toContain('equal-id');
    expect(live.manager.getTask('equal-id')?.notifiedAt).toBeDefined();
  }, 30000);
});
