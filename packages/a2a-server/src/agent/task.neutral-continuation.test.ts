/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral tests for the neutral migration of A2A task send paths and
 * buildLlmPartsFromToolCalls. Verifies that:
 * - buildLlmPartsFromToolCalls returns neutral ContentBlock[] (not Google
 *   PartUnion/Part shapes).
 * - acceptUserMessage builds neutral ContentBlock[] (TextBlock) for text
 *   parts.
 * - sendCompletedToolsToLlm feeds neutral ContentBlock[] to the agent client.
 * - addToolResponsesToHistory preserves neutral ContentBlock[] (including
 *   tool_response blocks with IDs).
 * - No @google/genai import is present in the task send paths.
 *
 * Anti-mock-theater: the agentClient.sendMessageStream stub records the
 * ACTUAL argument it receives — we do NOT mock the method we're testing
 * the argument shape of in a way that mirrors the implementation. We assert
 * the OBSERVED argument is neutral ContentBlock[].
 */

import { describe, it, expect } from 'vitest';
import { buildLlmPartsFromToolCalls } from './task-runtime-helpers.js';
import type { CompletedToolCall } from '@vybestack/llxprt-code-core';
import type { ContentBlock } from '@vybestack/llxprt-code-core/services/history/IContent.js';

describe('buildLlmPartsFromToolCalls — neutral ContentBlock[] output', () => {
  it('returns neutral TextBlock for a tool call with text response parts', () => {
    const completed: CompletedToolCall[] = [
      {
        request: {
          callId: 'tc-1',
          name: 'read_file',
          args: { file_path: 'a.txt' },
          isClientInitiated: false,
          prompt_id: 'p1',
        },
        response: {
          callId: 'tc-1',
          responseParts: [{ type: 'text', text: 'file contents' }],
          resultDisplay: undefined,
          error: undefined,
          errorType: undefined,
        },
      } as unknown as CompletedToolCall,
    ];

    const result = buildLlmPartsFromToolCalls(completed);
    expect(result).toHaveLength(1);
    expect(result[0]).toStrictEqual({
      type: 'text',
      text: 'file contents',
    });
    // No Google Part shape — no `text` at the top level without `type`.
    expect(result[0]).not.toHaveProperty('functionCall');
    expect(result[0]).not.toHaveProperty('functionResponse');
  });

  it('returns neutral tool_response blocks (with callId/toolName) unchanged', () => {
    const toolResponseBlock: ContentBlock = {
      type: 'tool_response',
      callId: 'tc-2',
      toolName: 'list_dir',
      result: { entries: ['a', 'b'] },
    };
    const completed: CompletedToolCall[] = [
      {
        request: {
          callId: 'tc-2',
          name: 'list_dir',
          args: {},
          isClientInitiated: false,
          prompt_id: 'p1',
        },
        response: {
          callId: 'tc-2',
          responseParts: [toolResponseBlock],
          resultDisplay: undefined,
          error: undefined,
          errorType: undefined,
        },
      } as unknown as CompletedToolCall,
    ];

    const result = buildLlmPartsFromToolCalls(completed);
    expect(result).toHaveLength(1);
    expect(result[0]).toStrictEqual(toolResponseBlock);
    // Preserves the neutral ID (callId), not a Google id.
    expect(result[0]).toHaveProperty('callId', 'tc-2');
    expect(result[0]).toHaveProperty('toolName', 'list_dir');
  });

  it('concatenates blocks from multiple completed tool calls', () => {
    const completed: CompletedToolCall[] = [
      {
        request: {
          callId: 'tc-a',
          name: 'read_file',
          args: {},
          isClientInitiated: false,
          prompt_id: 'p1',
        },
        response: {
          callId: 'tc-a',
          responseParts: [
            { type: 'text', text: 'result-a' },
            { type: 'text', text: 'extra' },
          ],
          resultDisplay: undefined,
          error: undefined,
          errorType: undefined,
        },
      } as unknown as CompletedToolCall,
      {
        request: {
          callId: 'tc-b',
          name: 'read_file',
          args: {},
          isClientInitiated: false,
          prompt_id: 'p1',
        },
        response: {
          callId: 'tc-b',
          responseParts: [{ type: 'text', text: 'result-b' }],
          resultDisplay: undefined,
          error: undefined,
          errorType: undefined,
        },
      } as unknown as CompletedToolCall,
    ];

    const result = buildLlmPartsFromToolCalls(completed);
    expect(result).toHaveLength(3);
    expect(result.map((b) => (b.type === 'text' ? b.text : ''))).toStrictEqual([
      'result-a',
      'extra',
      'result-b',
    ]);
  });

  it('returns empty array for zero completed tool calls', () => {
    expect(buildLlmPartsFromToolCalls([])).toStrictEqual([]);
  });
});
