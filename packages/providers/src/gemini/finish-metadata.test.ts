/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import { createGeminiResponseMapper } from './geminiResponseMapper.js';

describe('Gemini terminal finish metadata', () => {
  it.each([
    ['STOP', 'stop'],
    ['MAX_TOKENS', 'max_tokens'],
    ['SAFETY', 'safety'],
    ['RECITATION', 'safety'],
    ['MALFORMED_FUNCTION_CALL', 'error'],
    ['future_reason', 'other'],
    ['constructor', 'other'],
  ])('maps %s to %s on only the last chunk', (raw, expected) => {
    const chunks = createGeminiResponseMapper()({
      candidates: [
        {
          finishReason: raw,
          content: {
            parts: [
              { thought: true, text: 'Consider the request' },
              { text: 'Answer' },
              { functionCall: { id: 'call_1', name: 'lookup', args: {} } },
            ],
          },
        },
      ],
      usageMetadata: {
        promptTokenCount: 2,
        candidatesTokenCount: 3,
        totalTokenCount: 5,
      },
    });
    expect(chunks.map((chunk) => chunk.blocks[0]?.type)).toStrictEqual([
      'thinking',
      'text',
      'tool_call',
    ]);
    expect(
      chunks.slice(0, -1).map((chunk) => chunk.metadata?.finishReason),
    ).toStrictEqual([undefined, undefined]);
    expect(chunks[chunks.length - 1]?.metadata).toMatchObject({
      finishReason: expected,
      rawStopReason: raw,
      usage: { totalTokens: 5 },
    });
  });

  it('emits a finish signal for a blocked response without parts', () => {
    const chunks = createGeminiResponseMapper()({
      candidates: [{ finishReason: 'SAFETY' }],
    });
    expect(chunks).toStrictEqual([
      {
        speaker: 'ai',
        blocks: [],
        metadata: { finishReason: 'safety', rawStopReason: 'SAFETY' },
      },
    ]);
  });

  it('does not invent a finish signal for a non-terminal response', () => {
    const chunks = createGeminiResponseMapper()({
      candidates: [{ content: { parts: [{ text: 'More' }] } }],
    });
    expect(chunks[0]?.metadata?.finishReason).toBeUndefined();
    expect(chunks[0]?.metadata?.rawStopReason).toBeUndefined();
  });
});
