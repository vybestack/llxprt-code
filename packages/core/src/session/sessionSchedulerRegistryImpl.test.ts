/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'bun:test';
import {
  createSessionSchedulerRegistry,
  SessionSchedulerRegistryImpl,
} from './sessionSchedulerRegistryImpl.js';
import type { SchedulerHandle } from './sessionExecutionServices.js';
import type { ToolCallRequestInfo } from '../core/turn.js';

type SetCallbacksOptions = Parameters<SchedulerHandle['setCallbacks']>[0];

/**
 * Real scheduler double in the config.scheduler.test.ts style: actual state
 * (disposed flag, recorded creation options) the tests assert on, not a
 * behavior-mirroring mock.
 */
class RecordingScheduler implements SchedulerHandle {
  disposed = false;

  constructor(readonly creationOptions: { interactiveMode?: boolean }) {}

  async schedule(
    _request: ToolCallRequestInfo | ToolCallRequestInfo[],
    _signal: AbortSignal,
  ): Promise<void> {}

  cancelAll(): void {}

  setCallbacks(_options: SetCallbacksOptions): void {}

  dispose(): void {
    this.disposed = true;
  }
}

/** Flush pending microtasks without resolving controlled creation promises. */
const flush = async (): Promise<void> => {
  for (let i = 0; i < 4; i++) {
    await Promise.resolve();
  }
};

describe('SessionSchedulerRegistryImpl', () => {
  it('gives same-label distinct owners distinct schedulers from two factory calls', async () => {
    const created: RecordingScheduler[] = [];
    const registry = createSessionSchedulerRegistry({
      createScheduler: async (options) => {
        const scheduler = new RecordingScheduler(options);
        created.push(scheduler);
        return scheduler;
      },
    });
    // Distinct owner objects carrying the identical label string that used
    // to collide under the session-id-keyed singleton.
    const ownerA = { sessionId: 'same-label' };
    const ownerB = { sessionId: 'same-label' };

    const handleA = await registry.getOrCreate(ownerA, 'session');
    const handleB = await registry.getOrCreate(ownerB, 'session');

    expect(created).toHaveLength(2);
    expect(handleA).not.toBe(handleB);
    expect(handleA).toBe(created[0]);
    expect(handleB).toBe(created[1]);

    registry.release(ownerA, 'session');
    registry.release(ownerB, 'session');
    expect(created[0].disposed).toBe(true);
    expect(created[1].disposed).toBe(true);
  });

  it('shares one scheduler per owner and purpose and disposes at zero', async () => {
    const created: RecordingScheduler[] = [];
    const registry = createSessionSchedulerRegistry({
      createScheduler: async (options) => {
        const scheduler = new RecordingScheduler(options);
        created.push(scheduler);
        return scheduler;
      },
    });
    const owner = { sessionId: 'owner-1' };

    const first = await registry.getOrCreate(owner, 'session');
    const second = await registry.getOrCreate(owner, 'session');

    expect(created).toHaveLength(1);
    expect(first).toBe(second);

    // First release keeps the entry schedulable.
    registry.release(owner, 'session');
    expect(created[0].disposed).toBe(false);
    const reacquired = await registry.getOrCreate(owner, 'session');
    expect(reacquired).toBe(first);
    expect(created).toHaveLength(1);

    // Remaining acquisitions released: the entry dies and the next
    // acquisition builds a fresh scheduler.
    registry.release(owner, 'session');
    registry.release(owner, 'session');
    expect(created[0].disposed).toBe(true);
    const fresh = await registry.getOrCreate(owner, 'session');
    expect(fresh).not.toBe(first);
    expect(created).toHaveLength(2);
  });

  it('deduplicates concurrent getOrCreate calls into one factory call', async () => {
    let factoryCalls = 0;
    let releaseCreation: ((handle: SchedulerHandle) => void) | undefined;
    const creation = new Promise<SchedulerHandle>((resolve) => {
      releaseCreation = resolve;
    });
    const registry = createSessionSchedulerRegistry({
      createScheduler: async (options) => {
        factoryCalls += 1;
        await creation;
        return new RecordingScheduler(options);
      },
    });
    const owner = { sessionId: 'owner-1' };

    const firstPromise = registry.getOrCreate(owner, 'session');
    const secondPromise = registry.getOrCreate(owner, 'session');
    await flush();

    expect(factoryCalls).toBe(1);
    releaseCreation?.(new RecordingScheduler({ interactiveMode: true }));

    const first = await firstPromise;
    const second = await secondPromise;
    expect(factoryCalls).toBe(1);
    expect(first).toBe(second);
  });

  it('disposeAll joins in-flight creations then disposes every entry', async () => {
    const created: RecordingScheduler[] = [];
    let releaseCreation: ((handle: SchedulerHandle) => void) | undefined;
    const creation = new Promise<SchedulerHandle>((resolve) => {
      releaseCreation = resolve;
    });
    const registry = createSessionSchedulerRegistry({
      createScheduler: async (options) => {
        const scheduler = new RecordingScheduler(options);
        if (options.interactiveMode === false) {
          // Only the second key's creation is held in flight.
          await creation;
        }
        created.push(scheduler);
        return scheduler;
      },
    });
    const ownerA = { sessionId: 'ready' };
    const ownerB = { sessionId: 'in-flight' };

    await registry.getOrCreate(ownerA, 'session');
    const inFlightPromise = registry.getOrCreate(ownerB, 'subagent', {
      interactiveMode: false,
    });
    await flush();
    expect(created).toHaveLength(1);

    let disposeAllSettled = false;
    const disposeAllPromise = registry.disposeAll().then(() => {
      disposeAllSettled = true;
    });
    await flush();
    // The sweep must wait for the in-flight creation instead of leaving it
    // to resolve into a cleared registry as a live orphan.
    expect(disposeAllSettled).toBe(false);

    releaseCreation?.(new RecordingScheduler({ interactiveMode: false }));
    const inFlightHandle = await inFlightPromise;
    await disposeAllPromise;

    expect(disposeAllSettled).toBe(true);
    expect(inFlightHandle).toBe(created[1]);
    expect(created[0].disposed).toBe(true);
    expect(created[1].disposed).toBe(true);
    expect(created).toHaveLength(2);
  });

  it('treats release of an unknown key as a no-op', () => {
    const registry = new SessionSchedulerRegistryImpl({
      createScheduler: async () => new RecordingScheduler({}),
    });

    expect(() => {
      registry.release({ sessionId: 'never-acquired' }, 'session');
    }).not.toThrow();
  });

  it('keeps the first acquisition interactiveMode for later acquisitions', async () => {
    const creationOptions: Array<{ interactiveMode?: boolean }> = [];
    const registry = createSessionSchedulerRegistry({
      createScheduler: async (options) => {
        creationOptions.push(options);
        return new RecordingScheduler(options);
      },
    });
    const owner = { sessionId: 'owner-1' };

    await registry.getOrCreate(owner, 'session', { interactiveMode: true });
    const reused = await registry.getOrCreate(owner, 'session', {
      interactiveMode: false,
    });

    // One creation, fixed to the first acquisition's mode.
    expect(creationOptions).toHaveLength(1);
    expect(creationOptions[0].interactiveMode).toBe(true);
    expect(reused).toBeInstanceOf(RecordingScheduler);

    // Absent options default to true and do not re-create either.
    const defaulted = await registry.getOrCreate(owner, 'session');
    expect(creationOptions).toHaveLength(1);
    expect(defaulted).toBe(reused);
  });

  it('drops a failed creation so the next acquisition retries the factory', async () => {
    let factoryCalls = 0;
    const registry = createSessionSchedulerRegistry({
      createScheduler: async (options) => {
        factoryCalls += 1;
        if (factoryCalls === 1) {
          throw new Error('creation failed');
        }
        return new RecordingScheduler(options);
      },
    });
    const owner = { sessionId: 'owner-1' };

    await expect(registry.getOrCreate(owner, 'session')).rejects.toThrow(
      'creation failed',
    );

    const retried = await registry.getOrCreate(owner, 'session');
    expect(factoryCalls).toBe(2);
    expect(retried).toBeInstanceOf(RecordingScheduler);
  });

  it('swallows dispose errors during release and still drops the entry', async () => {
    class ThrowingDisposeScheduler extends RecordingScheduler {
      override dispose(): void {
        this.disposed = true;
        throw new Error('dispose failed');
      }
    }
    const created: RecordingScheduler[] = [];
    const registry = createSessionSchedulerRegistry({
      createScheduler: async (options) => {
        const scheduler =
          created.length === 0
            ? new ThrowingDisposeScheduler(options)
            : new RecordingScheduler(options);
        created.push(scheduler);
        return scheduler;
      },
    });
    const owner = { sessionId: 'owner-1' };

    await registry.getOrCreate(owner, 'session');

    expect(() => {
      registry.release(owner, 'session');
    }).not.toThrow();
    expect(created[0].disposed).toBe(true);

    const fresh = await registry.getOrCreate(owner, 'session');
    expect(fresh).not.toBe(created[0]);
  });
});
