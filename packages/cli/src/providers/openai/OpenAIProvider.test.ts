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

import { OpenAIProvider } from './OpenAIProvider';
import { vi } from 'vitest';
import OpenAI from 'openai';
import { IMessage } from '../IMessage.js';
import { ITool } from '../ITool.js';

// Mock the entire openai module
vi.mock('openai', () => {
  const mockCreate = vi.fn();
  const mockList = vi.fn();
  return {
    default: vi.fn().mockImplementation(() => ({
      chat: {
        completions: {
          create: mockCreate,
        },
      },
      models: {
        list: mockList,
      },
    })),
  };
});

describe('OpenAIProvider', () => {
  let provider: OpenAIProvider;
  let mockCreate: ReturnType<typeof vi.fn>;
  let mockList: ReturnType<typeof vi.fn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // Clear all mocks before each test
    vi.clearAllMocks();
    // Mock console.error to avoid error output during tests
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    // Initialize OpenAIProvider with dummy API key and baseURL
    provider = new OpenAIProvider('dummy-api-key', 'http://localhost');
    // Get the mocked functions from the last created OpenAI instance
    const MockedOpenAI = vi.mocked(OpenAI);
    const mockInstance =
      MockedOpenAI.mock.results[MockedOpenAI.mock.results.length - 1]?.value;
    mockCreate = mockInstance.chat.completions.create;
    mockList = mockInstance.models.list;
  });

  afterEach(() => {
    // Restore console.error
    consoleErrorSpy.mockRestore();
  });

  it('should fetch and return models from OpenAI API', async () => {
    const mockModels = [
      {
        id: 'gpt-4o',
        created: 1234567890,
        object: 'model',
        owned_by: 'openai',
      },
      {
        id: 'gpt-4o-mini',
        created: 1234567890,
        object: 'model',
        owned_by: 'openai',
      },
      {
        id: 'gpt-3.5-turbo',
        created: 1234567890,
        object: 'model',
        owned_by: 'openai',
      },
      {
        id: 'text-embedding-ada-002',
        created: 1234567890,
        object: 'model',
        owned_by: 'openai',
      },
    ];

    // Mock the list method to return an async iterator
    mockList.mockReturnValue({
      async *[Symbol.asyncIterator]() {
        for (const model of mockModels) {
          yield model;
        }
      },
    });

    const models = await provider.getModels();

    expect(mockList).toHaveBeenCalledTimes(1);
    expect(models).toEqual([
      {
        id: 'gpt-4o',
        name: 'gpt-4o',
        provider: 'openai',
        supportedToolFormats: ['openai'],
      },
      {
        id: 'gpt-4o-mini',
        name: 'gpt-4o-mini',
        provider: 'openai',
        supportedToolFormats: ['openai'],
      },
      {
        id: 'gpt-3.5-turbo',
        name: 'gpt-3.5-turbo',
        provider: 'openai',
        supportedToolFormats: ['openai'],
      },
    ]);
    // Note: text-embedding-ada-002 is filtered out because it doesn't contain 'gpt'
  });

  it('should return fallback models when API call fails', async () => {
    // Mock the list method to throw an error
    mockList.mockRejectedValue(new Error('API Error'));

    const models = await provider.getModels();

    expect(mockList).toHaveBeenCalledTimes(1);
    expect(models).toEqual([
      {
        id: 'gpt-4o',
        name: 'gpt-4o',
        provider: 'openai',
        supportedToolFormats: ['openai'],
      },
      {
        id: 'gpt-4o-mini',
        name: 'gpt-4o-mini',
        provider: 'openai',
        supportedToolFormats: ['openai'],
      },
      {
        id: 'gpt-4-turbo',
        name: 'gpt-4-turbo',
        provider: 'openai',
        supportedToolFormats: ['openai'],
      },
      {
        id: 'gpt-3.5-turbo',
        name: 'gpt-3.5-turbo',
        provider: 'openai',
        supportedToolFormats: ['openai'],
      },
    ]);
  });

  it('should stream content from generateChatCompletion', async () => {
    const mockStreamChunks = [
      { choices: [{ delta: { content: 'Hello' } }] },
      { choices: [{ delta: { content: ' world!' } }] },
      { choices: [{ delta: { content: '' } }] }, // End of content
    ];

    // Mock the create method to return an async iterator
    mockCreate.mockReturnValue({
      async *[Symbol.asyncIterator]() {
        for (const chunk of mockStreamChunks) {
          yield chunk;
        }
      },
    });

    const messages: IMessage[] = [{ role: 'user', content: 'test' }];
    const generator = provider.generateChatCompletion(messages);

    const receivedMessages: IMessage[] = [];
    for await (const msg of generator) {
      receivedMessages.push(msg);
    }

    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(receivedMessages).toEqual([
      { role: 'assistant', content: 'Hello' },
      { role: 'assistant', content: ' world!' },
      { role: 'assistant', content: 'Hello world!' },
    ]);
  });

  it('should handle tool calls from generateChatCompletion', async () => {
    const mockStreamChunks = [
      { choices: [{ delta: { content: '' } }] },
      {
        choices: [
          {
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: 'call_1',
                  function: { name: 'test_tool', arguments: '{"arg":"value"}' },
                },
              ],
            },
          },
        ],
      },
      { choices: [{ delta: { content: 'Tool response: ' } }] },
      { choices: [{ delta: { content: 'success' } }] },
      { choices: [{ delta: { content: '' } }] }, // End of content
    ];

    mockCreate.mockReturnValue({
      async *[Symbol.asyncIterator]() {
        for (const chunk of mockStreamChunks) {
          yield chunk;
        }
      },
    });

    const messages: IMessage[] = [{ role: 'user', content: 'call test_tool' }];
    const tools: ITool[] = [
      { type: 'function', function: { name: 'test_tool', parameters: {} } },
    ];
    const generator = provider.generateChatCompletion(messages, tools);

    const receivedMessages: IMessage[] = [];
    for await (const msg of generator) {
      receivedMessages.push(msg);
    }

    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(receivedMessages).toEqual([
      { role: 'assistant', content: 'Tool response: ' },
      { role: 'assistant', content: 'success' },
      {
        role: 'assistant',
        content: 'Tool response: success',
        tool_calls: [
          {
            id: 'call_1',
            type: 'function',
            function: { name: 'test_tool', arguments: '{"arg":"value"}' },
          },
        ],
      },
    ]);
  });
});
