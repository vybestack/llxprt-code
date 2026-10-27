/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import { act } from 'react';
import type { ThinkingBlock } from '@vybestack/llxprt-code-core';
import { waitFor } from '../../__tests__/render.js';
import { StreamingState } from '../types.js';
import { withJournalResponse } from './agentStream/__tests__/journal-response-test-helpers.js';
import { withJournalStreamHook } from './agentStream/__tests__/journal-stream-hook-fixture.js';
import {
  gate,
  scriptProvider,
} from './agentStream/__tests__/journal-provider-test-helpers.js';

const thought: ThinkingBlock = {
  type: 'thinking',
  thought: 'Analyzing request: First thought process',
  sourceField: 'thought',
};

describe('journal-backed streaming thinking', () => {
  it('makes the newest thought visible without overwriting earlier recorded thinking', async () => {
    await withJournalResponse(async (fixture) => {
      const arrival = await fixture.open('live');
      await arrival.append({ ...thought, thought: 'First: thought' });
      await fixture.history.waitForCommit();
      const first = (await fixture.items()).filter(
        (item) => item.type === 'gemini',
      );
      expect(first.at(-1)?.thinkingBlocks?.at(-1)?.thought).toBe(
        'First: thought',
      );
      await arrival.append({ ...thought, thought: 'Second: thought' });
      await arrival.seal({});
      const second = (await fixture.items()).filter(
        (item) => item.type === 'gemini',
      );
      expect(
        second.at(-1)?.thinkingBlocks?.map((block) => block.thought),
      ).toStrictEqual(['First: thought', 'Second: thought']);
    });
  });

  it('updates one thinking stream from snapshots without appending duplicate prefixes', async () => {
    await withJournalResponse(async (fixture) => {
      const arrival = await fixture.open('snapshots');
      await arrival.append({
        ...thought,
        thought: 'Analyzing',
        streamId: 'reasoning',
      });
      await arrival.append({
        ...thought,
        thought: 'Analyzing request',
        streamId: 'reasoning',
      });
      await arrival.append({ type: 'text', text: 'Response text' });
      await arrival.seal({});
      const replies = (await fixture.items()).filter(
        (item) => item.type === 'gemini',
      );
      expect(replies).toHaveLength(1);
      expect(replies[0]?.thinkingBlocks).toMatchObject([
        {
          type: 'thinking',
          thought: 'Analyzing request',
          sourceField: 'thought',
        },
      ]);
      expect(replies[0]?.text).toBe('Response text');
    });
  });

  it('exposes recorded thinking before any response text arrives', async () => {
    await withJournalStreamHook([], async ({ agent, state, items }) => {
      const entered = gate();
      const finish = gate();
      const provider = scriptProvider(agent, async function* () {
        yield {
          speaker: 'ai',
          blocks: [
            { ...thought, thought: 'Streaming thought: before content' },
          ],
        };
        entered.release();
        await finish.promise;
        yield {
          speaker: 'ai',
          blocks: [{ type: 'text', text: 'Now content' }],
        };
      });
      let running: Promise<void> = Promise.resolve();
      act(() => {
        running = state().submitQuery('test query');
      });
      try {
        await entered.promise;
        const live = (await items()).filter((item) => item.type === 'gemini');
        expect(
          live
            .flatMap((item) => item.thinkingBlocks ?? [])
            .map((block) => block.thought),
        ).toStrictEqual(['Streaming thought: before content']);
        expect(live.map((item) => item.text).join('')).toBe('');
        expect(state().pendingHistoryItems).toStrictEqual([]);
      } finally {
        finish.release();
        await act(async () => {
          await running;
        });
        provider.mockRestore();
      }
      expect(
        (await items()).some(
          (item) => item.type === 'gemini' && item.text === 'Now content',
        ),
      ).toBe(true);
    });
  });

  it('preserves separate thought blocks in arrival order', async () => {
    await withJournalStreamHook(
      [
        [
          {
            speaker: 'ai',
            blocks: [
              thought,
              { ...thought, thought: 'Second thought' },
              { type: 'text', text: 'Response' },
            ],
          },
        ],
      ],
      async ({ submit, items }) => {
        await submit('test query');
        const reply = (await items()).find((item) => item.type === 'gemini');
        expect(
          reply?.type === 'gemini' &&
            reply.thinkingBlocks?.map((block) => block.thought),
        ).toStrictEqual([thought.thought, 'Second thought']);
      },
    );
  });

  it('preserves the ThinkingBlock structure and source field through projection', async () => {
    await withJournalStreamHook(
      [
        [
          {
            speaker: 'ai',
            blocks: [thought, { type: 'text', text: 'Response' }],
          },
        ],
      ],
      async ({ submit, items }) => {
        await submit('test query');
        const reply = (await items()).find((item) => item.type === 'gemini');
        expect(reply?.type === 'gemini' && reply.thinkingBlocks).toMatchObject([
          thought,
        ]);
      },
    );
  });

  it('stores thinking when reasoning.includeInResponse is true', async () => {
    await withJournalStreamHook(
      [
        [
          {
            speaker: 'ai',
            blocks: [thought, { type: 'text', text: 'Response' }],
          },
        ],
      ],
      async ({ agent, submit, items }) => {
        agent.setEphemeralSetting('reasoning.includeInResponse', true);
        await submit('test query');
        const reply = (await items()).find((item) => item.type === 'gemini');
        expect(
          reply?.type === 'gemini' && reply.thinkingBlocks?.[0]?.thought,
        ).toBe(thought.thought);
      },
    );
  });

  it('drains queued prompts once each and in submission order', async () => {
    await withJournalStreamHook([], async ({ agent, state, items }) => {
      const releases = [gate(), gate(), gate()];
      const entered = [gate(), gate(), gate()];
      let calls = 0;
      const provider = scriptProvider(agent, async function* () {
        const index = calls++;
        entered[index].release();
        await releases[index].promise;
        yield {
          speaker: 'ai',
          blocks: [{ type: 'text', text: `Reply ${index}` }],
        };
      });
      let first: Promise<void> = Promise.resolve();
      act(() => {
        first = state().submitQuery('first prompt');
      });
      try {
        await entered[0].promise;
        await act(async () => {
          await state().submitQuery('second prompt');
          await state().submitQuery('third prompt');
        });
        expect(calls).toBe(1);
        act(() => releases[0].release());
        await entered[1].promise;
        expect(calls).toBe(2);
        act(() => releases[1].release());
        await entered[2].promise;
        expect(calls).toBe(3);
      } finally {
        releases.forEach((entry) => entry.release());
        await act(async () => {
          await first;
        });
        await waitFor(() =>
          expect(state().streamingState).toBe(StreamingState.Idle),
        );
        provider.mockRestore();
      }
      expect(
        (await items())
          .filter((item) => item.type === 'gemini')
          .map((item) => item.text),
      ).toStrictEqual(['Reply 0', 'Reply 1', 'Reply 2']);
    });
  });
});
