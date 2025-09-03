/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GeminiProvider } from '../gemini/GeminiProvider.js';
import { ITool } from '../ITool.js';
import { IContent } from '../../services/history/IContent.js';

describe('GeminiProvider hist_tool ID preservation', () => {
  let provider: GeminiProvider;
  let mockGenerateChatCompletion: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    // Create provider with test API key
    provider = new GeminiProvider('test-key');
    provider.setModel('gemini-2.0-flash-exp');

    // Mock generateChatCompletion method
    mockGenerateChatCompletion = vi.fn();
    vi.spyOn(provider, 'generateChatCompletion').mockImplementation(
      mockGenerateChatCompletion,
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should preserve hist_tool_ IDs without modification', async () => {
    const tools: ITool[] = [
      {
        type: 'function',
        function: {
          name: 'test_function',
          description: 'Test function',
          parameters: {
            type: 'object',
            properties: {
              param: { type: 'string' },
            },
            required: ['param'],
          },
        },
      },
    ];

    // Input with hist_tool_ format IDs
    const messages: IContent[] = [
      {
        speaker: 'human',
        blocks: [{ type: 'text', text: 'Please use the tool' }],
      },
      {
        speaker: 'ai',
        blocks: [
          { type: 'text', text: 'I will use the tool now' },
          {
            type: 'tool_call',
            id: 'hist_tool_abc123', // History format - should be preserved
            name: 'test_function',
            parameters: { param: 'test' },
          },
        ],
      },
      {
        speaker: 'tool',
        blocks: [
          {
            type: 'tool_response',
            callId: 'hist_tool_abc123', // History format - should be preserved
            toolName: 'test_function',
            result: 'Tool executed successfully',
          },
        ],
      },
    ];

    // Mock generateChatCompletion to return an empty async iterator
    mockGenerateChatCompletion.mockImplementation(async function* () {
      // Return empty for this test - we're just checking the input
    });

    // Execute the request
    const response: IContent[] = [];
    for await (const chunk of provider.generateChatCompletionIContent(
      messages,
      tools,
    )) {
      response.push(chunk);
    }

    // Verify that generateChatCompletion was called with preserved hist_tool_ IDs
    expect(mockGenerateChatCompletion).toHaveBeenCalledWith(
      [
        {
          role: 'user',
          content: 'Please use the tool',
        },
        {
          role: 'assistant',
          content: 'I will use the tool now',
          tool_calls: [
            {
              id: 'hist_tool_abc123', // Should be preserved as-is
              type: 'function',
              function: {
                name: 'test_function',
                arguments: '{"param":"test"}',
              },
            },
          ],
        },
        {
          role: 'tool',
          content: 'Tool executed successfully',
          tool_call_id: 'hist_tool_abc123', // Should be preserved as-is
          tool_name: 'test_function',
        },
      ],
      tools,
      undefined, // toolFormat
    );
  });

  it('should preserve hist_tool_ IDs in responses without modification', async () => {
    const tools: ITool[] = [
      {
        type: 'function',
        function: {
          name: 'test_function',
          description: 'Test function',
          parameters: {},
        },
      },
    ];

    const messages: IContent[] = [
      {
        speaker: 'human',
        blocks: [{ type: 'text', text: 'Please use the tool' }],
      },
    ];

    // Mock generateChatCompletion to return a response with hist_tool_ ID
    mockGenerateChatCompletion.mockImplementation(async function* () {
      // Return IMessage with tool_calls that have hist_tool_ IDs
      yield {
        role: 'assistant',
        content: 'I will use the tool',
        tool_calls: [
          {
            id: 'hist_tool_xyz789', // Already in hist_tool format
            type: 'function',
            function: {
              name: 'test_function',
              arguments: '{}',
            },
          },
        ],
      };
    });

    // Execute the request
    const response: IContent[] = [];
    for await (const chunk of provider.generateChatCompletionIContent(
      messages,
      tools,
    )) {
      response.push(chunk);
    }

    // Find the tool call in the response
    const toolCallContent = response.find((content) =>
      content.blocks.find((block) => block.type === 'tool_call'),
    );

    expect(toolCallContent).toBeDefined();
    const toolCallBlock = toolCallContent?.blocks.find(
      (block) => block.type === 'tool_call',
    );

    // Should be preserved as-is
    expect((toolCallBlock as { id?: string })?.id).toBe('hist_tool_xyz789');
  });
});
