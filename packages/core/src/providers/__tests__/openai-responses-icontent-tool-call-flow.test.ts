/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { OpenAIResponsesProvider } from '../openai-responses/OpenAIResponsesProvider.js';
import { ITool } from '../ITool.js';
import { IContent } from '../../services/history/IContent.js';

describe('OpenAIResponsesProvider IContent Tool Call Flow', () => {
  let provider: OpenAIResponsesProvider;
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    // Create mock fetch
    mockFetch = vi.fn();

    // Override the fetch property with our mock implementation
    provider = new OpenAIResponsesProvider('test-key');
    global.fetch = mockFetch;

    // Mock the getAuthToken method to return our test key
    vi.spyOn(
      provider as { getAuthToken: () => Promise<string> },
      'getAuthToken',
    ).mockResolvedValue('test-key');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should handle tool call sequence correctly with IContent', async () => {
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

    // Set up our mock streaming responses for each call to generateChatCompletionIContent (will fail initially)
    const mockResponses = [
      [
        // First response with tool call - stream chunks
        {
          id: 'chatcmpl-1',
          object: 'chat.completion.chunk',
          created: 1700000000,
          model: 'o3-mini',
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
          id: 'chatcmpl-1',
          object: 'chat.completion.chunk',
          created: 1700000000,
          model: 'o3-mini',
          choices: [
            {
              index: 0,
              delta: {
                tool_calls: [
                  {
                    id: 'call_12345',
                    type: 'function',
                    function: {
                      name: 'search_file_content',
                    },
                  },
                ],
              },
            },
          ],
        },
        {
          id: 'chatcmpl-1',
          object: 'chat.completion.chunk',
          created: 1700000000,
          model: 'o3-mini',
          choices: [
            {
              index: 0,
              delta: {
                tool_calls: [
                  {
                    id: 'call_12345',
                    type: 'function',
                    function: {
                      arguments: '{"pattern":"',
                    },
                  },
                ],
              },
            },
          ],
        },
        {
          id: 'chatcmpl-1',
          object: 'chat.completion.chunk',
          created: 1700000000,
          model: 'o3-mini',
          choices: [
            {
              index: 0,
              delta: {
                tool_calls: [
                  {
                    id: 'call_12345',
                    type: 'function',
                    function: {
                      arguments: 'code',
                    },
                  },
                ],
              },
            },
          ],
        },
        {
          id: 'chatcmpl-1',
          object: 'chat.completion.chunk',
          created: 1700000000,
          model: 'o3-mini',
          choices: [
            {
              index: 0,
              delta: {
                tool_calls: [
                  {
                    id: 'call_12345',
                    type: 'function',
                    function: {
                      arguments: '", "path": "/project"}',
                    },
                  },
                ],
              },
            },
          ],
        },
        {
          id: 'chatcmpl-1',
          object: 'chat.completion.chunk',
          created: 1700000000,
          model: 'o3-mini',
          choices: [
            {
              index: 0,
              finish_reason: 'tool_calls',
            },
          ],
        },
      ],
      [
        // Second response with another tool call
        {
          id: 'chatcmpl-2',
          object: 'chat.completion.chunk',
          created: 1700000001,
          model: 'o3-mini',
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
          id: 'chatcmpl-2',
          object: 'chat.completion.chunk',
          created: 1700000001,
          model: 'o3-mini',
          choices: [
            {
              index: 0,
              delta: {
                tool_calls: [
                  {
                    id: 'call_67890',
                    type: 'function',
                    function: {
                      name: 'read_file',
                    },
                  },
                ],
              },
            },
          ],
        },
        {
          id: 'chatcmpl-2',
          object: 'chat.completion.chunk',
          created: 1700000001,
          model: 'o3-mini',
          choices: [
            {
              index: 0,
              delta: {
                tool_calls: [
                  {
                    id: 'call_67890',
                    type: 'function',
                    function: {
                      arguments: '{"absolute_path":"',
                    },
                  },
                ],
              },
            },
          ],
        },
        {
          id: 'chatcmpl-2',
          object: 'chat.completion.chunk',
          created: 1700000001,
          model: 'o3-mini',
          choices: [
            {
              index: 0,
              delta: {
                tool_calls: [
                  {
                    id: 'call_67890',
                    type: 'function',
                    function: {
                      arguments: '/project/main.js',
                    },
                  },
                ],
              },
            },
          ],
        },
        {
          id: 'chatcmpl-2',
          object: 'chat.completion.chunk',
          created: 1700000001,
          model: 'o3-mini',
          choices: [
            {
              index: 0,
              delta: {
                tool_calls: [
                  {
                    id: 'call_67890',
                    type: 'function',
                    function: {
                      arguments: '"}',
                    },
                  },
                ],
              },
            },
          ],
        },
        {
          id: 'chatcmpl-2',
          object: 'chat.completion.chunk',
          created: 1700000001,
          model: 'o3-mini',
          choices: [
            {
              index: 0,
              finish_reason: 'tool_calls',
            },
          ],
        },
      ],
      [
        // Final response
        {
          id: 'chatcmpl-3',
          object: 'chat.completion.chunk',
          created: 1700000002,
          model: 'o3-mini',
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
        {
          id: 'chatcmpl-3',
          object: 'chat.completion.chunk',
          created: 1700000002,
          model: 'o3-mini',
          choices: [
            {
              index: 0,
              finish_reason: 'stop',
            },
          ],
        },
      ],
    ];

    // Mock the fetch method to return different sequences for each call
    let responseIndex = 0;
    mockFetch.mockImplementation(() => {
      const responses = mockResponses[responseIndex++];

      // Create a mock readable stream from the responses
      const mockStream = new ReadableStream({
        start(controller) {
          // Queue all responses
          responses.forEach((response) => {
            controller.enqueue(
              new TextEncoder().encode(`data: ${JSON.stringify(response)}\n\n`),
            );
          });
          controller.close();
        },
      });

      return Promise.resolve({
        ok: true,
        body: mockStream,
        json: () => Promise.resolve(responses[responses.length - 1]), // Return the last response for non-streaming
      });
    });

    // Test sequence:
    // 1. User message -> AI message with tool call -> Tool response -> AI final message

    // First round: user asks to look through code
    const messages1: IContent[] = [
      {
        speaker: 'human',
        blocks: [{ type: 'text', text: 'Look through the code' }],
      },
    ];

    const response1: IContent[] = [];
    for await (const chunk of provider.generateChatCompletionIContent(
      messages1,
      tools,
    )) {
      response1.push(chunk);
    }

    // Log what we actually got
    console.log('Response 1 length:', response1.length);
    console.log('Response 1 content:', JSON.stringify(response1, null, 2));

    // Second round: add tool response and get next AI message with another tool call
    const toolResponse1: IContent = {
      speaker: 'tool',
      blocks: [
        {
          type: 'tool_response',
          callId: 'call_12345',
          toolName: 'search_file_content',
          result: 'Found 3 files with code pattern',
        },
      ],
    };

    const messages2: IContent[] = [...messages1, ...response1, toolResponse1];

    const response2: IContent[] = [];
    for await (const chunk of provider.generateChatCompletionIContent(
      messages2,
      tools,
    )) {
      response2.push(chunk);
    }

    // Log what we actually got
    console.log('Response 2 length:', response2.length);
    console.log('Response 2 content:', JSON.stringify(response2, null, 2));

    // Third round: add second tool response and get final AI message
    const toolResponse2: IContent = {
      speaker: 'tool',
      blocks: [
        {
          type: 'tool_response',
          callId: 'call_67890',
          toolName: 'read_file',
          result: 'File content: console.log("Hello world");',
        },
      ],
    };

    const messages3: IContent[] = [...messages2, ...response2, toolResponse2];

    const response3: IContent[] = [];
    for await (const chunk of provider.generateChatCompletionIContent(
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

    // Check that the tool call chunks were properly accumulated
    // Find the IContent chunks that contain tool_call blocks
    const toolCallContent1 = response1.find((content) =>
      content.blocks.find((block) => block.type === 'tool_call'),
    );
    const toolCallContent2 = response2.find((content) =>
      content.blocks.find((block) => block.type === 'tool_call'),
    );

    expect(toolCallContent1).toBeDefined();
    expect(toolCallContent1?.blocks[0].type).toBe('tool_call');
    expect((toolCallContent1?.blocks[0] as { name?: string })?.name).toBe(
      'search_file_content',
    );

    expect(toolCallContent2).toBeDefined();
    expect(toolCallContent2?.blocks[0].type).toBe('tool_call');
    expect((toolCallContent2?.blocks[0] as { name?: string })?.name).toBe(
      'read_file',
    );
  });
});
