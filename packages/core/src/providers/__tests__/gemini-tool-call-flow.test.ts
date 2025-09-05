/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier:Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ITool } from '../ITool.js';
import { IMessage } from '../IMessage.js';
import { ContentGeneratorRole } from '../ContentGeneratorRole.js';

// Mock the '@google/genai' module before importing the provider
const mockGenerateContentStream = vi.fn();
const mockModels = {
  generateContentStream: mockGenerateContentStream,
};

vi.mock('@google/genai', () => ({
  GoogleGenAI: vi.fn().mockImplementation(() => ({
    models: mockModels,
  })),
}));

// Now import the provider after mocking
import { GeminiProvider } from '../gemini/GeminiProvider.js';

describe('GeminiProvider Tool Call Flow', () => {
  let provider: GeminiProvider;

  beforeEach(() => {
    // Create provider and mock its dependencies
    provider = new GeminiProvider();

    // Mock methods that are not directly related to our test
    vi.spyOn(
      provider as { hasVertexAICredentials: () => boolean },
      'hasVertexAICredentials',
    ).mockReturnValue(false);
    vi.spyOn(
      provider as { hasGeminiAPIKey: () => boolean },
      'hasGeminiAPIKey',
    ).mockReturnValue(true);
    vi.spyOn(
      provider as { getAuthToken: () => Promise<string> },
      'getAuthToken',
    ).mockResolvedValue('test-key');

    // Create different mock streaming responses for each call to generateChatCompletion
    const mockResponses = [
      // First call: returns search_file_content tool call
      {
        [Symbol.asyncIterator]: () => {
          let index = 0;
          const responses = [
            {
              candidates: [
                {
                  content: {
                    parts: [
                      { text: 'OK let me make a tool request\n' },
                      {
                        functionCall: {
                          id: 'call_12345',
                          name: 'search_file_content',
                          args: { pattern: 'code', path: '/project' },
                        },
                      },
                    ],
                  },
                },
              ],
            },
          ];

          return {
            next: () => {
              if (index < responses.length) {
                return Promise.resolve({
                  done: false,
                  value: responses[index++],
                });
              }
              return Promise.resolve({
                done: true,
                value: undefined,
              });
            },
          };
        },
      },
      // Second call: returns read_file tool call
      {
        [Symbol.asyncIterator]: () => {
          let index = 0;
          const responses = [
            {
              candidates: [
                {
                  content: {
                    parts: [
                      { text: 'OK let me read a file\n' },
                      {
                        functionCall: {
                          id: 'call_67890',
                          name: 'read_file',
                          args: { absolute_path: '/project/main.js' },
                        },
                      },
                    ],
                  },
                },
              ],
            },
          ];

          return {
            next: () => {
              if (index < responses.length) {
                return Promise.resolve({
                  done: false,
                  value: responses[index++],
                });
              }
              return Promise.resolve({
                done: true,
                value: undefined,
              });
            },
          };
        },
      },
      // Third call: returns final response without tool calls
      {
        [Symbol.asyncIterator]: () => {
          let index = 0;
          const responses = [
            {
              candidates: [
                {
                  content: {
                    parts: [
                      {
                        text: 'ok I looked through the code very nice code, delicious.\n',
                      },
                    ],
                  },
                },
              ],
            },
          ];

          return {
            next: () => {
              if (index < responses.length) {
                return Promise.resolve({
                  done: false,
                  value: responses[index++],
                });
              }
              return Promise.resolve({
                done: true,
                value: undefined,
              });
            },
          };
        },
      },
    ];

    // Mock the generateContentStream method to return different sequences for each call
    let responseIndex = 0;
    mockGenerateContentStream.mockImplementation(
      () => mockResponses[responseIndex++],
    );
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

    // Verify the Gemini API was called three times with appropriate parameters
    expect(mockGenerateContentStream).toHaveBeenCalledTimes(3);

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
