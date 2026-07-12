/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral tests for issue #2329: surface Claude Fable 5 safety-classifier
 * refusals as a distinguishable finish reason.
 *
 * Tests through the neutral toModelStreamChunk() entry point — no mock
 * theater. A refusal IContent must produce a ModelOutput with finishReason
 * 'refusal' (distinguishable from a normal stop) and the raw provider stop
 * reason preserved on rawStopReason.
 *
 * Migrated in P13 from the deleted convertIContentToResponse to the neutral
 * toModelStreamChunk path (@plan:PLAN-20260707-AGENTNEUTRAL.P13).
 */

import { describe, it, expect } from 'vitest';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { toModelStreamChunk } from '@vybestack/llxprt-code-core/llm-types/index.js';

describe('Issue 2329: refusal finish-reason mapping @issue:2329', () => {
  it('maps refusal metadata.stopReason to refusal finishReason', () => {
    const icontent: IContent = {
      speaker: 'ai',
      blocks: [{ type: 'text', text: 'I cannot help with that.' }],
      metadata: { stopReason: 'refusal' },
    };

    const chunk = toModelStreamChunk(icontent);

    expect(chunk.finishReason).toBe('refusal');
  });

  it('preserves the raw provider stop reason on rawStopReason for refusal', () => {
    const icontent: IContent = {
      speaker: 'ai',
      blocks: [{ type: 'text', text: 'declined' }],
      metadata: { stopReason: 'refusal' },
    };

    const chunk = toModelStreamChunk(icontent);

    expect(chunk.rawStopReason).toBe('refusal');
  });

  it('maps a normal end_turn to stop and preserves rawStopReason end_turn', () => {
    const icontent: IContent = {
      speaker: 'ai',
      blocks: [{ type: 'text', text: 'Here is the answer.' }],
      metadata: { stopReason: 'end_turn' },
    };

    const chunk = toModelStreamChunk(icontent);

    expect(chunk.finishReason).toBe('stop');
    expect(chunk.rawStopReason).toBe('end_turn');
  });

  it('maps max_tokens to max_tokens and preserves rawStopReason', () => {
    const icontent: IContent = {
      speaker: 'ai',
      blocks: [{ type: 'text', text: 'truncated' }],
      metadata: { stopReason: 'max_tokens' },
    };

    const chunk = toModelStreamChunk(icontent);

    expect(chunk.finishReason).toBe('max_tokens');
    expect(chunk.rawStopReason).toBe('max_tokens');
  });

  it('does not set finishReason when no termination reason is present', () => {
    const icontent: IContent = {
      speaker: 'ai',
      blocks: [{ type: 'text', text: 'text' }],
      metadata: {},
    };

    const chunk = toModelStreamChunk(icontent);

    expect(chunk.finishReason).toBeUndefined();
    expect(chunk.rawStopReason).toBeUndefined();
  });

  it('preserves rawStopReason but maps an unknown stopReason to other', () => {
    const icontent: IContent = {
      speaker: 'ai',
      blocks: [{ type: 'text', text: 'text' }],
      metadata: { stopReason: 'some_future_reason' },
    };

    const chunk = toModelStreamChunk(icontent);

    expect(chunk.finishReason).toBe('other');
    expect(chunk.rawStopReason).toBe('some_future_reason');
  });

  it('does not mutate the input IContent metadata when mapping', () => {
    const icontent: IContent = {
      speaker: 'ai',
      blocks: [{ type: 'text', text: 'declined' }],
      metadata: { stopReason: 'refusal' },
    };

    const chunk = toModelStreamChunk(icontent);

    expect(chunk.content).toBe(icontent);
    expect(icontent.metadata?.stopReason).toBe('refusal');
    expect(chunk.rawStopReason).toBe('refusal');
  });
});
