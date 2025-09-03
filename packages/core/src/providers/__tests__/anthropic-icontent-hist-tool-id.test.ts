/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AnthropicProvider } from '../anthropic/AnthropicProvider.js';
import { ITool } from '../ITool.js';
import { IContent } from '../../services/history/IContent.js';

describe('AnthropicProvider hist_tool ID conversion', () => {
  let provider: AnthropicProvider;
  let mockMessagesCreate: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    // Create mock Anthropic client
    mockMessagesCreate = vi.fn();

    // Override the client property with our mock implementation
    provider = new AnthropicProvider('test-key');
    provider.setModel('claude-3-haiku-20240307');

    // Mock the anthropic client (not just client)
    (
      provider as unknown as {
        anthropic: { messages: { create: ReturnType<typeof vi.fn> } };
      }
    ).anthropic = {
      messages: {
        create: mockMessagesCreate,
      },
    };

    // Mock the getAuthToken method to return our test key
    vi.spyOn(
      provider as { getAuthToken: () => Promise<string> },
      'getAuthToken',
    ).mockResolvedValue('test-key');

    // Mock the updateClientWithResolvedAuth method to prevent actual client recreation
    vi.spyOn(
      provider as { updateClientWithResolvedAuth: () => Promise<void> },
      'updateClientWithResolvedAuth',
    ).mockImplementation(async () => {
      // Don't override the mocked anthropic client
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should convert hist_tool_ IDs to toolu_ format when sending to Anthropic', async () => {
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
            id: 'hist_tool_abc123', // History format
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
            callId: 'hist_tool_abc123', // History format
            toolName: 'test_function',
            result: 'Tool executed successfully',
          },
        ],
      },
    ];

    // Mock response from Anthropic (needs to be async iterable for streaming)
    mockMessagesCreate.mockImplementation(() => {
      const events = [
        {
          type: 'content_block_start',
          content_block: {
            type: 'text',
            text: 'The tool was executed successfully',
          },
        },
        {
          type: 'content_block_stop',
        },
        {
          type: 'message_stop',
        },
      ];

      let index = 0;
      return {
        [Symbol.asyncIterator]: () => ({
          next: () =>
            index < events.length
              ? Promise.resolve({ value: events[index++], done: false })
              : Promise.resolve({ value: undefined, done: true }),
        }),
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

    // Verify the Anthropic API was called with converted IDs
    expect(mockMessagesCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: expect.arrayContaining([
          expect.objectContaining({
            role: 'assistant',
            content: expect.arrayContaining([
              expect.objectContaining({
                type: 'tool_use',
                id: 'toolu_abc123', // Should be converted to toolu_ format
                name: 'test_function',
              }),
            ]),
          }),
          expect.objectContaining({
            role: 'user',
            content: expect.arrayContaining([
              expect.objectContaining({
                type: 'tool_result',
                tool_use_id: 'toolu_abc123', // Should be converted to toolu_ format
              }),
            ]),
          }),
        ]),
      }),
    );
  });

  it('should convert toolu_ IDs back to hist_tool_ format in responses', async () => {
    const tools: ITool[] = [
      {
        type: 'function',
        function: {
          name: 'test_function',
          description: 'Test function',
          parameters: {
            type: 'object',
            properties: {},
          },
        },
      },
    ];

    const messages: IContent[] = [
      {
        speaker: 'human',
        blocks: [{ type: 'text', text: 'Please use the tool' }],
      },
    ];

    // Mock Anthropic streaming response with toolu_ format
    mockMessagesCreate.mockImplementation(() => {
      const events = [
        {
          type: 'message_start',
          message: { usage: { input_tokens: 10, output_tokens: 0 } },
        },
        {
          type: 'content_block_start',
          content_block: { type: 'text', text: 'I will use the tool' },
        },
        {
          type: 'content_block_stop',
        },
        {
          type: 'content_block_start',
          content_block: {
            type: 'tool_use',
            id: 'toolu_xyz789', // Anthropic format
            name: 'test_function',
          },
        },
        {
          type: 'content_block_delta',
          delta: { type: 'input_json_delta', partial_json: '{}' },
        },
        {
          type: 'content_block_stop',
        },
        {
          type: 'message_stop',
        },
      ];

      let index = 0;
      return {
        [Symbol.asyncIterator]: () => ({
          next: () =>
            index < events.length
              ? Promise.resolve({ value: events[index++], done: false })
              : Promise.resolve({ value: undefined, done: true }),
        }),
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

    // Should be converted back to hist_tool_ format
    expect((toolCallBlock as { id?: string })?.id).toBe('hist_tool_xyz789');
  });
});
