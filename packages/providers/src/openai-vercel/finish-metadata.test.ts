/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import { emitStreamToolCallsAndMetadata } from './vercelMetadataMapper.js';
import { createCaptureBuffer } from './vercelReasoningCapture.js';

describe('Vercel terminal finish metadata', () => {
  it.each([
    ['stop', 'stop'],
    ['length', 'max_tokens'],
    ['tool-calls', 'tool_calls'],
    ['content-filter', 'safety'],
    ['unknown', 'other'],
  ] as const)('maps %s to %s', (raw, expected) => {
    const chunks = [
      ...emitStreamToolCallsAndMetadata(
        {
          textBuffer: '',
          accumulatedThinkingContent: '',
          hasEmittedThinking: false,
          collectedToolCalls: [],
          totalUsage: undefined,
          finishReason: raw,
        },
        createCaptureBuffer(),
      ),
    ];
    expect(chunks[chunks.length - 1]?.metadata).toStrictEqual({
      finishReason: expected,
      rawStopReason: raw,
    });
  });

  it('attaches the finish signal to emitted tool calls', () => {
    const chunks = [
      ...emitStreamToolCallsAndMetadata(
        {
          textBuffer: '',
          accumulatedThinkingContent: '',
          hasEmittedThinking: false,
          collectedToolCalls: [
            { toolCallId: 'call_1', toolName: 'lookup', input: {} },
          ],
          totalUsage: undefined,
          finishReason: 'tool-calls',
        },
        createCaptureBuffer(),
      ),
    ];
    expect(chunks[chunks.length - 1]?.blocks[0]?.type).toBe('tool_call');
    expect(chunks[chunks.length - 1]?.metadata).toStrictEqual({
      finishReason: 'tool_calls',
      rawStopReason: 'tool-calls',
    });
  });
});
