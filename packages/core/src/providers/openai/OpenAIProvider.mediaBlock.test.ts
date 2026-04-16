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
    expect(userMessage.content[1]).toStrictEqual({
      type: 'image_url',
      image_url: {
        url: 'data:image/png;base64,data1',
      },
    });
    expect(userMessage.content[2]).toStrictEqual({
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

    // Tool message should NOT contain image placeholder (images go to synthetic user message)
    const toolMessage = callArgs.messages.find(
      (m: { role: string }) => m.role === 'tool',
    );
    expect(toolMessage).toBeDefined();
    expect(typeof toolMessage.content).toBe('string');
    expect(toolMessage.content).toContain('Screenshot taken');
    expect(toolMessage.content).not.toContain('Unsupported');
    expect(toolMessage.content).not.toContain('image/png');

    // Synthetic user message should contain the image
    const syntheticUserMessage = callArgs.messages.find(
      (m: { role: string; content?: unknown }) =>
        m.role === 'user' &&
        Array.isArray(m.content) &&
        m.content.some(
          (c: { type: string; text?: string }) =>
            c.type === 'text' && c.text?.includes('Images from tool response'),
        ),
    );
    expect(syntheticUserMessage).toBeDefined();
    expect(syntheticUserMessage.content).toHaveLength(2);
    expect(syntheticUserMessage.content[1]).toStrictEqual({
      type: 'image_url',
      image_url: {
        url: 'data:image/png;base64,screenshotdata',
      },
    });
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
    expect(userMessage.content[0]).toStrictEqual({
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
    expect(userMessage.content[0]).toStrictEqual({
      type: 'image_url',
      image_url: {
        url: 'https://example.com/image.png',
      },
    });
  });

  it('converts PDF MediaBlock in user message to file content part', async () => {
    const fakeStream = {
      async *[Symbol.asyncIterator]() {
        yield {
          choices: [{ delta: { content: 'PDF received' } }],
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
          { type: 'text', text: 'Summarize this document' },
          {
            type: 'media',
            mimeType: 'application/pdf',
            data: 'JVBERi0xLjQ=',
            encoding: 'base64',
            filename: 'report.pdf',
          },
        ],
      },
    ];

    const generator = provider.generateChatCompletion(
      createProviderCallOptions({ providerName: provider.name, contents }),
    );
    for await (const _chunk of generator) {
      /* drain */
    }

    const callArgs = mockChatCompletionsCreate.mock.calls[0][0];
    const userMessage = callArgs.messages.find(
      (m: { role: string }) => m.role === 'user',
    );
    expect(userMessage.content).toHaveLength(2);
    expect(userMessage.content[1]).toStrictEqual({
      type: 'file',
      file: {
        filename: 'report.pdf',
        file_data: 'data:application/pdf;base64,JVBERi0xLjQ=',
      },
    });
  });

  it('produces text placeholder for unsupported media in user message', async () => {
    const fakeStream = {
      async *[Symbol.asyncIterator]() {
        yield {
          choices: [{ delta: { content: 'ok' } }],
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
          { type: 'text', text: 'Listen' },
          {
            type: 'media',
            mimeType: 'audio/mpeg',
            data: 'audiodata',
            encoding: 'base64',
            filename: 'song.mp3',
          },
        ],
      },
    ];

    const generator = provider.generateChatCompletion(
      createProviderCallOptions({ providerName: provider.name, contents }),
    );
    for await (const _chunk of generator) {
      /* drain */
    }

    const callArgs = mockChatCompletionsCreate.mock.calls[0][0];
    const userMessage = callArgs.messages.find(
      (m: { role: string }) => m.role === 'user',
    );
    expect(userMessage.content).toHaveLength(2);
    const placeholder = userMessage.content[1];
    expect(placeholder.type).toBe('text');
    expect(placeholder.text).toContain('audio/mpeg');
    expect(placeholder.text).toContain('song.mp3');
  });

  it('never silently drops media - each MediaBlock produces output', async () => {
    const fakeStream = {
      async *[Symbol.asyncIterator]() {
        yield {
          choices: [{ delta: { content: 'ok' } }],
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
          { type: 'text', text: 'Mixed' },
          {
            type: 'media',
            mimeType: 'image/png',
            data: 'img',
            encoding: 'base64',
          },
          {
            type: 'media',
            mimeType: 'application/pdf',
            data: 'pdf',
            encoding: 'base64',
          },
          {
            type: 'media',
            mimeType: 'video/mp4',
            data: 'vid',
            encoding: 'base64',
          },
        ],
      },
    ];

    const generator = provider.generateChatCompletion(
      createProviderCallOptions({ providerName: provider.name, contents }),
    );
    for await (const _chunk of generator) {
      /* drain */
    }

    const callArgs = mockChatCompletionsCreate.mock.calls[0][0];
    const userMessage = callArgs.messages.find(
      (m: { role: string }) => m.role === 'user',
    );
    expect(userMessage.content).toHaveLength(4);
    expect(userMessage.content[1].type).toBe('image_url');
    expect(userMessage.content[2].type).toBe('file');
    expect(userMessage.content[3].type).toBe('text');
    expect(userMessage.content[3].text).toContain('video/mp4');
  });

  describe('tool response image injection', () => {
    it('injects images as synthetic user message', async () => {
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

      // Find tool message and synthetic user message
      const toolMessage = callArgs.messages.find(
        (m: { role: string }) => m.role === 'tool',
      );
      const syntheticUserMessage = callArgs.messages.find(
        (m: { role: string; content?: unknown }) =>
          m.role === 'user' &&
          Array.isArray(m.content) &&
          m.content.some(
            (c: { type: string; text?: string }) =>
              c.type === 'text' &&
              c.text?.includes('Images from tool response'),
          ),
      );

      // Tool message should NOT contain image placeholder
      expect(toolMessage).toBeDefined();
      expect(typeof toolMessage.content).toBe('string');
      expect(toolMessage.content).toContain('Screenshot taken');
      expect(toolMessage.content).not.toContain('Unsupported');
      expect(toolMessage.content).not.toContain('image/png');

      // Synthetic user message should contain the image
      expect(syntheticUserMessage).toBeDefined();
      expect(syntheticUserMessage.content).toHaveLength(2);
      expect(syntheticUserMessage.content[0]).toStrictEqual({
        type: 'text',
        text: '[Images from tool response]',
      });
      expect(syntheticUserMessage.content[1]).toStrictEqual({
        type: 'image_url',
        image_url: {
          url: 'data:image/png;base64,screenshotdata',
        },
      });
    });

    it('does not inject synthetic message when no images in tool response', async () => {
      const fakeStream = {
        async *[Symbol.asyncIterator]() {
          yield {
            choices: [
              {
                delta: {
                  content: 'Done',
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
          blocks: [{ type: 'text', text: 'Run command' }],
        },
        {
          speaker: 'ai',
          blocks: [
            {
              type: 'tool_call',
              id: 'call_123',
              name: 'execute_command',
              parameters: { command: 'ls' },
            },
          ],
        },
        {
          speaker: 'tool',
          blocks: [
            {
              type: 'tool_response',
              callId: 'call_123',
              toolName: 'execute_command',
              result: 'file1.txt file2.txt',
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

      // Count user messages (excluding the original human message)
      const userMessages = callArgs.messages.filter(
        (m: { role: string }) => m.role === 'user',
      );

      // Should only have the original human message, no synthetic image message
      expect(userMessages).toHaveLength(1);
      expect(userMessages[0].content).toBe('Run command');
    });

    it('handles mixed media types', async () => {
      const fakeStream = {
        async *[Symbol.asyncIterator]() {
          yield {
            choices: [
              {
                delta: {
                  content: 'I see the files',
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
          blocks: [{ type: 'text', text: 'Process files' }],
        },
        {
          speaker: 'ai',
          blocks: [
            {
              type: 'tool_call',
              id: 'call_123',
              name: 'process_files',
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
              toolName: 'process_files',
              result: 'Files processed',
            },
            {
              type: 'media',
              mimeType: 'image/png',
              data: 'imagedata',
              encoding: 'base64',
            },
            {
              type: 'media',
              mimeType: 'video/mp4',
              data: 'videodata',
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
      const syntheticUserMessage = callArgs.messages.find(
        (m: { role: string; content?: unknown }) =>
          m.role === 'user' &&
          Array.isArray(m.content) &&
          m.content.some(
            (c: { type: string; text?: string }) =>
              c.type === 'text' &&
              c.text?.includes('Images from tool response'),
          ),
      );

      // Tool message should only contain video placeholder (non-image media)
      expect(toolMessage).toBeDefined();
      expect(typeof toolMessage.content).toBe('string');
      expect(toolMessage.content).toContain('Files processed');
      expect(toolMessage.content).toContain('video/mp4'); // Non-image placeholder
      expect(toolMessage.content).not.toContain('image/png'); // Image not in tool message

      // Synthetic user message should only contain the image
      expect(syntheticUserMessage).toBeDefined();
      expect(syntheticUserMessage.content).toHaveLength(2);
      expect(syntheticUserMessage.content[0]).toStrictEqual({
        type: 'text',
        text: '[Images from tool response]',
      });
      expect(syntheticUserMessage.content[1]).toStrictEqual({
        type: 'image_url',
        image_url: {
          url: 'data:image/png;base64,imagedata',
        },
      });
    });
  });
});
