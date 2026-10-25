/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterEach, describe, expect, it } from 'bun:test';
import { act } from 'react';
import { type Agent } from '@vybestack/llxprt-code-agents';
import { waitFor } from '@vybestack/llxprt-code-test-utils';
import {
  openClientToolOwner,
  type ClientToolOwner,
} from '../../__tests__/client-tool-owner-agent-fixture.js';
import { renderHook, cleanup } from '../../__tests__/render.js';
import { useAgentEventStream } from './agentStream/useAgentEventStream.js';
import { agentStreamOperations } from './agentStream/__tests__/helpers/agentStreamOperations.js';

const noop = (): void => {};

async function historyText(agent: Agent): Promise<string> {
  return JSON.stringify(await agent.getHistory());
}

describe('Agent-owned CLI client tools', () => {
  const closes: Array<() => Promise<void>> = [];

  afterEach(async () => {
    cleanup();
    for (const close of closes.splice(0)) await close();
  });

  async function owner(name: string): Promise<ClientToolOwner> {
    const opened = await openClientToolOwner(name, {
      replay: 'model-then-finished',
    });
    closes.push(opened.close);
    return opened.owner;
  }

  it('renders real model tools without rescheduling them through the client channel', async () => {
    const a = await owner('model');
    const display: unknown[] = [];
    const operations = agentStreamOperations(a.agent);
    const stream = renderHook(() =>
      useAgentEventStream({
        ...operations,
        addItem: (item) => {
          display.push(item);
          return display.length;
        },
        processAgentEventRef: { current: null },
        flushPendingHistoryItem: noop,
        clearPendingHistoryItem: noop,
        performMemoryRefresh: async () => {},
        onToolCallsUpdate: a.hook.result.current[6],
        outputUpdateHandler: a.hook.result.current[7],
      }),
    );
    try {
      const running = stream.result.current.runStream(
        'Read the external record',
        new AbortController().signal,
        'model-prompt',
      );
      await a.entered();
      await waitFor(() =>
        expect(a.hook.result.current[0][0]?.request.callId).toBe('model-call'),
      );
      await a.release();
      await act(async () => {
        await running;
      });
      expect(await a.effects()).toStrictEqual(['model']);
      expect(a.completed).toStrictEqual([]);
      expect(JSON.stringify(display)).toContain('model-call');
      expect(await historyText(a.agent)).toContain('Finished');
    } finally {
      stream.unmount();
    }
  }, 30_000);
});
