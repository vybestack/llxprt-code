/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect, vi } from 'bun:test';
import { act } from 'react';
import type { IContent } from '@vybestack/llxprt-code-core';
import { renderHook } from '../../../../__tests__/render.js';
import { useSessionInitialization } from './useSessionInitialization.js';
import { useRetractableHistory } from '../../../hooks/useHistoryManager.js';
import { createTurnStore } from '../../../stores/turn/turnStore.js';

// Regression for #854: the restored transcript loads asynchronously. Rows
// that reach the history before the load finishes (the SessionStart hook
// message, the first prompt and its reply) must survive it, with the
// restored rows ahead of them.

const uiRuntime = {
  memory: {
    getLlxprtMdFileCount: () => 0,
    getCoreMemoryFileCount: () => 0,
  },
  agentClientSource: { getAgentClient: () => null },
  ephemeral: { getEphemeralSetting: () => undefined },
} as never;

const agent = {
  hooks: { triggerSessionStart: vi.fn().mockResolvedValue({}) },
} as never;

function restoredRows(): IContent[] {
  return [
    { speaker: 'human', blocks: [{ type: 'text', text: 'restored question' }] },
    { speaker: 'ai', blocks: [{ type: 'text', text: 'restored answer' }] },
  ];
}

describe('useSessionInitialization resumed history arrivals', () => {
  it('keeps rows added while the restored transcript loads, after the restored rows', async () => {
    let releaseLoad = (): void => {
      throw new Error('Load gate not initialized');
    };
    const loadGate = new Promise<void>((resolve) => {
      releaseLoad = resolve;
    });
    const turnStore = createTurnStore();
    const rows = restoredRows();

    const { result } = renderHook(() => {
      const history = useRetractableHistory(turnStore);
      useSessionInitialization({
        uiRuntime,
        agent,
        addItem: history.addItem,
        prependHistory: history.prependHistory,
        resumedBoot: {
          async *streamRows(): AsyncIterable<IContent> {
            await loadGate;
            yield* rows;
          },
        },
      });
      return history;
    });

    act(() => {
      result.current.addItem({ type: 'info', text: 'hook message' }, 1);
      result.current.addItem({ type: 'user', text: 'first prompt' }, 2);
      result.current.addItem({ type: 'gemini', text: 'first reply' }, 3);
    });
    expect(result.current.history.map((item) => item.text)).toStrictEqual([
      'hook message',
      'first prompt',
      'first reply',
    ]);

    await act(async () => {
      releaseLoad();
    });

    expect(result.current.history.map((item) => item.text)).toStrictEqual([
      'restored question',
      'restored answer',
      'hook message',
      'first prompt',
      'first reply',
    ]);
  });
});
