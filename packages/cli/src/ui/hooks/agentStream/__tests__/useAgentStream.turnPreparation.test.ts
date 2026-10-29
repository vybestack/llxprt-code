/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, vi } from 'bun:test';
import { prepareTurnForQuery } from '../turnPreparation.js';
import { createStreamRuntimeForTest } from './streamRuntimeTestHelper.js';

describe('prepareTurnForQuery', () => {
  it('runs new-turn handler steps in reset -> ensure order', async () => {
    const callOrder: string[] = [];
    const handler = {
      reset: vi.fn(() => {
        callOrder.push('reset');
      }),
      ensureBucketsAuthenticated: vi.fn(async () => {
        callOrder.push('ensure');
      }),
      resetSession: vi.fn(() => {
        callOrder.push('resetSession');
      }),
    };
    const config = {
      getBucketFailoverHandler: () => handler,
      getSessionId: () => 'runtime-1739',
    };
    const startNewPrompt = vi.fn(() => {
      callOrder.push('startNewPrompt');
    });
    const setThought = vi.fn(() => {
      callOrder.push('setThought');
    });

    await prepareTurnForQuery(
      false,
      () => createStreamRuntimeForTest(config).bucketFailover.resetBuckets?.(),
      startNewPrompt,
      setThought,
      () =>
        createStreamRuntimeForTest(
          config,
        ).bucketFailover.resetBucketSession?.(),
      async () => {
        await createStreamRuntimeForTest(
          config,
        ).bucketFailover.ensureBucketsAuthenticated?.();
      },
    );

    expect(callOrder).toStrictEqual([
      'startNewPrompt',
      'setThought',
      'reset',
      'ensure',
    ]);
    expect(handler.resetSession).not.toHaveBeenCalled();
  });

  it('uses continuation path resetSession branch without resetting new-turn state', async () => {
    const callOrder: string[] = [];
    const handler = {
      reset: vi.fn(() => {
        callOrder.push('reset');
      }),
      ensureBucketsAuthenticated: vi.fn(async () => {
        callOrder.push('ensure');
      }),
      resetSession: vi.fn(() => {
        callOrder.push('resetSession');
      }),
    };
    const config = {
      getBucketFailoverHandler: () => handler,
    };
    const startNewPrompt = vi.fn(() => {
      callOrder.push('startNewPrompt');
    });
    const setThought = vi.fn(() => {
      callOrder.push('setThought');
    });

    await prepareTurnForQuery(
      true,
      () => createStreamRuntimeForTest(config).bucketFailover.resetBuckets?.(),
      startNewPrompt,
      setThought,
      () =>
        createStreamRuntimeForTest(
          config,
        ).bucketFailover.resetBucketSession?.(),
      async () => {
        await createStreamRuntimeForTest(
          config,
        ).bucketFailover.ensureBucketsAuthenticated?.();
      },
    );

    expect(callOrder).toStrictEqual(['resetSession', 'ensure']);
    expect(handler.reset).not.toHaveBeenCalled();
    expect(startNewPrompt).not.toHaveBeenCalled();
    expect(setThought).not.toHaveBeenCalled();
  });

  it('preserves Config method binding when preparing a turn', async () => {
    const callOrder: string[] = [];
    const handler = {
      reset: vi.fn(() => {
        callOrder.push('reset');
      }),
      ensureBucketsAuthenticated: vi.fn(async () => {
        callOrder.push('ensure');
      }),
    };
    const config = {
      sessionId: 'bound-runtime',
      getBucketFailoverHandler(this: {
        bucketFailoverHandler: typeof handler;
      }) {
        return this.bucketFailoverHandler;
      },
      getSessionId(this: { sessionId: string }) {
        return this.sessionId;
      },
      bucketFailoverHandler: handler,
    };

    await prepareTurnForQuery(
      false,
      () => createStreamRuntimeForTest(config).bucketFailover.resetBuckets?.(),
      vi.fn(),
      vi.fn(),
      () =>
        createStreamRuntimeForTest(
          config,
        ).bucketFailover.resetBucketSession?.(),
      async () => {
        await createStreamRuntimeForTest(
          config,
        ).bucketFailover.ensureBucketsAuthenticated?.();
      },
    );

    expect(callOrder).toStrictEqual(['reset', 'ensure']);
  });
});
