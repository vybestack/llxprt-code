/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import type { IContent, ThinkingBlock } from '@vybestack/llxprt-code-core';
import { withJournalStreamHook } from './agentStream/__tests__/journal-stream-hook-fixture.js';
import { renderedOrder } from './agentStream/__tests__/journal-response-test-helpers.js';

const planning: ThinkingBlock = {
  type: 'thinking',
  thought: 'Planning: the response',
  sourceField: 'thought',
};

function response(
  text: string,
  thinking: ThinkingBlock[] = [planning],
): IContent {
  return { speaker: 'ai', blocks: [...thinking, { type: 'text', text }] };
}

describe('journal thinking ownership and ordering', () => {
  it('stores thinking even when reasoning.includeInResponse is false', async () => {
    await withJournalStreamHook(
      [[response('Response')]],
      async ({ agent, submit, items }) => {
        agent.setEphemeralSetting('reasoning.includeInResponse', false);
        await submit('test query');
        const replies = (await items()).filter(
          (item) => item.type === 'gemini',
        );
        expect(replies).toHaveLength(1);
        expect(replies[0]?.thinkingBlocks).toMatchObject([planning]);
      },
    );
  });

  it('starts the next response without carrying previous thinking', async () => {
    await withJournalStreamHook(
      [[response('First response')], [response('Second response', [])]],
      async ({ submit, items }) => {
        await submit('first query');
        const first = (await items()).filter((item) => item.type === 'gemini');
        expect(first[0]?.thinkingBlocks).toMatchObject([planning]);
        await submit('second query');
        const both = (await items()).filter((item) => item.type === 'gemini');
        expect(both.map((item) => item.text)).toStrictEqual([
          'First response',
          'Second response',
        ]);
        expect(both[1]?.thinkingBlocks ?? []).toStrictEqual([]);
      },
    );
  });

  it('preserves thoughts containing only a subject or a description', async () => {
    await withJournalStreamHook(
      [
        [
          response('Response', [
            { ...planning, thought: 'Description only' },
            { ...planning, thought: 'Subject only' },
          ]),
        ],
      ],
      async ({ submit, items }) => {
        await submit('test query');
        const reply = (await items()).find((item) => item.type === 'gemini');
        expect(
          reply?.type === 'gemini' &&
            reply.thinkingBlocks?.map((block) => block.thought),
        ).toStrictEqual(['Description only', 'Subject only']);
      },
    );
  });

  it('owns thinking once before paragraph-separated content', async () => {
    const text = 'Hello world.\n\nThis is a long response.';
    await withJournalStreamHook(
      [[response(text)]],
      async ({ submit, items }) => {
        await submit('test query');
        expect(renderedOrder(await items())).toStrictEqual([
          'thinking:Planning: the response',
          `text:${text}`,
        ]);
      },
    );
  });

  it('does not duplicate thinking when text arrives across several content chunks', async () => {
    await withJournalStreamHook(
      [
        [
          { speaker: 'ai', blocks: [planning] },
          {
            speaker: 'ai',
            blocks: [{ type: 'text', text: 'First segment.\n\n' }],
          },
          {
            speaker: 'ai',
            blocks: [
              { type: 'text', text: 'Second segment.\n\nThird segment.' },
            ],
          },
        ],
      ],
      async ({ submit, items }) => {
        await submit('test query');
        expect(renderedOrder(await items())).toStrictEqual([
          'thinking:Planning: the response',
          'text:First segment.\n\nSecond segment.\n\nThird segment.',
        ]);
      },
    );
  });

  it('keeps thinking above text on the first displayed response', async () => {
    await withJournalStreamHook(
      [[response('Here is the detailed.\n\nResponse text.')]],
      async ({ submit, items }) => {
        await submit('test query');
        const replies = (await items()).filter(
          (item) => item.type === 'gemini',
        );
        expect(replies).toHaveLength(1);
        expect(replies[0]?.thinkingBlocks?.[0]).toMatchObject(planning);
        expect(replies[0]?.text).toBe(
          'Here is the detailed.\n\nResponse text.',
        );
      },
    );
  });
});
