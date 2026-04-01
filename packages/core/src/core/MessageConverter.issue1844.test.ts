/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Regression tests for issue #1844:
 * MessageConverter should map both metadata.stopReason and metadata.finishReason
 * to Gemini candidate.finishReason, so downstream turn handling works regardless
 * of which field the provider sets.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import type { IContent } from '../services/history/IContent.js';
import { FinishReason } from '@google/genai';

let convertIContentToResponse: typeof import('./MessageConverter.js').convertIContentToResponse;

describe('issue #1844 – MessageConverter finishReason/stopReason mapping', () => {
  beforeAll(async () => {
    const mod = await import('./MessageConverter.js');
    convertIContentToResponse = mod.convertIContentToResponse;
  });

  it('should map metadata.stopReason to candidate.finishReason', () => {
    const input: IContent = {
      speaker: 'ai',
      blocks: [{ type: 'text', text: 'done' }],
      metadata: {
        stopReason: 'end_turn',
      },
    };

    const response = convertIContentToResponse(input);
    expect(response.candidates?.[0]?.finishReason).toBe(FinishReason.STOP);
  });

  it('should map metadata.finishReason (OpenAI-style "stop") to candidate.finishReason', () => {
    const input: IContent = {
      speaker: 'ai',
      blocks: [{ type: 'text', text: 'done' }],
      metadata: {
        finishReason: 'stop',
      },
    };

    const response = convertIContentToResponse(input);
    expect(response.candidates?.[0]?.finishReason).toBe(FinishReason.STOP);
  });

  it('should map metadata.finishReason "length" to candidate.finishReason MAX_TOKENS', () => {
    const input: IContent = {
      speaker: 'ai',
      blocks: [{ type: 'text', text: 'truncated' }],
      metadata: {
        finishReason: 'length',
      },
    };

    const response = convertIContentToResponse(input);
    expect(response.candidates?.[0]?.finishReason).toBe(
      FinishReason.MAX_TOKENS,
    );
  });

  it('should map metadata.finishReason "tool_calls" to candidate.finishReason', () => {
    const input: IContent = {
      speaker: 'ai',
      blocks: [{ type: 'text', text: '' }],
      metadata: {
        finishReason: 'tool_calls',
      },
    };

    const response = convertIContentToResponse(input);
    expect(response.candidates?.[0]?.finishReason).toBe(FinishReason.STOP);
  });

  it('should map metadata.finishReason "function_call" to candidate.finishReason STOP', () => {
    const input: IContent = {
      speaker: 'ai',
      blocks: [{ type: 'text', text: '' }],
      metadata: {
        finishReason: 'function_call',
      },
    };

    const response = convertIContentToResponse(input);
    expect(response.candidates?.[0]?.finishReason).toBe(FinishReason.STOP);
  });

  it('should map metadata.finishReason "content_filter" to candidate.finishReason SAFETY', () => {
    const input: IContent = {
      speaker: 'ai',
      blocks: [{ type: 'text', text: '' }],
      metadata: {
        finishReason: 'content_filter',
      },
    };

    const response = convertIContentToResponse(input);
    expect(response.candidates?.[0]?.finishReason).toBe('SAFETY');
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

    const response = convertIContentToResponse(input);
    expect(response.candidates?.[0]?.finishReason).toBe(FinishReason.STOP);
  });

  it('should map "completed" (OpenAI Responses status) to STOP', () => {
    const input: IContent = {
      speaker: 'ai',
      blocks: [{ type: 'text', text: 'done' }],
      metadata: {
        stopReason: 'completed',
      },
    };

    const response = convertIContentToResponse(input);
    expect(response.candidates?.[0]?.finishReason).toBe(FinishReason.STOP);
  });
});
