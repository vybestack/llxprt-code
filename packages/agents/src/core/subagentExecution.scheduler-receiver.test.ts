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
 */
class ReceiverSensitiveScheduler {
  private running = false;

  private isRunning(): boolean {
    return this.running;
  }

  schedule = vi.fn(async () => {
    // This call will crash if `this` is wrong.
    if (this.isRunning()) {
      throw new Error('should not be running');
    }
  });

  dispose = vi.fn(async () => {});
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
    // "this.isRunning is not a function".
    const signal = new AbortController().signal;
    await expect(
      result.scheduler.schedule([], signal),
    ).resolves.toBeUndefined();

    // Verify the original scheduler's schedule was actually called.
    expect(realScheduler.schedule).toHaveBeenCalledTimes(1);
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

    expect(realScheduler.schedule).toHaveBeenCalledTimes(1);
  });
});
