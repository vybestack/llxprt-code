/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral test for the scheduler receiver-preservation fix (issue #2653).
 *
 * When no schedulerFactory is provided (the ACP/Zed fallback path),
 * initInteractiveScheduler must preserve the scheduler's `this` context.
 * Previously it copied `schedule: scheduler.schedule` directly, losing the
 * receiver and causing `this.isRunning is not a function` when
 * CoreToolScheduler.schedule() called this.isRunning().
 *
 * This test creates a receiver-sensitive scheduler and verifies that calling
 * the facade's `schedule()` invokes the original scheduler's method with the
 * correct `this`.
 */

import { describe, it, expect, vi } from 'vitest';
// vi is used for mocking ctx components below
import {
  initInteractiveScheduler,
  type InitSchedulerContext,
} from './subagentExecution.js';
import { DebugLogger } from '@vybestack/llxprt-code-core/debug/DebugLogger.js';
import type { MessageBus } from '@vybestack/llxprt-code-core/confirmation-bus/message-bus.js';

/**
 * A scheduler whose schedule() method depends on `this` — it calls
 * this.isRunning() (just like CoreToolScheduler). If the receiver is lost,
 * this throws "this.isRunning is not a function".
 *
 * IMPORTANT: schedule() MUST be a regular prototype method, NOT an arrow
 * function property. Arrow functions lexically bind `this` to the instance,
 * which would make receiver-loss impossible to detect — the test would pass
 * even with the bug present.
 */
class ReceiverSensitiveScheduler {
  private running = false;
  scheduleCallCount = 0;

  private isRunning(): boolean {
    return this.running;
  }

  async schedule(_req: unknown, _signal: unknown): Promise<void> {
    this.scheduleCallCount++;
    // This call will crash if `this` is wrong (e.g. copied without binding).
    if (this.isRunning()) {
      throw new Error('should not be running');
    }
  }

  async dispose(): Promise<void> {}
}

function makeCtx(
  overrides?: Partial<InitSchedulerContext>,
): InitSchedulerContext {
  return {
    schedulerConfig: {
      getSessionId: () => 'test-session',
      disposeScheduler: vi.fn(),
    } as unknown as InitSchedulerContext['schedulerConfig'],
    messageBus: {
      subscribe: vi.fn(() => () => {}),
      respondToConfirmation: vi.fn(),
    } as unknown as MessageBus,
    subagentId: 'test-subagent',
    logger: new DebugLogger('test'),
    ...overrides,
  };
}

describe('initInteractiveScheduler — scheduler receiver preservation (issue #2653)', () => {
  it('preserves the scheduler receiver when no schedulerFactory is provided (ACP fallback)', async () => {
    const realScheduler = new ReceiverSensitiveScheduler();

    // Override getOrCreateScheduler to return our receiver-sensitive scheduler.
    const ctx = makeCtx({
      schedulerConfig: {
        getSessionId: () => 'test-session',
        disposeScheduler: vi.fn(),
        getOrCreateScheduler: vi.fn(async () => realScheduler),
      } as unknown as InitSchedulerContext['schedulerConfig'],
    });

    // No schedulerFactory → exercises the fallback path.
    const result = await initInteractiveScheduler(undefined, ctx);

    // Call schedule through the facade. Before the fix, this crashed with
    // "this.isRunning is not a function" because the facade copied
    // `schedule: scheduler.schedule` without binding, so `this` inside
    // schedule() was the facade (which has no isRunning method).
    const signal = new AbortController().signal;
    await expect(
      result.scheduler.schedule([], signal),
    ).resolves.toBeUndefined();

    // Verify the original scheduler's schedule was actually called.
    expect(realScheduler.scheduleCallCount).toBe(1);
  });

  it('preserves the scheduler receiver when schedulerFactory IS provided', async () => {
    const realScheduler = new ReceiverSensitiveScheduler();

    const ctx = makeCtx();

    const result = await initInteractiveScheduler(
      {
        schedulerFactory: async () => ({
          schedule: async (req: unknown, sig: unknown) =>
            realScheduler.schedule(req, sig),
          dispose: () => {
            void realScheduler.dispose();
          },
        }),
      },
      ctx,
    );

    const signal = new AbortController().signal;
    await expect(
      result.scheduler.schedule([], signal),
    ).resolves.toBeUndefined();

    expect(realScheduler.scheduleCallCount).toBe(1);
  });
});
