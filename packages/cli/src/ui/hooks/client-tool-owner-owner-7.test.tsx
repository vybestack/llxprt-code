/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterEach, describe, expect, it } from 'bun:test';
import { act } from 'react';
import { waitFor } from '@vybestack/llxprt-code-test-utils';
import { createRecordingProvider } from '../../../../agents/src/api/__tests__/helpers/recording-provider.js';
import {
  openClientToolOwner,
  type ClientToolOwner,
} from '../../__tests__/client-tool-owner-agent-fixture.js';
import { renderHook, cleanup } from '../../__tests__/render.js';
import { useAgentEventStream } from './agentStream/useAgentEventStream.js';
import { agentStreamOperations } from './agentStream/__tests__/helpers/agentStreamOperations.js';

const noop = (): void => {};

describe('Agent-owned CLI client tools', () => {
  const closes: Array<() => Promise<void>> = [];

  afterEach(async () => {
    cleanup();
    for (const close of closes.splice(0)) await close();
  });

  // The model's first turn calls the owner's tool; its second turn ends.
  const modelTurns = () =>
    createRecordingProvider({
      alias: 'client-tool-model',
      responses: [
        [
          {
            type: 'tool_call',
            id: 'model-call',
            name: 'mcp__recording__external_record',
            parameters: {},
          },
        ],
        [{ type: 'text', text: 'Finished' }],
      ],
    });

  async function owner(
    name: string,
    modelProvider: ReturnType<typeof modelTurns>,
  ): Promise<ClientToolOwner> {
    const opened = await openClientToolOwner(name, { modelProvider });
    closes.push(opened.close);
    return opened.owner;
  }

  it('renders real model tools without rescheduling them through the client channel', async () => {
    const model = modelTurns();
    const a = await owner('model', model);
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
      expect(model.requests).toHaveLength(2);
    } finally {
      stream.unmount();
    }
  }, 30_000);
});
