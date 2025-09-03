/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GeminiProvider } from '../gemini/GeminiProvider.js';
import { IContent } from '../../services/history/IContent.js';

describe('GeminiProvider IContent Tool Call Flow', () => {
  let provider: GeminiProvider;
  let mockGenerateContentStream: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    // Create mock Gemini client
    mockGenerateContentStream = vi.fn();

    // Override the Gemini property with our mock implementation
    provider = new GeminiProvider('test-key');
    (
      provider as unknown as {
        gemini: {
          getGenerativeModel: () => {
            generateContentStream: ReturnType<typeof vi.fn>;
          };
        };
      }
    ).gemini = {
      getGenerativeModel: () => ({
        generateContentStream: mockGenerateContentStream,
      }),
    };

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
    // Define tools in Gemini format for the test
    const tools = [
      {
        functionDeclarations: [
          {
            name: 'search_file_content',
            description: 'Search through file content',
            parameters: {
              type: 'OBJECT',
              properties: {
                pattern: { type: 'STRING' },
                path: { type: 'STRING' },
              },
              required: ['pattern', 'path'],
            },
          },
          {
            name: 'read_file',
            description: 'Read a file',
            parameters: {
              type: 'OBJECT',
              properties: {
                absolute_path: { type: 'STRING' },
              },
              required: ['absolute_path'],
            },
          },
        ],
      },
    ];

    // Set up our mock streaming responses for each call to generateChatCompletionIContent (will fail initially)
    const mockResponses = [
      [
        // First response with tool call - stream chunks
        {
          candidates: [
            {
              content: {
                role: 'model',
                parts: [
                  {
                    text: 'OK let me make a tool request\n',
                  },
                ],
              },
            },
          ],
        },
        {
          candidates: [
            {
              content: {
                role: 'model',
                parts: [
                  {
                    functionCall: {
                      name: 'search_file_content',
                      args: {
                        pattern: 'code',
                        // Using normalized hist_tool_ prefix for ID
                        callId: 'hist_tool_12345',
                      },
                    },
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
          candidates: [
            {
              content: {
                role: 'model',
                parts: [
                  {
                    text: 'OK let me read a file\n',
                  },
                ],
              },
            },
          ],
        },
        {
          candidates: [
            {
              content: {
                role: 'model',
                parts: [
                  {
                    functionCall: {
                      name: 'read_file',
                      args: {
                        absolute_path: '/project/main.js',
                        // Using normalized hist_tool_ prefix for ID
                        callId: 'hist_tool_67890',
                      },
                    },
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
          candidates: [
            {
              content: {
                role: 'model',
                parts: [
                  {
                    text: 'ok I looked through the code very nice code, delicious.\n',
                  },
                ],
              },
            },
          ],
        },
      ],
    ];

    // Mock the generateChatCompletion method to return IMessage chunks
    vi.spyOn(provider, 'generateChatCompletion').mockImplementation(
      async function* (_messages, _tools) {
        // Determine which mock response to use based on the messages
        const messageContent = JSON.stringify(_messages);
        let mockResponseIndex = 0;

        if (messageContent.includes('tool')) {
          // Count tool messages to determine response index
          const toolCount = (messageContent.match(/"role":"tool"/g) || [])
            .length;
          mockResponseIndex = Math.min(toolCount, mockResponses.length - 1);
        }

        const mockData = mockResponses[mockResponseIndex] || [];

        for (const chunk of mockData) {
          // Convert Gemini response to IMessage
          if (chunk && typeof chunk === 'object' && 'candidates' in chunk) {
            const candidates = (chunk as { candidates: unknown[] }).candidates;
            if (candidates && candidates[0]) {
              const candidate = candidates[0] as {
                content: { role: string; parts: unknown[] };
              };
              if (candidate.content) {
                let hasText = false;
                let hasToolCalls = false;
                let textContent = '';
                const toolCalls: unknown[] = [];

                for (const part of candidate.content.parts) {
                  if ('text' in (part as object)) {
                    hasText = true;
                    textContent += (part as { text: string }).text;
                  } else if ('functionCall' in (part as object)) {
                    hasToolCalls = true;
                    const fc = (part as { functionCall: unknown })
                      .functionCall as {
                      name: string;
                      args: Record<string, unknown>;
                      callId?: string;
                    };
                    // Extract callId from args if present
                    const callId =
                      fc.callId ||
                      (fc.args.callId as string) ||
                      `hist_tool_${Date.now()}`;
                    // Remove callId from args to clean up
                    const cleanArgs = { ...fc.args };
                    delete (cleanArgs as { callId?: string }).callId;

                    toolCalls.push({
                      id: callId,
                      type: 'function',
                      function: {
                        name: fc.name,
                        arguments: JSON.stringify(cleanArgs),
                      },
                    });
                  }
                }

                if (hasText) {
                  yield {
                    role: 'assistant',
                    content: textContent,
                  };
                }

                if (hasToolCalls) {
                  yield {
                    role: 'assistant',
                    content: '',
                    tool_calls: toolCalls,
                  };
                }
              }
            }
          }
        }
      },
    );

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
          callId: 'hist_tool_12345',
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
          callId: 'hist_tool_67890',
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

    // Verify the generateChatCompletion was called three times
    expect(provider.generateChatCompletion).toHaveBeenCalledTimes(3);

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

  it('should correctly serialize/deserialize Gemini tool call responses', async () => {
    // We'll add another test case here to specifically test the serialization/deserialization of tool calls

    // Define tools in Gemini format for the test
    const tools = [
      {
        functionDeclarations: [
          {
            name: 'write_file',
            description: 'Write content to a file',
            parameters: {
              type: 'OBJECT',
              properties: {
                file_path: { type: 'STRING' },
                content: { type: 'STRING' },
              },
              required: ['file_path', 'content'],
            },
          },
        ],
      },
    ];

    // Mock responses for testing serialization/deserialization
    const mockResponses = [
      [
        {
          candidates: [
            {
              content: {
                role: 'model',
                parts: [
                  {
                    functionCall: {
                      name: 'write_file',
                      args: {
                        file_path: '/project/new_file.txt',
                        content: 'Hello world!',
                        // Using normalized hist_tool_ prefix for ID
                        callId: 'hist_tool_99999',
                      },
                    },
                  },
                ],
              },
            },
          ],
        },
      ],
    ];

    // Mock the generateContentStream method
    // Mock the generateChatCompletion method to return IMessage chunks
    vi.spyOn(provider, 'generateChatCompletion').mockImplementation(
      async function* (_messages, _tools) {
        const mockData = mockResponses[0] || [];

        for (const chunk of mockData) {
          // Convert Gemini response to IMessage
          if (chunk && typeof chunk === 'object' && 'candidates' in chunk) {
            const candidates = (chunk as { candidates: unknown[] }).candidates;
            if (candidates && candidates[0]) {
              const candidate = candidates[0] as {
                content: { role: string; parts: unknown[] };
              };
              if (candidate.content) {
                const toolCalls: unknown[] = [];

                for (const part of candidate.content.parts) {
                  if ('functionCall' in (part as object)) {
                    const fc = (part as { functionCall: unknown })
                      .functionCall as {
                      name: string;
                      args: Record<string, unknown>;
                      callId?: string;
                    };
                    // Extract callId from args if present
                    const callId =
                      fc.callId ||
                      (fc.args.callId as string) ||
                      `hist_tool_${Date.now()}`;
                    // Remove callId from args to clean up
                    const cleanArgs = { ...fc.args };
                    delete (cleanArgs as { callId?: string }).callId;

                    toolCalls.push({
                      id: callId,
                      type: 'function',
                      function: {
                        name: fc.name,
                        arguments: JSON.stringify(cleanArgs),
                      },
                    });
                  }
                }

                if (toolCalls.length > 0) {
                  yield {
                    role: 'assistant',
                    content: '',
                    tool_calls: toolCalls,
                  };
                }
              }
            }
          }
        }
      },
    );

    // Test serialization/deserialization
    const messages: IContent[] = [
      {
        speaker: 'human',
        blocks: [{ type: 'text', text: 'Create a new file with content' }],
      },
    ];

    const response: IContent[] = [];
    for await (const chunk of provider.generateChatCompletionIContent(
      messages,
      tools,
    )) {
      response.push(chunk);
    }

    // Find the first tool_call block
    const toolCallContent = response.find((content) =>
      content.blocks.find((block) => block.type === 'tool_call'),
    );

    // Assert it exists and has the expected callId format
    expect(toolCallContent).toBeDefined();
    expect(toolCallContent?.blocks[0].type).toBe('tool_call');
    expect((toolCallContent?.blocks[0] as { id?: string })?.id).toBeDefined();

    // Check that the id is normalized with 'hist_tool_' prefix
    expect((toolCallContent?.blocks[0] as { id?: string })?.id).toMatch(
      /^hist_tool_/,
    );
  });
});
