/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, it, expect } from 'bun:test';
import type { ThinkingBlock } from '@vybestack/llxprt-code-core';
import { withJournalResponse } from './journal-response-test-helpers.js';

async function thoughts(
  blocks: readonly ThinkingBlock[],
): Promise<ThinkingBlock[]> {
  let result: ThinkingBlock[] = [];
  await withJournalResponse(async (fixture) => {
    const arrival = await fixture.open('thinking');
    for (const block of blocks) await arrival.append(block);
    await arrival.seal({});
    result = (await fixture.items()).flatMap((item) =>
      item.type === 'gemini' ? (item.thinkingBlocks ?? []) : [],
    );
  });
  return result;
}

describe('journal identity-aware thinking updates', () => {
  it('replaces incremental snapshots for the same stream id', async () => {
    expect(
      await thoughts([
        {
          type: 'thinking',
          thought: 'Let me think',
          streamId: 'thinking:0',
          streamStatus: 'delta',
        },
        {
          type: 'thinking',
          thought: 'Let me think about this',
          streamId: 'thinking:0',
          streamStatus: 'complete',
        },
      ]),
    ).toMatchObject([
      {
        type: 'thinking',
        thought: 'Let me think about this',
        streamId: 'thinking:0',
        streamStatus: 'complete',
      },
    ]);
  });

  it('keeps distinct prefix-sharing stream ids and unlabelled blocks separate', async () => {
    const result = await thoughts([
      {
        type: 'thinking',
        thought: 'I think',
        streamId: 'first',
        streamStatus: 'complete',
      },
      {
        type: 'thinking',
        thought: 'I think this belongs to a later block',
        streamId: 'second',
        streamStatus: 'complete',
      },
      { type: 'thinking', thought: 'Plan' },
      { type: 'thinking', thought: 'Plan the answer' },
    ]);
    expect(result.map((block) => block.thought)).toStrictEqual([
      'I think',
      'I think this belongs to a later block',
      'Plan',
      'Plan the answer',
    ]);
    expect(result.map((block) => block.streamId)).toStrictEqual([
      'first',
      'second',
      undefined,
      undefined,
    ]);
  });

  it('preserves stream status when a later snapshot omits it', async () => {
    const result = await thoughts([
      {
        type: 'thinking',
        thought: 'Start',
        streamId: 'same',
        streamStatus: 'delta',
      },
      { type: 'thinking', thought: 'Start continuing', streamId: 'same' },
    ]);
    expect(result).toHaveLength(1);
    expect(result[0]?.thought).toBe('Start continuing');
    expect(result[0]?.streamStatus).toBe('delta');
  });

  it('retains completed reasoning when a subsequent iteration starts', async () => {
    const result = await thoughts([
      {
        type: 'thinking',
        thought: 'Why I called the first tool',
        streamId: 'anthropic-thinking:aaa:0:block-0',
        streamStatus: 'complete',
      },
      {
        type: 'thinking',
        thought: 'Now reasoning about the result',
        streamId: 'anthropic-thinking:bbb:0:block-0',
        streamStatus: 'delta',
      },
    ]);
    expect(
      result.map((block) => [
        block.thought,
        block.streamId,
        block.streamStatus,
      ]),
    ).toStrictEqual([
      [
        'Why I called the first tool',
        'anthropic-thinking:aaa:0:block-0',
        'complete',
      ],
      [
        'Now reasoning about the result',
        'anthropic-thinking:bbb:0:block-0',
        'delta',
      ],
    ]);
  });
});
