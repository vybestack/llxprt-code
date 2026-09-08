/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Issue #3130 (AC-3): usage reported mid-stream must still reach the record.
 *
 * Providers do not all report usage on the final chunk. Taking the last chunk
 * verbatim recorded a billed request as having cost nothing, which is exactly
 * the blind spot this log exists to remove.
 */

import { describe, it, expect } from 'bun:test';
import { contentForTelemetryPreservingUsage } from './streamRequestHelpers.js';
import type { ModelStreamChunk } from '@vybestack/llxprt-code-core/llm-types/index.js';
import type { UsageStats } from '@vybestack/llxprt-code-core/services/history/IContent.js';

const USAGE: UsageStats = {
  promptTokens: 4000,
  completionTokens: 25,
  totalTokens: 4025,
};

function chunk(text: string, usage?: UsageStats): ModelStreamChunk {
  const content: ModelStreamChunk['content'] = {
    speaker: 'ai',
    blocks: [{ type: 'text', text }],
  };
  return usage === undefined ? { content } : { content, usage };
}

describe('mid-stream usage preservation (issue #3130)', () => {
  it('carries usage forward when a later chunk reports none', () => {
    const withUsage = contentForTelemetryPreservingUsage(
      chunk('first', USAGE),
      undefined,
    );
    const afterwards = contentForTelemetryPreservingUsage(
      chunk('second'),
      withUsage,
    );

    expect(afterwards.metadata?.usage).toStrictEqual(USAGE);
  });

  it('prefers the newest reported usage over an older one', () => {
    const older = contentForTelemetryPreservingUsage(
      chunk('first', USAGE),
      undefined,
    );
    const newerUsage: UsageStats = {
      promptTokens: 4100,
      completionTokens: 40,
      totalTokens: 4140,
    };
    const newer = contentForTelemetryPreservingUsage(
      chunk('second', newerUsage),
      older,
    );

    expect(newer.metadata?.usage).toStrictEqual(newerUsage);
  });

  it('reports no usage when the provider never sent any', () => {
    const first = contentForTelemetryPreservingUsage(chunk('a'), undefined);
    const second = contentForTelemetryPreservingUsage(chunk('b'), first);

    expect(second.metadata?.usage).toBeUndefined();
  });

  it('keeps the newest chunk content, not the chunk that carried usage', () => {
    const withUsage = contentForTelemetryPreservingUsage(
      chunk('first', USAGE),
      undefined,
    );
    const afterwards = contentForTelemetryPreservingUsage(
      chunk('second'),
      withUsage,
    );

    expect(afterwards.blocks).toStrictEqual([{ type: 'text', text: 'second' }]);
  });
});
