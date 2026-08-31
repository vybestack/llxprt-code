/**
 * Copyright 2025 Vybestack LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * Tests for tool ID normalization in buildResponsesRequest
 */

import { describe, it, expect } from 'bun:test';
import { buildResponsesRequest } from './buildResponsesRequest.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';

type FunctionCallItem = { type: string; call_id: string };

function isFunctionCallItem(item: unknown): item is FunctionCallItem {
  return (
    typeof item === 'object' &&
    item !== null &&
    'type' in item &&
    item.type === 'function_call'
  );
}

function isFunctionCallOutputItem(item: unknown): item is FunctionCallItem {
  return (
    typeof item === 'object' &&
    item !== null &&
    'type' in item &&
    item.type === 'function_call_output'
  );
}

describe('buildResponsesRequest - Tool ID Normalization', () => {
  it('should normalize hist_tool IDs in function_call items', () => {
    const messages: IContent[] = [
      {
        speaker: 'human',
        blocks: [{ type: 'text', text: 'Create a file' }],
      },
      {
        speaker: 'ai',
        blocks: [
          {
            type: 'tool_call',
            id: 'hist_tool_abc123def456',
            name: 'write_file',
            parameters: { path: '/test.txt', content: 'hello' },
          },
        ],
      },
      {
        speaker: 'tool',
        blocks: [
          {
            type: 'tool_response',
            callId: 'hist_tool_abc123def456',
            result: 'File created successfully',
          },
        ],
      },
      {
        speaker: 'human',
        blocks: [{ type: 'text', text: 'What did you do?' }],
      },
    ];

    const result = buildResponsesRequest({
      messages,
      model: 'gpt-4o',
    });

    const functionCalls = (result.input as unknown[]).filter(
      isFunctionCallItem,
    );

    const functionCallOutputs = (result.input as unknown[]).filter(
      isFunctionCallOutputItem,
    );

    expect(functionCalls.length).toBe(1);
    expect(functionCalls[0].call_id).toBe('call_abc123def456');

    expect(functionCallOutputs.length).toBe(1);
    expect(functionCallOutputs[0].call_id).toBe('call_abc123def456');

    expect(functionCalls[0].call_id).toBe(functionCallOutputs[0].call_id);
  });

  it('should normalize unknown format IDs', () => {
    const messages: IContent[] = [
      {
        speaker: 'ai',
        blocks: [
          {
            type: 'tool_call',
            id: 'unknown_xyz789',
            name: 'read_file',
            parameters: { path: '/test.txt' },
          },
        ],
      },
      {
        speaker: 'tool',
        blocks: [
          {
            type: 'tool_response',
            callId: 'unknown_xyz789',
            result: 'file contents',
          },
        ],
      },
    ];

    const result = buildResponsesRequest({
      messages,
      model: 'gpt-4o',
    });

    const functionCalls = (result.input as unknown[]).filter(
      isFunctionCallItem,
    );

    const functionCallOutputs = (result.input as unknown[]).filter(
      isFunctionCallOutputItem,
    );

    expect(functionCalls[0].call_id).toBe('call_unknown_xyz789');
    expect(functionCallOutputs[0].call_id).toBe('call_unknown_xyz789');
    expect(functionCalls[0].call_id).toBe(functionCallOutputs[0].call_id);
  });

  it('should preserve call_ IDs unchanged', () => {
    const messages: IContent[] = [
      {
        speaker: 'ai',
        blocks: [
          {
            type: 'tool_call',
            id: 'call_existing123',
            name: 'read_file',
            parameters: { path: '/test.txt' },
          },
        ],
      },
      {
        speaker: 'tool',
        blocks: [
          {
            type: 'tool_response',
            callId: 'call_existing123',
            result: 'file contents',
          },
        ],
      },
    ];

    const result = buildResponsesRequest({
      messages,
      model: 'gpt-4o',
    });

    const functionCalls = (result.input as unknown[]).filter(
      isFunctionCallItem,
    );

    const functionCallOutputs = (result.input as unknown[]).filter(
      isFunctionCallOutputItem,
    );

    expect(functionCalls[0].call_id).toBe('call_existing123');
    expect(functionCallOutputs[0].call_id).toBe('call_existing123');
  });

  it('should handle cancelled tool calls with hist_tool IDs', () => {
    const messages: IContent[] = [
      {
        speaker: 'human',
        blocks: [{ type: 'text', text: 'Edit the file' }],
      },
      {
        speaker: 'ai',
        blocks: [
          {
            type: 'tool_call',
            id: 'hist_tool_cancelledXYZ789',
            name: 'replace',
            parameters: {
              file_path: '/test.txt',
              old_string: 'a',
              new_string: 'b',
            },
          },
        ],
      },
      {
        speaker: 'tool',
        blocks: [
          {
            type: 'tool_response',
            callId: 'hist_tool_cancelledXYZ789',
            result: 'User cancelled tool execution.',
          },
        ],
      },
      {
        speaker: 'human',
        blocks: [
          { type: 'text', text: 'Why did you want to make that change?' },
        ],
      },
    ];

    const result = buildResponsesRequest({
      messages,
      model: 'gpt-4o',
    });

    const functionCalls = (result.input as unknown[]).filter(
      isFunctionCallItem,
    );

    const functionCallOutputs = (result.input as unknown[]).filter(
      isFunctionCallOutputItem,
    );

    expect(functionCalls[0].call_id).toBe('call_cancelledXYZ789');
    expect(functionCallOutputs[0].call_id).toBe('call_cancelledXYZ789');
    expect(functionCalls[0].call_id).toBe(functionCallOutputs[0].call_id);
  });
});
