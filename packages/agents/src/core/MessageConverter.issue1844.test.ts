/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Regression tests for issue #1844:
 * The neutral toModelStreamChunk mapper should map both metadata.stopReason
 * and metadata.finishReason to the CanonicalFinishReason on the ModelOutput,
 * so downstream turn handling works regardless of which field the provider
 * sets.
 *
 * Migrated in P13 from the deleted convertIContentToResponse to the neutral
 * toModelStreamChunk path (@plan:PLAN-20260707-AGENTNEUTRAL.P13).
 */

import { describe, it, expect } from 'vitest';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { toModelStreamChunk } from '@vybestack/llxprt-code-core/llm-types/index.js';

describe('issue #1844 – toModelStreamChunk finishReason/stopReason mapping', () => {
  it('should map metadata.stopReason to finishReason', () => {
    const input: IContent = {
      speaker: 'ai',
      blocks: [{ type: 'text', text: 'done' }],
      metadata: {
        stopReason: 'end_turn',
      },
    };

    const chunk = toModelStreamChunk(input);
    expect(chunk.finishReason).toBe('stop');
  });

  it('should map metadata.finishReason (OpenAI-style "stop") to finishReason', () => {
    const input: IContent = {
      speaker: 'ai',
      blocks: [{ type: 'text', text: 'done' }],
      metadata: {
        finishReason: 'stop',
      },
    };

    const chunk = toModelStreamChunk(input);
    expect(chunk.finishReason).toBe('stop');
  });

  it('should map metadata.finishReason "length" to finishReason max_tokens', () => {
    const input: IContent = {
      speaker: 'ai',
      blocks: [{ type: 'text', text: 'truncated' }],
      metadata: {
        finishReason: 'length',
      },
    };

    const chunk = toModelStreamChunk(input);
    expect(chunk.finishReason).toBe('max_tokens');
  });

  it('should map metadata.finishReason "tool_calls" to finishReason', () => {
    const input: IContent = {
      speaker: 'ai',
      blocks: [{ type: 'text', text: '' }],
      metadata: {
        finishReason: 'tool_calls',
      },
    };

    const chunk = toModelStreamChunk(input);
    expect(chunk.finishReason).toBe('tool_calls');
  });

  it('should map metadata.finishReason "function_call" to finishReason tool_calls', () => {
    const input: IContent = {
      speaker: 'ai',
      blocks: [{ type: 'text', text: '' }],
      metadata: {
        finishReason: 'function_call',
      },
    };

    const chunk = toModelStreamChunk(input);
    expect(chunk.finishReason).toBe('tool_calls');
  });

  it('should map metadata.finishReason "content_filter" to finishReason safety', () => {
    const input: IContent = {
      speaker: 'ai',
      blocks: [{ type: 'text', text: '' }],
      metadata: {
        finishReason: 'content_filter',
      },
    };

    const chunk = toModelStreamChunk(input);
    expect(chunk.finishReason).toBe('safety');
  });

  it('should prefer stopReason over finishReason when both are present', () => {
    const input: IContent = {
      speaker: 'ai',
      blocks: [{ type: 'text', text: 'done' }],
      metadata: {
        stopReason: 'end_turn',
        finishReason: 'stop',
      },
    };

    const chunk = toModelStreamChunk(input);
    expect(chunk.finishReason).toBe('stop');
    // stopReason (end_turn) is preferred over finishReason (stop)
    expect(chunk.rawStopReason).toBe('end_turn');
  });

  it('should map "completed" (OpenAI Responses status) to other', () => {
    const input: IContent = {
      speaker: 'ai',
      blocks: [{ type: 'text', text: 'done' }],
      metadata: {
        stopReason: 'completed',
      },
    };

    const chunk = toModelStreamChunk(input);
    expect(chunk.finishReason).toBe('other');
  });
});
