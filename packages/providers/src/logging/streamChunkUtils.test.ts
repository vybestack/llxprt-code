/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import { extractChunkMetadata } from './streamChunkUtils.js';

describe('stream finish telemetry', () => {
  it('reports the provider-selected finish reason rather than the diagnostic reason', () => {
    const reasons: string[] = [];
    extractChunkMetadata(
      {
        speaker: 'ai',
        blocks: [],
        metadata: { finishReason: 'max_tokens', rawStopReason: 'incomplete' },
      },
      () => undefined,
      (reason) => reasons.push(reason),
      false,
      () => undefined,
    );
    expect(reasons).toStrictEqual(['max_tokens']);
  });

  it('does not turn diagnostic-only metadata into a terminal signal', () => {
    const reasons: string[] = [];
    extractChunkMetadata(
      { speaker: 'ai', blocks: [], metadata: { rawStopReason: 'incomplete' } },
      () => undefined,
      (reason) => reasons.push(reason),
      false,
      () => undefined,
    );
    expect(reasons).toStrictEqual([]);
  });
});
