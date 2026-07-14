/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral tests for hookWireAdapter — verifies that hook-modified
 * responses update BOTH finishReason AND rawStopReason on the neutral
 * chunk/modelOutput.
 *
 * @plan:PLAN-20260707-AGENTNEUTRAL.P07
 * @plan:PLAN-20260707-AGENTNEUTRAL.P13
 * @requirement:REQ-002.6
 */

import { describe, it, expect } from 'vitest';
import {
  afterModelModifiedToChunk,
  afterModelModifiedToModelOutput,
} from '../hookWireAdapter.js';
import type { HookGenerateContentResponse } from '@vybestack/llxprt-code-core/hooks/hookTranslator.js';
import type {
  ModelStreamChunk,
  ModelOutput,
} from '@vybestack/llxprt-code-core/llm-types/index.js';

function makeBaseChunk(): ModelStreamChunk {
  return {
    content: {
      speaker: 'ai',
      blocks: [{ type: 'text', text: 'base' }],
    },
    finishReason: 'stop',
    rawStopReason: 'STOP',
  };
}

function makeBaseOutput(): ModelOutput {
  const base = makeBaseChunk();
  return {
    content: { ...base.content, blocks: [...base.content.blocks] },
    finishReason: base.finishReason,
    rawStopReason: base.rawStopReason,
  };
}

describe('afterModelModifiedToChunk — finishReason + rawStopReason', () => {
  it('updates both finishReason and rawStopReason from hook response', () => {
    const modified: HookGenerateContentResponse = {
      candidates: [
        {
          content: {
            role: 'model',
            parts: [{ text: 'hook text' }],
          },
          finishReason: 'MAX_TOKENS',
        },
      ],
    };
    const result = afterModelModifiedToChunk(modified, makeBaseChunk());
    expect(result).toBeDefined();
    expect(result!.finishReason).toBe('max_tokens');
    expect(result!.rawStopReason).toBe('MAX_TOKENS');
  });

  it('preserves base finishReason when hook response omits it', () => {
    const modified: HookGenerateContentResponse = {
      candidates: [
        {
          content: {
            role: 'model',
            parts: [{ text: 'hook text' }],
          },
        },
      ],
    };
    const result = afterModelModifiedToChunk(modified, makeBaseChunk());
    expect(result).toBeDefined();
    expect(result!.finishReason).toBe('stop');
    expect(result!.rawStopReason).toBe('STOP');
  });

  it('returns undefined when modified is undefined', () => {
    const result = afterModelModifiedToChunk(undefined, makeBaseChunk());
    expect(result).toBeUndefined();
  });
});

describe('afterModelModifiedToModelOutput — finishReason + rawStopReason (direct path)', () => {
  it('updates both finishReason and rawStopReason from hook response', () => {
    const modified: HookGenerateContentResponse = {
      candidates: [
        {
          content: {
            role: 'model',
            parts: [{ text: 'hook text' }],
          },
          finishReason: 'SAFETY',
        },
      ],
    };
    const result = afterModelModifiedToModelOutput(modified, makeBaseOutput());
    expect(result).toBeDefined();
    expect(result!.finishReason).toBe('safety');
    expect(result!.rawStopReason).toBe('SAFETY');
  });

  it('preserves base finishReason when hook response omits it', () => {
    const modified: HookGenerateContentResponse = {
      candidates: [
        {
          content: {
            role: 'model',
            parts: [{ text: 'hook text' }],
          },
        },
      ],
    };
    const result = afterModelModifiedToModelOutput(modified, makeBaseOutput());
    expect(result).toBeDefined();
    expect(result!.finishReason).toBe('stop');
    expect(result!.rawStopReason).toBe('STOP');
  });

  it('returns undefined when modified is undefined', () => {
    const result = afterModelModifiedToModelOutput(undefined, makeBaseOutput());
    expect(result).toBeUndefined();
  });
});
