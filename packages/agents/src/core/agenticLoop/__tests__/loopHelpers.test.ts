/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import type {
  ContentBlock,
  IContent,
} from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { CompletedToolCall } from '@vybestack/llxprt-code-core/scheduler/types.js';
import { filterEagerlyRecordedToolResponses } from '../../streamResponseHelpers.js';
import { buildToolResponses } from '../loopHelpers.js';

const alreadyRecordedResponse: ContentBlock = {
  type: 'tool_response',
  callId: 'toolu_already_recorded',
  toolName: 'read_file',
  result: { output: 'old' },
};

const newResponse: ContentBlock = {
  type: 'tool_response',
  callId: 'toolu_new',
  toolName: 'read_file',
  result: { output: 'new' },
};

const responseWithoutId: ContentBlock = {
  type: 'tool_response',
  callId: '',
  toolName: 'read_file',
  result: { output: 'no_id' },
};

const followupText: ContentBlock = { type: 'text', text: 'continue' };

const contentWithResponses: IContent = {
  speaker: 'tool',
  blocks: [
    alreadyRecordedResponse,
    newResponse,
    responseWithoutId,
    followupText,
  ],
};

describe('filterEagerlyRecordedToolResponses', () => {
  it('returns the original content when no eager call ids are tracked', () => {
    const result = filterEagerlyRecordedToolResponses(
      contentWithResponses,
      new Set<string>(),
    );

    expect(result.content).toBe(contentWithResponses);
    expect(result.matchedCallIds).toStrictEqual([]);
  });

  it('returns the original content when tracked call ids do not match', () => {
    const result = filterEagerlyRecordedToolResponses(
      contentWithResponses,
      new Set(['toolu_missing']),
    );

    expect(result.content).toBe(contentWithResponses);
    expect(result.matchedCallIds).toStrictEqual([]);
  });

  it('handles content with an empty blocks array gracefully', () => {
    const contentWithEmptyBlocks: IContent = {
      speaker: 'tool',
      blocks: [],
    };

    const result = filterEagerlyRecordedToolResponses(
      contentWithEmptyBlocks,
      new Set(['toolu_already_recorded']),
    );

    expect(result.content).toBe(contentWithEmptyBlocks);
    expect(result.matchedCallIds).toStrictEqual([]);
  });

  it('removes only the already-recorded tool responses', () => {
    const result = filterEagerlyRecordedToolResponses(
      contentWithResponses,
      new Set(['toolu_already_recorded']),
    );

    expect(result.matchedCallIds).toStrictEqual(['toolu_already_recorded']);
    expect(result.content).not.toBeNull();
    expect(result.content?.speaker).toBe('tool');
    expect(result.content?.blocks).toStrictEqual([
      newResponse,
      responseWithoutId,
      followupText,
    ]);
  });

  it('removes multiple already-recorded tool responses and preserves match order', () => {
    const result = filterEagerlyRecordedToolResponses(
      contentWithResponses,
      new Set(['toolu_already_recorded', 'toolu_new']),
    );

    expect(result.matchedCallIds).toStrictEqual([
      'toolu_already_recorded',
      'toolu_new',
    ]);
    expect(result.content?.speaker).toBe('tool');
    expect(result.content?.blocks).toStrictEqual([
      responseWithoutId,
      followupText,
    ]);
  });

  it('does not match tool response blocks with a non-string id', () => {
    const nonStringIdResponse: ContentBlock = {
      type: 'tool_response',
      callId: 123 as unknown as string,
      toolName: 'read_file',
      result: { output: 'bad_id' },
    };
    const content: IContent = {
      speaker: 'tool',
      blocks: [nonStringIdResponse, newResponse],
    };

    const result = filterEagerlyRecordedToolResponses(
      content,
      new Set(['toolu_new']),
    );

    expect(result.matchedCallIds).toStrictEqual(['toolu_new']);
    expect(result.content?.blocks).toStrictEqual([nonStringIdResponse]);
  });

  it('drops the whole content item when all blocks were already recorded', () => {
    const content: IContent = {
      speaker: 'tool',
      blocks: [alreadyRecordedResponse],
    };

    const result = filterEagerlyRecordedToolResponses(
      content,
      new Set(['toolu_already_recorded']),
    );

    expect(result.content).toBeNull();
    expect(result.matchedCallIds).toStrictEqual(['toolu_already_recorded']);
  });
});

// ---------------------------------------------------------------------------
// buildToolResponses image budget enforcement (issue #2169)
// ---------------------------------------------------------------------------

function makeImageToolCall(
  callId: string,
  base64Data: string,
  mimeType = 'image/png',
): CompletedToolCall {
  return {
    request: {
      callId,
      name: 'read_file',
      args: {},
      isClientInitiated: false,
      prompt_id: 'test',
    },
    status: 'success',
    response: {
      callId,
      responseParts: [
        {
          type: 'tool_response',
          callId,
          toolName: 'read_file',
          result: { output: 'Binary content provided (1 item(s)).' },
        },
        {
          type: 'media' as const,
          mimeType,
          data: base64Data,
          encoding: 'base64' as const,
        },
      ],
      resultDisplay: 'Read image file',
      error: undefined,
      errorType: undefined,
      agentId: 'main',
    },
  } as unknown as CompletedToolCall;
}

describe('buildToolResponses image budget enforcement', () => {
  it('passes through all images when under budget', () => {
    const tools = [
      makeImageToolCall('call-1', 'A'.repeat(1000)),
      makeImageToolCall('call-2', 'B'.repeat(1000)),
    ];

    const blocks = buildToolResponses(tools, 100_000);

    const images = blocks.filter((b) => b.type === 'media');
    expect(images).toHaveLength(2);
    expect(
      blocks.some((b) => b.type === 'text' && b.text.includes('omitted')),
    ).toBe(false);
  });

  it('omits images that exceed the cumulative budget', () => {
    const tools = [
      makeImageToolCall('call-1', 'A'.repeat(5000)),
      makeImageToolCall('call-2', 'B'.repeat(5000)),
      makeImageToolCall('call-3', 'C'.repeat(5000)),
    ];

    const blocks = buildToolResponses(tools, 11_000);

    const images = blocks.filter((b) => b.type === 'media');
    expect(images).toHaveLength(2);
    const feedbackBlock = blocks.find(
      (b) => b.type === 'text' && b.text.includes('omitted'),
    );
    expect(feedbackBlock).toBeDefined();
    expect(feedbackBlock!.type === 'text' && feedbackBlock.text).toContain(
      '1 image(s)',
    );
    expect(feedbackBlock!.type === 'text' && feedbackBlock.text).toContain(
      'read_file',
    );
  });

  it('retains all tool_response blocks even when images are omitted', () => {
    const tools = [
      makeImageToolCall('call-1', 'A'.repeat(100_000)),
      makeImageToolCall('call-2', 'B'.repeat(100_000)),
    ];

    const blocks = buildToolResponses(tools, 50_000);

    const responses = blocks.filter((b) => b.type === 'tool_response');
    expect(responses).toHaveLength(2);
  });

  it('skips budget enforcement when budgetBytes is 0', () => {
    const tools = [
      makeImageToolCall('call-1', 'A'.repeat(500_000)),
      makeImageToolCall('call-2', 'B'.repeat(500_000)),
    ];

    const blocks = buildToolResponses(tools, 0);

    const images = blocks.filter((b) => b.type === 'media');
    expect(images).toHaveLength(2);
  });
});
