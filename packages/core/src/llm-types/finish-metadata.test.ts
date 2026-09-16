/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import { CANONICAL_FINISH_REASONS } from './finishReasons.js';
import { toModelStreamChunk } from './modelEnvelope.js';

describe('provider-owned finish metadata conversion', () => {
  it.each([...CANONICAL_FINISH_REASONS])(
    'preserves provider-selected %s independently of the raw reason',
    (finishReason) => {
      const chunk = toModelStreamChunk({
        speaker: 'ai',
        blocks: [],
        metadata: { finishReason, rawStopReason: 'provider-specific-stop' },
      });
      expect(chunk.finishReason).toBe(finishReason);
      expect(chunk.rawStopReason).toBe('provider-specific-stop');
    },
  );

  it('does not map a raw reason without a provider-selected finish reason', () => {
    const chunk = toModelStreamChunk({
      speaker: 'ai',
      blocks: [],
      metadata: { rawStopReason: 'MAX_TOKENS' },
    });
    expect(chunk.rawStopReason).toBe('MAX_TOKENS');
    expect(chunk.finishReason).toBeUndefined();
  });

  it('does not invent a raw reason', () => {
    const chunk = toModelStreamChunk({
      speaker: 'ai',
      blocks: [],
      metadata: { finishReason: 'stop' },
    });
    expect(chunk.finishReason).toBe('stop');
    expect(chunk.rawStopReason).toBeUndefined();
  });
});
