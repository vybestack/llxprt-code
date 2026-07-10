/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import type { Content, Part } from '@google/genai';
import type { ContentBlock } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { CompletedToolCall } from '@vybestack/llxprt-code-core/scheduler/types.js';
import {
  filterEagerlyRecordedToolResponses,
  buildToolResponses,
} from '../loopHelpers.js';
import { convertBlocksToParts } from '../../MessageConverter.js';

const alreadyRecordedResponse: Part = {
  functionResponse: {
    id: 'toolu_already_recorded',
    name: 'read_file',
    response: { output: 'old' },
  },
};

const newResponse: Part = {
  functionResponse: {
    id: 'toolu_new',
    name: 'read_file',
    response: { output: 'new' },
  },
};

const responseWithoutId: Part = {
  functionResponse: {
    name: 'read_file',
    response: { output: 'no_id' },
  },
};

const followupText: Part = { text: 'continue' };

const contentWithResponses: Content = {
  role: 'user',
  parts: [
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

  it('handles content with null parts gracefully', () => {
    const contentWithNullParts: Content = {
      role: 'user',
      // Simulate runtime null: SDK data can violate the declared Part[] shape.
      parts: null as unknown as Part[],
    };

    const result = filterEagerlyRecordedToolResponses(
      contentWithNullParts,
      new Set(['toolu_already_recorded']),
    );

    expect(result.content).toBe(contentWithNullParts);
    expect(result.matchedCallIds).toStrictEqual([]);
  });

  it('handles content with an empty parts array gracefully', () => {
    const contentWithEmptyParts: Content = {
      role: 'user',
      parts: [],
    };

    const result = filterEagerlyRecordedToolResponses(
      contentWithEmptyParts,
      new Set(['toolu_already_recorded']),
    );

    expect(result.content).toBe(contentWithEmptyParts);
    expect(result.matchedCallIds).toStrictEqual([]);
  });

  it('removes only the already-recorded function responses', () => {
    const result = filterEagerlyRecordedToolResponses(
      contentWithResponses,
      new Set(['toolu_already_recorded']),
    );

    expect(result.matchedCallIds).toStrictEqual(['toolu_already_recorded']);
    expect(result.content).not.toBeNull();
    expect(result.content?.role).toBe('user');
    expect(result.content?.parts).toStrictEqual([
      newResponse,
      responseWithoutId,
      followupText,
    ]);
  });

  it('removes multiple already-recorded function responses and preserves match order', () => {
    const result = filterEagerlyRecordedToolResponses(
      contentWithResponses,
      new Set(['toolu_already_recorded', 'toolu_new']),
    );

    expect(result.matchedCallIds).toStrictEqual([
      'toolu_already_recorded',
      'toolu_new',
    ]);
    expect(result.content?.role).toBe('user');
    expect(result.content?.parts).toStrictEqual([
      responseWithoutId,
      followupText,
    ]);
  });

  it('does not match functionResponse parts with a non-string id', () => {
    const nonStringIdResponse: Part = {
      functionResponse: {
        // Simulate malformed SDK data to exercise the runtime type guard.
        id: 123 as unknown as string,
        name: 'read_file',
        response: { output: 'bad_id' },
      },
    };
    const content: Content = {
      role: 'user',
      parts: [nonStringIdResponse, newResponse],
    };

    const result = filterEagerlyRecordedToolResponses(
      content,
      new Set(['toolu_new']),
    );

    expect(result.matchedCallIds).toStrictEqual(['toolu_new']);
    expect(result.content?.parts).toStrictEqual([nonStringIdResponse]);
  });

  it('drops the whole content item when all parts were already recorded', () => {
    const content: Content = {
      role: 'user',
      parts: [alreadyRecordedResponse],
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
// convertBlocksToParts media handling (issue #2169)
// ---------------------------------------------------------------------------

describe('convertBlocksToParts media block handling', () => {
  it('converts a base64 media block to an inlineData part', () => {
    const blocks: ContentBlock[] = [
      {
        type: 'media',
        mimeType: 'image/png',
        data: 'iVBORw0KGgo=',
        encoding: 'base64',
      },
    ];
    const parts = convertBlocksToParts(blocks);
    expect(parts).toHaveLength(1);
    expect(parts[0]?.inlineData?.mimeType).toBe('image/png');
    expect(parts[0]?.inlineData?.data).toBe('iVBORw0KGgo=');
  });

  it('converts a url media block to a fileData part', () => {
    const blocks: ContentBlock[] = [
      {
        type: 'media',
        mimeType: 'image/png',
        data: 'https://example.com/image.png',
        encoding: 'url',
      },
    ];
    const parts = convertBlocksToParts(blocks);
    expect(parts).toHaveLength(1);
    expect(parts[0]?.fileData?.fileUri).toBe('https://example.com/image.png');
  });

  it('preserves media blocks alongside tool_response blocks', () => {
    const blocks: ContentBlock[] = [
      {
        type: 'tool_response',
        callId: 'call-1',
        toolName: 'read_file',
        result: { output: 'Binary content provided (1 item(s)).' },
      },
      {
        type: 'media',
        mimeType: 'image/png',
        data: 'iVBORw0KGgo=',
        encoding: 'base64',
      },
    ];
    const parts = convertBlocksToParts(blocks);
    expect(parts).toHaveLength(2);
    expect(parts[0]?.functionResponse?.name).toBe('read_file');
    expect(parts[1]?.inlineData?.data).toBe('iVBORw0KGgo=');
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

    const parts = buildToolResponses(tools, 100_000);

    const images = parts.filter((p) => p.inlineData);
    expect(images).toHaveLength(2);
    expect(parts.some((p) => p.text?.includes('omitted') === true)).toBe(false);
  });

  it('omits images that exceed the cumulative budget', () => {
    const tools = [
      makeImageToolCall('call-1', 'A'.repeat(5000)),
      makeImageToolCall('call-2', 'B'.repeat(5000)),
      makeImageToolCall('call-3', 'C'.repeat(5000)),
    ];

    const parts = buildToolResponses(tools, 11_000);

    const images = parts.filter((p) => p.inlineData);
    expect(images).toHaveLength(2);
    const feedbackPart = parts.find(
      (p) => typeof p.text === 'string' && p.text.includes('omitted'),
    );
    expect(feedbackPart).toBeDefined();
    expect(feedbackPart!.text).toContain('1 image(s)');
    expect(feedbackPart!.text).toContain('read_file');
  });

  it('retains all functionResponse parts even when images are omitted', () => {
    const tools = [
      makeImageToolCall('call-1', 'A'.repeat(100_000)),
      makeImageToolCall('call-2', 'B'.repeat(100_000)),
    ];

    const parts = buildToolResponses(tools, 50_000);

    const responses = parts.filter((p) => p.functionResponse);
    expect(responses).toHaveLength(2);
  });

  it('skips budget enforcement when budgetBytes is 0', () => {
    const tools = [
      makeImageToolCall('call-1', 'A'.repeat(500_000)),
      makeImageToolCall('call-2', 'B'.repeat(500_000)),
    ];

    const parts = buildToolResponses(tools, 0);

    const images = parts.filter((p) => p.inlineData);
    expect(images).toHaveLength(2);
  });
});
