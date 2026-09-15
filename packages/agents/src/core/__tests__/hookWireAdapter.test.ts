/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral tests for hookWireAdapter (v2 wire format) — verifies that
 * hook-modified responses pass their IContent through verbatim (tool calls
 * preserved), that canonical finishReason / rawStopReason / usage override
 * only when supplied, and that blocking adapters keep their fallback
 * semantics.
 *
 * @plan PLAN-20260914-HOOKWIREV2 (issue #2624)
 * @plan:PLAN-20260707-AGENTNEUTRAL.P07
 * @plan:PLAN-20260707-AGENTNEUTRAL.P13
 * @requirement:REQ-002.6
 */

import { describe, it, expect } from 'bun:test';
import {
  afterModelModifiedToChunk,
  beforeModelBlockingToModelOutput,
} from '../hookWireAdapter.js';
import type { HookLLMResponse } from '@vybestack/llxprt-code-core/hooks/hookTranslator.js';
import type {
  IContent,
  UsageStats,
} from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { ModelStreamChunk } from '@vybestack/llxprt-code-core/llm-types/index.js';

const HOOK_USAGE: UsageStats = {
  promptTokens: 11,
  completionTokens: 7,
  totalTokens: 18,
};

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

function v2Response(overrides: {
  content: IContent;
  finishReason?: HookLLMResponse['finishReason'];
  rawStopReason?: string;
  usage?: UsageStats;
}): HookLLMResponse {
  return {
    version: 2,
    ...overrides,
  };
}

const toolCallContent: IContent = {
  speaker: 'ai',
  blocks: [
    { type: 'text', text: 'calling tool' },
    {
      type: 'tool_call',
      id: 'call-1',
      name: 'read_file',
      parameters: { path: '/tmp/x' },
    },
  ],
};

describe('afterModelModifiedToChunk — v2 passthrough', () => {
  it('passes hook content through by reference, preserving tool_call blocks', () => {
    const modified = v2Response({ content: toolCallContent });
    const result = afterModelModifiedToChunk(modified, makeBaseChunk());
    expect(result).toBeDefined();
    expect(result!.content).toBe(modified.content);
    expect(result!.content.blocks).toStrictEqual([
      { type: 'text', text: 'calling tool' },
      {
        type: 'tool_call',
        id: 'call-1',
        name: 'read_file',
        parameters: { path: '/tmp/x' },
      },
    ]);
  });

  it('overrides finishReason, rawStopReason, and usage when the hook supplies them', () => {
    const modified = v2Response({
      content: { speaker: 'ai', blocks: [{ type: 'text', text: 'hook text' }] },
      finishReason: 'max_tokens',
      rawStopReason: 'length',
      usage: HOOK_USAGE,
    });
    const result = afterModelModifiedToChunk(modified, makeBaseChunk());
    expect(result!.finishReason).toBe('max_tokens');
    expect(result!.rawStopReason).toBe('length');
    expect(result!.usage).toStrictEqual(HOOK_USAGE);
  });

  it('passes the canonical finishReason through without mapping', () => {
    const modified = v2Response({
      content: { speaker: 'ai', blocks: [{ type: 'text', text: 'hook text' }] },
      finishReason: 'safety',
    });
    const result = afterModelModifiedToChunk(modified, makeBaseChunk());
    expect(result!.finishReason).toBe('safety');
    // Hook supplied no rawStopReason — the base value stays untouched.
    expect(result!.rawStopReason).toBe('STOP');
  });

  it('preserves base finishReason, rawStopReason, and usage when the hook omits them', () => {
    const modified = v2Response({
      content: { speaker: 'ai', blocks: [{ type: 'text', text: 'hook text' }] },
    });
    const result = afterModelModifiedToChunk(modified, makeBaseChunk());
    expect(result!.finishReason).toBe('stop');
    expect(result!.rawStopReason).toBe('STOP');
    expect(result!.usage).toBeUndefined();
  });

  it('returns undefined when modified is undefined', () => {
    const result = afterModelModifiedToChunk(undefined, makeBaseChunk());
    expect(result).toBeUndefined();
  });
});

describe('beforeModelBlockingToModelOutput — v2 synthetic response', () => {
  it('uses the hook content directly when it carries blocks', () => {
    const synthetic = v2Response({
      content: toolCallContent,
      usage: HOOK_USAGE,
    });
    const result = beforeModelBlockingToModelOutput('blocked!', synthetic);
    expect(result.content).toBe(synthetic.content);
    expect(result.usage).toStrictEqual(HOOK_USAGE);
  });

  it('carries hook-supplied finishReason and rawStopReason into the ModelOutput', () => {
    const synthetic = v2Response({
      content: toolCallContent,
      finishReason: 'safety',
      rawStopReason: 'content_filter',
      usage: HOOK_USAGE,
    });
    const result = beforeModelBlockingToModelOutput('blocked!', synthetic);
    expect(result.finishReason).toBe('safety');
    expect(result.rawStopReason).toBe('content_filter');
    expect(result.usage).toStrictEqual(HOOK_USAGE);
  });

  it('falls back to the block reason text when the synthetic content has no blocks', () => {
    const synthetic = v2Response({
      content: { speaker: 'ai', blocks: [] },
    });
    const result = beforeModelBlockingToModelOutput(
      'no tools for you',
      synthetic,
    );
    expect(result.content.blocks).toStrictEqual([
      { type: 'text', text: 'no tools for you' },
    ]);
    expect(result.usage).toBeUndefined();
  });

  it('falls back to a generic message when both content and reason are empty', () => {
    const synthetic = v2Response({
      content: { speaker: 'ai', blocks: [] },
    });
    const result = beforeModelBlockingToModelOutput(undefined, synthetic);
    expect(result.content.blocks).toStrictEqual([
      { type: 'text', text: 'Execution blocked' },
    ]);
  });
});
