/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import type { Content, Part } from '@google/genai';
import { filterEagerlyRecordedToolResponses } from '../loopHelpers.js';

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
