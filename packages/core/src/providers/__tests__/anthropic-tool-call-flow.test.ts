/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier:Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AnthropicProvider } from '../anthropic/AnthropicProvider.js';
import { ITool } from '../ITool.js';
import { IMessage } from '../IMessage.js';
import { ContentGeneratorRole } from '../ContentGeneratorRole.js';

describe('AnthropicProvider Tool Call Flow', () => {
  let provider: AnthropicProvider;
  let mockCreate: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    // Create mock Anthropic client
    mockCreate = vi.fn();

    // Override the anthropic property with our mock implementation
    provider = new AnthropicProvider('test-key');
    (
      provider as {
        anthropic: {
          messages: { create: ReturnType<typeof vi.fn> };
          beta: { models: { list: ReturnType<typeof vi.fn> } };
        };
      }
    ).anthropic = {
      messages: {
        create: mockCreate,
      },
      beta: {
        models: {
          list: vi.fn().mockImplementation(() => ({
            [Symbol.asyncIterator]: () => ({
              next: vi.fn().mockResolvedValue({ done: true, value: undefined }),
            }),
          })),
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

  it('should handle tool call sequence correctly', async () => {
    // Define tools for the test
    const tools: ITool[] = [
      {
        type: 'function',
        function: {
          name: 'search_file_content',
          description: 'Search through file content',
          parameters: {
            type: 'object',
            properties: {
              pattern: { type: 'string' },
              path: { type: 'string' },
            },
            required: ['pattern', 'path'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'read_file',
          description: 'Read a file',
          parameters: {
            type: 'object',
            properties: {
              absolute_path: { type: 'string' },
            },
            required: ['absolute_path'],
          },
        },
      },
    ];

    // Set up our mock streaming responses for each call to generateChatCompletion
    const mockResponses = [
      [
        // First response with tool call - stream chunks
        {
          type: 'message_start',
          message: {
            usage: {
              input_tokens: 10,
              output_tokens: 5,
            },
          },
        },
        {
          type: 'content_block_delta',
          delta: {
            type: 'text_delta',
            text: 'OK let me make a tool request\n',
          },
        },
        {
          type: 'content_block_start',
          content_block: {
            type: 'tool_use',
            id: 'call_12345',
            name: 'search_file_content',
          },
        },
        {
          type: 'content_block_delta',
          delta: {
            type: 'input_json_delta',
            partial_json: '{"pattern":"',
          },
        },
        {
          type: 'content_block_delta',
          delta: {
            type: 'input_json_delta',
            partial_json: 'code',
          },
        },
        {
          type: 'content_block_delta',
          delta: {
            type: 'input_json_delta',
            partial_json: '", "path": "/project"}',
          },
        },
        {
          type: 'content_block_stop',
        },
        {
          type: 'message_delta',
          usage: {
            output_tokens: 10,
          },
        },
        {
          type: 'message_stop',
        },
      ],
      [
        // Second response with another tool call
        {
          type: 'message_start',
          message: {
            usage: {
              input_tokens: 15,
              output_tokens: 5,
            },
          },
        },
        {
          type: 'content_block_delta',
          delta: {
            type: 'text_delta',
            text: 'OK let me read a file\n',
          },
        },
        {
          type: 'content_block_start',
          content_block: {
            type: 'tool_use',
            id: 'call_67890',
            name: 'read_file',
          },
        },
        {
          type: 'content_block_delta',
          delta: {
            type: 'input_json_delta',
            partial_json: '{"absolute_path":"',
          },
        },
        {
          type: 'content_block_delta',
          delta: {
            type: 'input_json_delta',
            partial_json: '/project/main.js',
          },
        },
        {
          type: 'content_block_delta',
          delta: {
            type: 'input_json_delta',
            partial_json: '"}',
          },
        },
        {
          type: 'content_block_stop',
        },
        {
          type: 'message_delta',
          usage: {
            output_tokens: 15,
          },
        },
        {
          type: 'message_stop',
        },
      ],
      [
        // Final response
        {
          type: 'message_start',
          message: {
            usage: {
              input_tokens: 20,
              output_tokens: 5,
            },
          },
        },
        {
          type: 'content_block_delta',
          delta: {
            type: 'text_delta',
            text: 'ok I looked through the code very nice code, delicious.\n',
          },
        },
        {
          type: 'message_delta',
          usage: {
            output_tokens: 20,
          },
        },
        {
          type: 'message_stop',
        },
      ],
    ];

    // Mock the create method to return different sequences for each call
    let responseIndex = 0;
    mockCreate.mockImplementation(() => {
      const responses = mockResponses[responseIndex++];
      let chunkIndex = 0;

      return {
        [Symbol.asyncIterator]: () => ({
          next: () =>
            chunkIndex < responses.length
              ? Promise.resolve({
                  value: responses[chunkIndex++],
                  done: false,
                })
              : Promise.resolve({
                  value: undefined,
                  done: true,
                }),
        }),
      };
    });

    // Test sequence:
    // 1. User message -> AI message with tool call -> Tool response -> AI final message

    // First round: user asks to look through code
    const messages1: IMessage[] = [
      { role: ContentGeneratorRole.USER, content: 'Look through the code' },
    ];

    const response1: IMessage[] = [];
    for await (const chunk of provider.generateChatCompletion(
      messages1,
      tools,
    )) {
      response1.push(chunk);
    }

    // Log what we actually got
    console.log('Response 1 length:', response1.length);
    console.log('Response 1 content:', JSON.stringify(response1, null, 2));

    // Second round: add tool response and get next AI message with another tool call
    const toolResponse1: IMessage = {
      role: ContentGeneratorRole.TOOL,
      content: 'Found 3 files with code pattern',
      tool_call_id: 'call_12345',
    };

    const messages2: IMessage[] = [...messages1, ...response1, toolResponse1];

    const response2: IMessage[] = [];
    for await (const chunk of provider.generateChatCompletion(
      messages2,
      tools,
    )) {
      response2.push(chunk);
    }

    // Log what we actually got
    console.log('Response 2 length:', response2.length);
    console.log('Response 2 content:', JSON.stringify(response2, null, 2));

    // Third round: add second tool response and get final AI message
    const toolResponse2: IMessage = {
      role: ContentGeneratorRole.TOOL,
      content: 'File content: console.log("Hello world");',
      tool_call_id: 'call_67890',
    };

    const messages3: IMessage[] = [...messages2, ...response2, toolResponse2];

    const response3: IMessage[] = [];
    for await (const chunk of provider.generateChatCompletion(
      messages3,
      tools,
    )) {
      response3.push(chunk);
    }

    // Log what we actually got
    console.log('Response 3 length:', response3.length);
    console.log('Response 3 content:', JSON.stringify(response3, null, 2));

    // Verify that we got some responses without errors
    expect(response1.length).toBeGreaterThan(0);
    expect(response2.length).toBeGreaterThan(0);
    expect(response3.length).toBeGreaterThan(0);

    // Verify the Anthropic API was called three times with appropriate parameters
    expect(mockCreate).toHaveBeenCalledTimes(3);

    // Check that the tool call chunks were properly accumulated
    // Find the message chunks that contain tool_calls (they might not be the last chunks)
    const toolCallMessage1 = response1.find(
      (msg) => msg.tool_calls !== undefined,
    );
    const toolCallMessage2 = response2.find(
      (msg) => msg.tool_calls !== undefined,
    );

    expect(toolCallMessage1).toBeDefined();
    expect(toolCallMessage1?.tool_calls?.[0].function.name).toBe(
      'search_file_content',
    );

    expect(toolCallMessage2).toBeDefined();
    expect(toolCallMessage2?.tool_calls?.[0].function.name).toBe('read_file');
  });
});
