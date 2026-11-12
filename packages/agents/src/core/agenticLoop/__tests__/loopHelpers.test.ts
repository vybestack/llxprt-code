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
import { convertToFunctionResponse } from '@vybestack/llxprt-code-core/utils/generateContentResponseUtilities.js';
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
    const { images, passesThroughAllImagesWhenUnderBudgetObservation1 } =
      observePassesThroughAllImagesWhenUnderBudget();
    expect(images).toHaveLength(2);
    expect(passesThroughAllImagesWhenUnderBudgetObservation1).toBe(false);
  });

  const observePassesThroughAllImagesWhenUnderBudget = () => {
    const tools = [
      makeImageToolCall('call-1', 'A'.repeat(1000)),
      makeImageToolCall('call-2', 'B'.repeat(1000)),
    ];

    const blocks = buildToolResponses(tools, 100_000);

    const images = blocks.filter((b) => b.type === 'media');

    const passesThroughAllImagesWhenUnderBudgetObservation1 = blocks.some(
      (b) => b.type === 'text' && b.text.includes('omitted'),
    );
    return {
      images,
      passesThroughAllImagesWhenUnderBudgetObservation1,
    };
  };

  it('omits images that exceed the cumulative budget', () => {
    const {
      images,
      feedbackBlock,
      omitsImagesThatExceedTheCumulativeBudgetObservation1,
      omitsImagesThatExceedTheCumulativeBudgetObservation2,
    } = observeOmitsImagesThatExceedTheCumulativeBudget();
    expect(images).toHaveLength(2);
    expect(feedbackBlock).toBeDefined();
    expect(omitsImagesThatExceedTheCumulativeBudgetObservation1).toContain(
      '1 image(s)',
    );
    expect(omitsImagesThatExceedTheCumulativeBudgetObservation2).toContain(
      'read_file',
    );
  });

  const observeOmitsImagesThatExceedTheCumulativeBudget = () => {
    const tools = [
      makeImageToolCall('call-1', 'A'.repeat(5000)),
      makeImageToolCall('call-2', 'B'.repeat(5000)),
      makeImageToolCall('call-3', 'C'.repeat(5000)),
    ];

    const blocks = buildToolResponses(tools, 11_000);

    const images = blocks.filter((b) => b.type === 'media');

    const feedbackBlock = blocks.find(
      (b) => b.type === 'text' && b.text.includes('omitted'),
    );

    const omitsImagesThatExceedTheCumulativeBudgetObservation1 =
      feedbackBlock!.type === 'text' && feedbackBlock.text;
    const omitsImagesThatExceedTheCumulativeBudgetObservation2 =
      feedbackBlock!.type === 'text' && feedbackBlock.text;
    return {
      images,
      feedbackBlock,
      omitsImagesThatExceedTheCumulativeBudgetObservation1,
      omitsImagesThatExceedTheCumulativeBudgetObservation2,
    };
  };

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

// ---------------------------------------------------------------------------
// buildToolResponses model-visible batch admission (issue #3984)
// ---------------------------------------------------------------------------

/** Mirrors what the scheduler records: real convertToFunctionResponse output. */
function completedReadFile(
  callId: string,
  mimeType: string,
  encodedLength: number,
): CompletedToolCall {
  return {
    status: 'error',
    request: {
      callId,
      name: 'read_file',
      args: {},
      isClientInitiated: false,
      prompt_id: 'issue3984',
    },
    response: {
      callId,
      responseParts: convertToFunctionResponse('read_file', callId, [
        { inlineData: { mimeType, data: 'A'.repeat(encodedLength) } },
      ]),
      resultDisplay: undefined,
      error: undefined,
      errorType: undefined,
    },
  };
}

function feedbackText(blocks: readonly ContentBlock[]): string {
  return blocks.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('\n');
}

describe('buildToolResponses next-message admission', () => {
  it('answers every call and tells the model to read fewer images when a batch overflows', () => {
    const tools = [
      completedReadFile('call-a', 'image/png', 4000),
      completedReadFile('call-b', 'image/png', 4000),
      completedReadFile('call-c', 'image/png', 4000),
    ];

    const next = buildToolResponses(tools, 6000);

    const answered = next.flatMap((b) =>
      b.type === 'tool_response' ? [b.callId] : [],
    );
    expect(answered).toStrictEqual(['call-a', 'call-b', 'call-c']);
    expect(next.filter((b) => b.type === 'media')).toHaveLength(1);
    const feedback = feedbackText(next);
    expect(feedback).toContain('6000');
    expect(feedback).toContain('call-b');
    expect(feedback).toContain('call-c');
    expect(feedback).not.toContain('call-a');
    expect(feedback.toLowerCase()).toContain('fewer');
  });

  it('tells the model an image larger than the whole budget cannot fit alone', () => {
    const tools = [
      completedReadFile('call-small', 'image/png', 1000),
      completedReadFile('call-huge', 'image/png', 9000),
    ];

    const next = buildToolResponses(tools, 6000);

    const answered = next.flatMap((b) =>
      b.type === 'tool_response' ? [b.callId] : [],
    );
    expect(answered).toStrictEqual(['call-small', 'call-huge']);
    const feedback = feedbackText(next).toLowerCase();
    expect(feedback).toContain('call-huge');
    expect(feedback).toContain('cannot fit alone');
    expect(feedback).toContain('9000');
    expect(feedback).not.toContain('fewer');
    expect(feedback).not.toContain('re-read');
  });

  it('does not count or omit non-image media', () => {
    const tools = [
      completedReadFile('call-pdf', 'application/pdf', 40_000),
      completedReadFile('call-img', 'image/png', 1000),
    ];

    const next = buildToolResponses(tools, 6000);

    expect(next.filter((b) => b.type === 'media')).toHaveLength(2);
    expect(feedbackText(next)).toBe('');
  });
});
