/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import type {
  ContentBlock,
  IContent,
} from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { filterEagerlyRecordedToolResponses } from '../../streamResponseHelpers.js';

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
