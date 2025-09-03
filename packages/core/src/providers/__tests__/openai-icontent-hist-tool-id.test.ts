/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { OpenAIProvider } from '../openai/OpenAIProvider.js';
import { ITool } from '../ITool.js';
import { IContent } from '../../services/history/IContent.js';

describe('OpenAIProvider hist_tool ID conversion', () => {
  let provider: OpenAIProvider;
  let mockChatCompletionsCreate: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    // Create mock OpenAI client
    mockChatCompletionsCreate = vi.fn();

    // Override the openai property with our mock implementation
    provider = new OpenAIProvider('test-key');
    (
      provider as unknown as {
        openai: { chat: { completions: { create: ReturnType<typeof vi.fn> } } };
      }
    ).openai = {
      chat: {
        completions: {
          create: mockChatCompletionsCreate,
        },
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
    ).mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should convert hist_tool_ IDs to call_ format when sending to OpenAI', async () => {
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

    // Mock response from OpenAI (needs to be async iterable for streaming)
    mockChatCompletionsCreate.mockImplementation(() => {
      const chunks = [
        {
          id: 'chatcmpl-test',
          choices: [
            {
              delta: {
                role: 'assistant',
                content: 'The tool was executed successfully',
              },
              finish_reason: null,
            },
          ],
        },
        {
          id: 'chatcmpl-test',
          choices: [
            {
              delta: {},
              finish_reason: 'stop',
            },
          ],
        },
      ];

      let index = 0;
      return {
        [Symbol.asyncIterator]: () => ({
          next: () =>
            index < chunks.length
              ? Promise.resolve({ value: chunks[index++], done: false })
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

    // Verify the OpenAI API was called with converted IDs
    expect(mockChatCompletionsCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: expect.arrayContaining([
          expect.objectContaining({
            role: 'assistant',
            tool_calls: expect.arrayContaining([
              expect.objectContaining({
                id: 'call_abc123', // Should be converted to call_ format
                function: expect.objectContaining({
                  name: 'test_function',
                }),
              }),
            ]),
          }),
          expect.objectContaining({
            role: 'tool',
            tool_call_id: 'call_abc123', // Should be converted to call_ format
          }),
        ]),
      }),
    );
  });

  it('should convert call_ IDs back to hist_tool_ format in responses', async () => {
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

    // Mock OpenAI streaming response with call_ format
    mockChatCompletionsCreate.mockImplementation(() => {
      const chunks = [
        {
          id: 'chatcmpl-1',
          choices: [
            {
              index: 0,
              delta: {
                role: 'assistant',
                content: 'I will use the tool',
              },
            },
          ],
        },
        {
          id: 'chatcmpl-1',
          choices: [
            {
              index: 0,
              delta: {
                tool_calls: [
                  {
                    id: 'call_xyz789', // OpenAI format
                    type: 'function',
                    function: {
                      name: 'test_function',
                      arguments: '{}',
                    },
                  },
                ],
              },
            },
          ],
        },
        {
          id: 'chatcmpl-1',
          choices: [
            {
              index: 0,
              finish_reason: 'tool_calls',
            },
          ],
        },
      ];

      let index = 0;
      return {
        [Symbol.asyncIterator]: () => ({
          next: () =>
            index < chunks.length
              ? Promise.resolve({ value: chunks[index++], done: false })
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
