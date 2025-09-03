/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier:Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { OpenAIProvider } from '../openai/OpenAIProvider.js';
import { ITool } from '../ITool.js';
import { IMessage } from '../IMessage.js';
import { ContentGeneratorRole } from '../ContentGeneratorRole.js';

describe('OpenAIProvider Tool Call Flow', () => {
  let provider: OpenAIProvider;
  let mockCreate: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    // Create mock OpenAI client
    mockCreate = vi.fn();

    // Override the openai property with our mock implementation
    provider = new OpenAIProvider('test-key');
    (
      provider as {
        openai: {
          chat: { completions: { create: ReturnType<typeof vi.fn> } };
          models: { list: ReturnType<typeof vi.fn> };
        };
      }
    ).openai = {
      chat: {
        completions: {
          create: mockCreate,
        },
      },
      models: {
        list: vi.fn().mockImplementation(() => ({
          [Symbol.asyncIterator]: () => ({
            next: vi.fn().mockResolvedValue({ done: true, value: undefined }),
          }),
        })),
      },
    };
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
          id: 'test-response-1',
          choices: [
            {
              index: 0,
              delta: {
                role: 'assistant',
                content: 'OK let me make a tool request\n',
              },
            },
          ],
        },
        {
          id: 'test-response-1',
          choices: [
            {
              index: 0,
              delta: {
                role: 'assistant',
                tool_calls: [
                  {
                    id: 'call_12345',
                    type: 'function',
                    function: {
                      name: 'search_file_content',
                      arguments: '{"pattern":"',
                    },
                    index: 0,
                  },
                ],
              },
            },
          ],
        },
        {
          id: 'test-response-1',
          choices: [
            {
              index: 0,
              delta: {
                role: 'assistant',
                tool_calls: [
                  {
                    function: {
                      arguments: 'code',
                    },
                    index: 0,
                  },
                ],
              },
            },
          ],
        },
        {
          id: 'test-response-1',
          choices: [
            {
              index: 0,
              delta: {
                role: 'assistant',
                tool_calls: [
                  {
                    function: {
                      arguments: '", "path": "/project"}',
                    },
                    index: 0,
                  },
                ],
              },
            },
          ],
        },
      ],
      [
        // Second response with another tool call
        {
          id: 'test-response-2',
          choices: [
            {
              index: 0,
              delta: {
                role: 'assistant',
                content: 'OK let me read a file\n',
              },
            },
          ],
        },
        {
          id: 'test-response-2',
          choices: [
            {
              index: 0,
              delta: {
                role: 'assistant',
                tool_calls: [
                  {
                    id: 'call_67890',
                    type: 'function',
                    function: {
                      name: 'read_file',
                      arguments: '{"absolute_path":"',
                    },
                    index: 0,
                  },
                ],
              },
            },
          ],
        },
        {
          id: 'test-response-2',
          choices: [
            {
              index: 0,
              delta: {
                role: 'assistant',
                tool_calls: [
                  {
                    function: {
                      arguments: '/project/main.js',
                    },
                    index: 0,
                  },
                ],
              },
            },
          ],
        },
        {
          id: 'test-response-2',
          choices: [
            {
              index: 0,
              delta: {
                role: 'assistant',
                tool_calls: [
                  {
                    function: {
                      arguments: '"}',
                    },
                    index: 0,
                  },
                ],
              },
            },
          ],
        },
      ],
      [
        // Final response
        {
          id: 'test-response-3',
          choices: [
            {
              index: 0,
              delta: {
                role: 'assistant',
                content:
                  'ok I looked through the code very nice code, delicious.\n',
              },
            },
          ],
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

    // Verify the OpenAI API was called three times with appropriate parameters
    expect(mockCreate).toHaveBeenCalledTimes(3);

    // Check that the tool call chunks were properly accumulated
    const lastResponse1Chunk = response1[response1.length - 1];
    const lastResponse2Chunk = response2[response2.length - 1];

    expect(lastResponse1Chunk.tool_calls).toBeDefined();
    expect(lastResponse1Chunk.tool_calls?.[0].function.name).toBe(
      'search_file_content',
    );

    expect(lastResponse2Chunk.tool_calls).toBeDefined();
    expect(lastResponse2Chunk.tool_calls?.[0].function.name).toBe('read_file');
  });
});
