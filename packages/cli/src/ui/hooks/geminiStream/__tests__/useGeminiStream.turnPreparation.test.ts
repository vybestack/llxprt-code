/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, vi } from 'vitest';
import type { Config, ThinkingBlock } from '@vybestack/llxprt-code-core';
import { prepareTurnForQuery } from '../useGeminiStream.js';

const existingThinkingBlock: ThinkingBlock = {
  type: 'thinking',
  thought: 'existing',
  sourceField: 'thought',
};

describe('prepareTurnForQuery', () => {
  it('runs new-turn handler steps in reset -> invalidate -> ensure order', async () => {
    const callOrder: string[] = [];
    const handler = {
      reset: vi.fn(() => {
        callOrder.push('reset');
      }),
      invalidateAuthCache: vi.fn((runtimeId: string) => {
        callOrder.push(`invalidate:${runtimeId}`);
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
    } as unknown as Config;
    const startNewPrompt = vi.fn(() => {
      callOrder.push('startNewPrompt');
    });
    const setThought = vi.fn(() => {
      callOrder.push('setThought');
    });
    const thinkingBlocksRef = { current: [existingThinkingBlock] } as {
      current: ThinkingBlock[];
    };

    await prepareTurnForQuery(
      false,
      config,
      startNewPrompt,
      setThought,
      thinkingBlocksRef,
    );

    expect(callOrder).toStrictEqual([
      'startNewPrompt',
      'setThought',
      'reset',
      'invalidate:runtime-1739',
      'ensure',
    ]);
    expect(thinkingBlocksRef.current).toStrictEqual([]);
    expect(handler.resetSession).not.toHaveBeenCalled();
  });

  it('uses continuation path resetSession branch without resetting new-turn state', async () => {
    const callOrder: string[] = [];
    const handler = {
      reset: vi.fn(() => {
        callOrder.push('reset');
      }),
      invalidateAuthCache: vi.fn((runtimeId: string) => {
        callOrder.push(`invalidate:${runtimeId}`);
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
    } as unknown as Config;
    const startNewPrompt = vi.fn(() => {
      callOrder.push('startNewPrompt');
    });
    const setThought = vi.fn(() => {
      callOrder.push('setThought');
    });
    const thinkingBlocksRef = { current: [existingThinkingBlock] } as {
      current: ThinkingBlock[];
    };

    await prepareTurnForQuery(
      true,
      config,
      startNewPrompt,
      setThought,
      thinkingBlocksRef,
    );

    expect(callOrder).toStrictEqual(['resetSession', 'ensure']);
    expect(handler.reset).not.toHaveBeenCalled();
    expect(handler.invalidateAuthCache).not.toHaveBeenCalled();
    expect(startNewPrompt).not.toHaveBeenCalled();
    expect(setThought).not.toHaveBeenCalled();
    expect(thinkingBlocksRef.current).toStrictEqual([existingThinkingBlock]);
  });

  it('preserves Config method binding when preparing a turn', async () => {
    const callOrder: string[] = [];
    const handler = {
      reset: vi.fn(() => {
        callOrder.push('reset');
      }),
      invalidateAuthCache: vi.fn((runtimeId: string) => {
        callOrder.push(`invalidate:${runtimeId}`);
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
    } as unknown as Config;

    await prepareTurnForQuery(false, config, vi.fn(), vi.fn(), {
      current: [existingThinkingBlock],
    } as { current: ThinkingBlock[] });

    expect(callOrder).toStrictEqual([
      'reset',
      'invalidate:bound-runtime',
      'ensure',
    ]);
  });
});
