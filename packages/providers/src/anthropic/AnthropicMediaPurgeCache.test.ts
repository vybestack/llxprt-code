/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import type { AnthropicMessage } from './AnthropicMessageNormalizer.js';
import { sanitizeBlockForCacheControl } from './AnthropicRequestBuilder.js';
import {
  attachMediaPurgeCacheControl,
  tagMediaPurgeBoundary,
} from './AnthropicMediaPurgeCache.js';

const logger = { debug: (_fn: () => string): void => {} };

function imageBlock() {
  return {
    type: 'image' as const,
    source: {
      type: 'base64' as const,
      media_type: 'image/png' as const,
      data: 'aW1hZ2U=',
    },
  };
}

function cacheLocations(messages: AnthropicMessage[]): string[] {
  const locations: string[] = [];
  for (
    let messageIndex = 0;
    messageIndex < messages.length;
    messageIndex += 1
  ) {
    const content = messages[messageIndex]?.content;
    if (!Array.isArray(content)) continue;
    for (let blockIndex = 0; blockIndex < content.length; blockIndex += 1) {
      const block = content[blockIndex];
      if ('cache_control' in block) {
        locations.push(`${messageIndex}:${blockIndex}`);
      }
    }
  }
  return locations;
}

describe('attachMediaPurgeCacheControl', () => {
  it('adds a breakpoint at the exact tagged pre-image boundary', () => {
    const boundaryId = Object.freeze({});
    const messages: AnthropicMessage[] = [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'stable prefix' },
          imageBlock(),
          { type: 'text', text: 'suffix' },
        ],
      },
    ];
    tagMediaPurgeBoundary(messages[0], 0, boundaryId);

    const prepared = attachMediaPurgeCacheControl(messages, '5m', logger);

    expect(prepared).toStrictEqual({ boundaryId, preparation: 'added' });
    expect(cacheLocations(messages)).toStrictEqual(['0:0']);
  });

  it('reuses an existing breakpoint only at the exact tagged boundary', () => {
    const boundaryId = Object.freeze({});
    const messages: AnthropicMessage[] = [
      {
        role: 'assistant',
        content: [
          sanitizeBlockForCacheControl(
            { type: 'text', text: 'stable prefix' },
            '5m',
          ),
        ],
      },
      { role: 'user', content: [imageBlock()] },
    ];
    tagMediaPurgeBoundary(messages[0], 0, boundaryId);

    const prepared = attachMediaPurgeCacheControl(messages, '5m', logger);

    expect(prepared).toStrictEqual({ boundaryId, preparation: 'reused' });
    expect(cacheLocations(messages)).toStrictEqual(['0:0']);
  });

  it('does not infer a boundary when the request has no exact tag', () => {
    const messages: AnthropicMessage[] = [
      {
        role: 'user',
        content: [{ type: 'text', text: 'stable prefix' }, imageBlock()],
      },
    ];

    const prepared = attachMediaPurgeCacheControl(messages, '5m', logger);

    expect(prepared).toBeUndefined();
    expect(cacheLocations(messages)).toStrictEqual([]);
  });

  it('rejects a tagged location that is not the exact pre-image boundary', () => {
    const boundaryId = Object.freeze({});
    const messages: AnthropicMessage[] = [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'older prefix' },
          { type: 'text', text: 'exact prefix' },
          imageBlock(),
        ],
      },
    ];
    tagMediaPurgeBoundary(messages[0], 0, boundaryId);

    const prepared = attachMediaPurgeCacheControl(messages, '5m', logger);

    expect(prepared).toBeUndefined();
    expect(cacheLocations(messages)).toStrictEqual([]);
  });

  it('does not consume a fourth message breakpoint when the exact boundary needs a new one', () => {
    const boundaryId = Object.freeze({});
    const cachedText = (text: string) =>
      sanitizeBlockForCacheControl({ type: 'text', text }, '5m');
    const messages: AnthropicMessage[] = [
      { role: 'user', content: [cachedText('one')] },
      { role: 'assistant', content: [cachedText('two')] },
      {
        role: 'user',
        content: [
          cachedText('three'),
          { type: 'text', text: 'exact prefix' },
          imageBlock(),
        ],
      },
    ];
    tagMediaPurgeBoundary(messages[2], 1, boundaryId);

    const prepared = attachMediaPurgeCacheControl(messages, '5m', logger);

    expect(prepared).toBeUndefined();
    expect(cacheLocations(messages)).toStrictEqual(['0:0', '1:0', '2:0']);
  });
});
