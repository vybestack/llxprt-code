/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import type {
  ContentBlock,
  IContent,
  ThinkingBlock,
} from '@vybestack/llxprt-code-core/services/history/IContent.js';
import {
  consolidateTextBlocks,
  prepareHistoryUserInput,
} from './streamResponseHelpers.js';

function thinkingBlock(params: {
  thought: string;
  signature?: string;
  streamId?: string;
  streamStatus?: 'delta' | 'complete';
}): ThinkingBlock {
  return {
    type: 'thinking',
    thought: params.thought,
    ...(params.signature !== undefined ? { signature: params.signature } : {}),
    ...(params.streamId !== undefined ? { streamId: params.streamId } : {}),
    ...(params.streamStatus !== undefined
      ? { streamStatus: params.streamStatus }
      : {}),
    sourceField: 'thinking',
  };
}

function thinkingBlocks(blocks: ContentBlock[]): ThinkingBlock[] {
  return blocks.filter(
    (block): block is ThinkingBlock => block.type === 'thinking',
  );
}

function thinkingTexts(blocks: ContentBlock[]): string[] {
  return thinkingBlocks(blocks).map((block) => block.thought);
}

function thinkingSignatures(blocks: ContentBlock[]): Array<string | undefined> {
  return thinkingBlocks(blocks).map((block) => block.signature);
}

describe('consolidateTextBlocks identity-aware thinking consolidation', () => {
  it('replaces incremental updates for the same stream id with the final signed block', () => {
    const blocks: ContentBlock[] = [
      thinkingBlock({
        thought: 'Analyzing',
        streamId: 'thinking:0',
        streamStatus: 'delta',
      }),
      thinkingBlock({
        thought: 'Analyzing the data',
        streamId: 'thinking:0',
        streamStatus: 'delta',
      }),
      thinkingBlock({
        thought: 'Analyzing the data',
        signature: 'sig-final',
        streamId: 'thinking:0',
        streamStatus: 'complete',
      }),
    ];

    const result = consolidateTextBlocks(blocks);

    expect(thinkingTexts(result)).toStrictEqual(['Analyzing the data']);
    expect(thinkingSignatures(result)).toStrictEqual(['sig-final']);
  });

  it('keeps prefix-overlapping signed blocks distinct when they have different stream ids', () => {
    const blocks: ContentBlock[] = [
      thinkingBlock({
        thought: 'Plan',
        signature: 'sig-one',
        streamId: 'thinking:0',
        streamStatus: 'complete',
      }),
      thinkingBlock({
        thought: 'Plan the second step',
        signature: 'sig-two',
        streamId: 'thinking:1',
        streamStatus: 'complete',
      }),
    ];

    const result = consolidateTextBlocks(blocks);

    expect(thinkingTexts(result)).toStrictEqual([
      'Plan',
      'Plan the second step',
    ]);
    expect(thinkingSignatures(result)).toStrictEqual(['sig-one', 'sig-two']);
  });

  it('does not use text prefixes to merge unsigned blocks without stream identity', () => {
    const blocks: ContentBlock[] = [
      thinkingBlock({ thought: 'I think', signature: 'sig-one' }),
      thinkingBlock({
        thought: 'I think this is separate',
        signature: 'sig-two',
      }),
    ];

    const result = consolidateTextBlocks(blocks);

    expect(thinkingTexts(result)).toStrictEqual([
      'I think',
      'I think this is separate',
    ]);
  });

  it('consolidates non-adjacent interleaved updates by stream id', () => {
    const blocks: ContentBlock[] = [
      thinkingBlock({
        thought: 'First',
        signature: 'sig-first-delta',
        streamId: 'thinking:0',
        streamStatus: 'delta',
      }),
      { type: 'text', text: 'Answer ' },
      thinkingBlock({
        thought: 'Second',
        signature: 'sig-second',
        streamId: 'thinking:1',
        streamStatus: 'complete',
      }),
      { type: 'text', text: 'text' },
      thinkingBlock({
        thought: 'First complete',
        streamId: 'thinking:0',
        streamStatus: 'delta',
      }),
      thinkingBlock({
        thought: 'First complete',
        signature: 'sig-first-final',
        streamId: 'thinking:0',
        streamStatus: 'complete',
      }),
    ];

    const result = consolidateTextBlocks(blocks);

    expect(
      result.map((block) => {
        if (block.type === 'thinking') {
          return block.thought;
        }
        if (block.type === 'text') {
          return block.text;
        }
        return block.type;
      }),
    ).toStrictEqual(['First complete', 'Answer ', 'Second', 'text']);
    expect(thinkingSignatures(result)).toStrictEqual([
      'sig-first-final',
      'sig-second',
    ]);
  });

  it('preserves prior metadata when a same-stream update omits it', () => {
    const blocks: ContentBlock[] = [
      {
        ...thinkingBlock({
          thought: 'Signed partial',
          signature: 'sig-prior',
          streamId: 'thinking:0',
          streamStatus: 'delta',
        }),
        isHidden: true,
      },
      thinkingBlock({
        thought: 'Signed partial plus more',
        streamId: 'thinking:0',
        streamStatus: 'delta',
      }),
    ];

    const result = consolidateTextBlocks(blocks);
    const [thinking] = thinkingBlocks(result);

    expect(thinking.thought).toBe('Signed partial plus more');
    expect(thinking.signature).toBe('sig-prior');
    expect(thinking.isHidden).toBe(true);
    expect(thinking.sourceField).toBe('thinking');
  });

  it('preserves prior thought text for an empty metadata-only update', () => {
    const blocks: ContentBlock[] = [
      thinkingBlock({
        thought: 'Signed partial',
        signature: 'sig-prior',
        streamId: 'thinking:0',
        streamStatus: 'delta',
      }),
      thinkingBlock({
        thought: '',
        streamId: 'thinking:0',
        streamStatus: 'complete',
      }),
    ];

    const result = consolidateTextBlocks(blocks);

    expect(thinkingTexts(result)).toStrictEqual(['Signed partial']);
    expect(thinkingSignatures(result)).toStrictEqual(['sig-prior']);
  });

  it('does not mutate input blocks', () => {
    const firstText: ContentBlock = { type: 'text', text: 'Hello' };
    const secondText: ContentBlock = { type: 'text', text: ' world' };
    const firstThought = thinkingBlock({
      thought: 'Partial',
      streamId: 'thinking:0',
      streamStatus: 'delta',
    });
    const finalThought = thinkingBlock({
      thought: 'Partial thought',
      signature: 'sig123',
      streamId: 'thinking:0',
      streamStatus: 'complete',
    });
    const blocks = [firstText, secondText, firstThought, finalThought];

    const result = consolidateTextBlocks(blocks);

    expect(firstText).toStrictEqual({ type: 'text', text: 'Hello' });
    expect(firstThought.thought).toBe('Partial');
    expect(firstThought.signature).toBeUndefined();
    expect(result).toHaveLength(2);
    expect(result[0]).toStrictEqual({ type: 'text', text: 'Hello world' });
    expect(thinkingTexts(result)).toStrictEqual(['Partial thought']);
  });

  it('returns an empty array for empty input', () => {
    expect(consolidateTextBlocks([])).toStrictEqual([]);
  });
});

describe('prepareHistoryUserInput', () => {
  it('keeps userInputWasArray aligned with filtered empty array history input when a single eager tool response is fully removed', () => {
    const userInput: IContent = {
      speaker: 'tool',
      blocks: [
        {
          type: 'tool_response',
          callId: 'call-1',
          toolName: 'tool',
          result: { output: 'ok' },
        },
      ],
    };

    const prepared = prepareHistoryUserInput(userInput, new Set(['call-1']));

    expect(prepared.historyUserInput).toStrictEqual([]);
    expect(prepared.userInputFlags).toStrictEqual({
      userInputWasArray: true,
      userInputWasFunctionResponse: true,
    });
  });
});
