/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import { AsyncTaskManager } from '@vybestack/llxprt-code-core/services/asyncTaskManager.js';
import { TaskLaunchOwner } from './task-launch-owner.js';

function gate(): { promise: Promise<void>; release(): void } {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

async function complete(owner: TaskLaunchOwner, id: string): Promise<void> {
  await owner.start(async (launch, publish) => {
    owner.manager.registerTask({
      id,
      subagentName: id,
      goalPrompt: id,
      abortController: launch.controller,
    });
    launch.register(id);
    owner.manager.failTask(id, 'external task failure');
    publish({ llmContent: id, returnDisplay: id });
  });
}

describe('owned completion notices', () => {
  it('joins a retired delivery acknowledgement and only marks its owner tasks', async () => {
    const manager = new AsyncTaskManager(5);
    const first = new TaskLaunchOwner(manager);
    const second = new TaskLaunchOwner(manager);
    const entered = gate();
    const ack = gate();
    const messages: string[] = [];
    const unsubscribe = first.subscribeNotifications(
      () => false,
      async (text) => {
        messages.push(text);
        entered.release();
        await ack.promise;
      },
    );
    await complete(first, 'first-child');
    await entered.promise;
    await complete(second, 'second-child');
    unsubscribe();
    first.closeAdmissionAndAbort();
    let joined = false;
    const disposal = first.join().then(() => {
      joined = true;
    });
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(joined).toBe(false);
    expect(messages.join()).toContain('first-child');
    expect(messages.join()).not.toContain('second-child');
    ack.release();
    await disposal;
    expect(
      manager.getPendingNotifications().map((task) => task.id),
    ).toStrictEqual(['second-child']);
    expect(() =>
      first.subscribeNotifications(
        () => false,
        async () => {},
      ),
    ).toThrow('closed');
  }, 30000);

  it('retains delivery failure for shutdown after synchronous retirement', async () => {
    const owner = new TaskLaunchOwner(new AsyncTaskManager(5));
    const failure = new Error('delivery acknowledgement failed');
    const delivered = gate();
    const unsubscribe = owner.subscribeNotifications(
      () => false,
      async () => {
        delivered.release();
        throw failure;
      },
    );
    await complete(owner, 'failed-delivery');
    await delivered.promise;
    unsubscribe();
    owner.closeAdmissionAndAbort();
    const error = await owner.join().catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(AggregateError);
    if (!(error instanceof AggregateError))
      throw new Error('Expected shutdown failure');
    const deliveryErrors = error.errors.flatMap((nested: unknown) =>
      nested instanceof AggregateError ? nested.errors : [nested],
    );
    expect(deliveryErrors).toContain(failure);
    expect(
      owner.manager.getPendingNotifications().map((task) => task.id),
    ).toStrictEqual(['failed-delivery']);
  }, 30000);
});
