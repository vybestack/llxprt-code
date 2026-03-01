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

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { OpenAIProvider } from './OpenAIProvider.js';
import type { IContent } from '../../services/history/IContent.js';
import { createProviderCallOptions } from '../../test-utils/providerCallOptions.js';

const mockChatCompletionsCreate = vi.hoisted(() => vi.fn());

const mockOpenAIConstructor = vi.hoisted(() =>
  vi.fn().mockImplementation(() => ({
    chat: {
      completions: {
        create: mockChatCompletionsCreate,
      },
    },
  })),
);

vi.mock('openai', () => ({
  default: mockOpenAIConstructor,
}));

vi.mock('../../core/prompts.js', () => ({
  getCoreSystemPromptAsync: vi.fn().mockResolvedValue('system prompt'),
}));

vi.mock('../../code_assist/codeAssist.js', () => ({
  createCodeAssistContentGenerator: vi.fn(),
}));

const mockSettingsService = vi.hoisted(() => ({
  set: vi.fn(),
  get: vi.fn(),
  getProviderSettings: vi.fn().mockReturnValue({}),
  updateSettings: vi.fn(),
  getAllGlobalSettings: vi.fn().mockReturnValue({}),
}));

vi.mock('../../settings/settingsServiceInstance.js', () => ({
  getSettingsService: vi.fn(() => mockSettingsService),
}));

describe('OpenAIProvider - MediaBlock support', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockChatCompletionsCreate.mockReset();
    delete process.env.OPENAI_API_KEY;
  });

  it('converts MediaBlock in user messages to image_url content parts', async () => {
    const fakeStream = {
      async *[Symbol.asyncIterator]() {
        yield {
          choices: [
            {
              delta: {
                content: 'I see the image',
              },
            },
          ],
        };
      },
    };
    mockChatCompletionsCreate.mockResolvedValueOnce(fakeStream);
    process.env.OPENAI_API_KEY = 'test-key';

    const provider = new OpenAIProvider('test-key');
    const contents: IContent[] = [
      {
        speaker: 'human',
        blocks: [
          { type: 'text', text: 'What is in this image?' },
          {
            type: 'media',
            mimeType: 'image/png',
            data: 'data1',
            encoding: 'base64' as const,
          },
          {
            type: 'media',
            mimeType: 'image/jpeg',
            data: 'data2',
            encoding: 'base64' as const,
          },
        ],
      },
    ];

    const generator = provider.generateChatCompletion(
      createProviderCallOptions({
        providerName: provider.name,
        contents,
      }),
    );

    const chunks = [];
    for await (const chunk of generator) {
      chunks.push(chunk);
    }

    expect(mockChatCompletionsCreate).toHaveBeenCalledTimes(1);
    const callArgs = mockChatCompletionsCreate.mock.calls[0][0];
    const userMessage = callArgs.messages.find(
      (m: { role: string }) => m.role === 'user',
    );
    expect(userMessage.content).toHaveLength(3);
    expect(userMessage.content[1]).toEqual({
      type: 'image_url',
      image_url: {
        url: 'data:image/png;base64,data1',
      },
    });
    expect(userMessage.content[2]).toEqual({
      type: 'image_url',
      image_url: {
        url: 'data:image/jpeg;base64,data2',
      },
    });
  });

  it('tool responses only contain text (OpenAI Chat Completions limitation)', async () => {
    const fakeStream = {
      async *[Symbol.asyncIterator]() {
        yield {
          choices: [
            {
              delta: {
                content: 'I see the screenshot',
              },
            },
          ],
        };
      },
    };
    mockChatCompletionsCreate.mockResolvedValueOnce(fakeStream);
    process.env.OPENAI_API_KEY = 'test-key';

    const provider = new OpenAIProvider('test-key');
    const contents: IContent[] = [
      {
        speaker: 'human',
        blocks: [{ type: 'text', text: 'Take a screenshot' }],
      },
      {
        speaker: 'ai',
        blocks: [
          {
            type: 'tool_call',
            id: 'call_123',
            name: 'screenshot',
            parameters: {},
          },
        ],
      },
      {
        speaker: 'tool',
        blocks: [
          {
            type: 'tool_response',
            callId: 'call_123',
            toolName: 'screenshot',
            result: 'Screenshot taken',
          },
          {
            type: 'media',
            mimeType: 'image/png',
            data: 'screenshotdata',
            encoding: 'base64',
          },
        ],
      },
    ];

    const generator = provider.generateChatCompletion(
      createProviderCallOptions({
        providerName: provider.name,
        contents,
      }),
    );

    const chunks = [];
    for await (const chunk of generator) {
      chunks.push(chunk);
    }

    expect(mockChatCompletionsCreate).toHaveBeenCalledTimes(1);
    const callArgs = mockChatCompletionsCreate.mock.calls[0][0];
    const toolMessage = callArgs.messages.find(
      (m: { role: string }) => m.role === 'tool',
    );
    expect(toolMessage).toBeDefined();
    expect(typeof toolMessage.content).toBe('string');
    expect(toolMessage.content).toContain('Screenshot taken');
  });

  it('handles user message with only MediaBlocks (no text)', async () => {
    const fakeStream = {
      async *[Symbol.asyncIterator]() {
        yield {
          choices: [
            {
              delta: {
                content: 'Image only message received',
              },
            },
          ],
        };
      },
    };
    mockChatCompletionsCreate.mockResolvedValueOnce(fakeStream);
    process.env.OPENAI_API_KEY = 'test-key';

    const provider = new OpenAIProvider('test-key');
    const contents: IContent[] = [
      {
        speaker: 'human',
        blocks: [
          {
            type: 'media',
            mimeType: 'image/png',
            data: 'imagedata',
            encoding: 'base64',
          },
        ],
      },
    ];

    const generator = provider.generateChatCompletion(
      createProviderCallOptions({
        providerName: provider.name,
        contents,
      }),
    );

    const chunks = [];
    for await (const chunk of generator) {
      chunks.push(chunk);
    }

    expect(mockChatCompletionsCreate).toHaveBeenCalledTimes(1);
    const callArgs = mockChatCompletionsCreate.mock.calls[0][0];
    const userMessage = callArgs.messages.find(
      (m: { role: string }) => m.role === 'user',
    );
    expect(userMessage.content).toHaveLength(1);
    expect(userMessage.content[0]).toEqual({
      type: 'image_url',
      image_url: {
        url: 'data:image/png;base64,imagedata',
      },
    });
  });

  it('handles MediaBlock with URL encoding', async () => {
    const fakeStream = {
      async *[Symbol.asyncIterator]() {
        yield {
          choices: [
            {
              delta: {
                content: 'URL image received',
              },
            },
          ],
        };
      },
    };
    mockChatCompletionsCreate.mockResolvedValueOnce(fakeStream);
    process.env.OPENAI_API_KEY = 'test-key';

    const provider = new OpenAIProvider('test-key');
    const contents: IContent[] = [
      {
        speaker: 'human',
        blocks: [
          {
            type: 'media',
            mimeType: 'image/png',
            data: 'https://example.com/image.png',
            encoding: 'url',
          },
        ],
      },
    ];

    const generator = provider.generateChatCompletion(
      createProviderCallOptions({
        providerName: provider.name,
        contents,
      }),
    );

    const chunks = [];
    for await (const chunk of generator) {
      chunks.push(chunk);
    }

    expect(mockChatCompletionsCreate).toHaveBeenCalledTimes(1);
    const callArgs = mockChatCompletionsCreate.mock.calls[0][0];
    const userMessage = callArgs.messages.find(
      (m: { role: string }) => m.role === 'user',
    );
    expect(userMessage.content[0]).toEqual({
      type: 'image_url',
      image_url: {
        url: 'https://example.com/image.png',
      },
    });
  });
});
