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

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { GeminiProvider } from './GeminiProvider.js';
import type { IContent } from '../../services/history/IContent.js';
import { createProviderCallOptions } from '../../test-utils/providerCallOptions.js';

const generateContentStreamMock = vi.hoisted(() => vi.fn());

const googleGenAIConstructor = vi.hoisted(() =>
  vi.fn().mockImplementation(() => ({
    models: {
      generateContentStream: generateContentStreamMock,
    },
  })),
);

vi.mock('@google/genai', () => ({
  GoogleGenAI: googleGenAIConstructor,
  Type: { OBJECT: 'object' },
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

describe('GeminiProvider - MediaBlock support', () => {
  const originalGeminiApiKey = process.env.GEMINI_API_KEY;

  beforeEach(() => {
    vi.clearAllMocks();
    generateContentStreamMock.mockReset();
    delete process.env.GEMINI_API_KEY;
  });

  afterEach(() => {
    if (originalGeminiApiKey === undefined) {
      delete process.env.GEMINI_API_KEY;
    } else {
      process.env.GEMINI_API_KEY = originalGeminiApiKey;
    }
  });

  it('converts MediaBlock in user messages to inlineData parts', async () => {
    const fakeStream = {
      async *[Symbol.asyncIterator]() {
        yield {
          candidates: [
            {
              content: {
                parts: [{ text: 'I see the image' }],
              },
            },
          ],
        };
      },
    };
    generateContentStreamMock.mockResolvedValueOnce(fakeStream);
    process.env.GEMINI_API_KEY = 'test-key';

    const provider = new GeminiProvider('test-key');
    const contents: IContent[] = [
      {
        speaker: 'human',
        blocks: [
          { type: 'text', text: 'What is in this image?' },
          {
            type: 'media',
            mimeType: 'image/png',
            data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
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

    expect(generateContentStreamMock).toHaveBeenCalledTimes(1);
    const callArgs = generateContentStreamMock.mock.calls[0][0];
    expect(callArgs.contents).toBeDefined();
    expect(callArgs.contents).toHaveLength(1);
    expect(callArgs.contents[0].role).toBe('user');
    expect(callArgs.contents[0].parts).toHaveLength(2);
    expect(callArgs.contents[0].parts[0]).toEqual({
      text: 'What is in this image?',
    });
    expect(callArgs.contents[0].parts[1]).toEqual({
      inlineData: {
        mimeType: 'image/png',
        data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      },
    });
  });

  it('handles multiple MediaBlocks in a single user message', async () => {
    const fakeStream = {
      async *[Symbol.asyncIterator]() {
        yield {
          candidates: [
            {
              content: {
                parts: [{ text: 'Two images received' }],
              },
            },
          ],
        };
      },
    };
    generateContentStreamMock.mockResolvedValueOnce(fakeStream);
    process.env.GEMINI_API_KEY = 'test-key';

    const provider = new GeminiProvider('test-key');
    const contents: IContent[] = [
      {
        speaker: 'human',
        blocks: [
          { type: 'text', text: 'Compare these images:' },
          {
            type: 'media',
            mimeType: 'image/png',
            data: 'data1',
            encoding: 'base64',
          },
          {
            type: 'media',
            mimeType: 'image/jpeg',
            data: 'data2',
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

    expect(generateContentStreamMock).toHaveBeenCalledTimes(1);
    const callArgs = generateContentStreamMock.mock.calls[0][0];
    expect(callArgs.contents[0].parts).toHaveLength(3);
    expect(callArgs.contents[0].parts[0]).toEqual({
      text: 'Compare these images:',
    });
    expect(callArgs.contents[0].parts[1]).toEqual({
      inlineData: {
        mimeType: 'image/png',
        data: 'data1',
      },
    });
    expect(callArgs.contents[0].parts[2]).toEqual({
      inlineData: {
        mimeType: 'image/jpeg',
        data: 'data2',
      },
    });
  });

  it('handles user message with only MediaBlocks (no text)', async () => {
    const fakeStream = {
      async *[Symbol.asyncIterator]() {
        yield {
          candidates: [
            {
              content: {
                parts: [{ text: 'Image only message received' }],
              },
            },
          ],
        };
      },
    };
    generateContentStreamMock.mockResolvedValueOnce(fakeStream);
    process.env.GEMINI_API_KEY = 'test-key';

    const provider = new GeminiProvider('test-key');
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

    expect(generateContentStreamMock).toHaveBeenCalledTimes(1);
    const callArgs = generateContentStreamMock.mock.calls[0][0];
    expect(callArgs.contents[0].parts).toHaveLength(1);
    expect(callArgs.contents[0].parts[0]).toEqual({
      inlineData: {
        mimeType: 'image/png',
        data: 'imagedata',
      },
    });
  });

  it('handles URL-encoded MediaBlock with fileData', async () => {
    const fakeStream = {
      async *[Symbol.asyncIterator]() {
        yield {
          candidates: [
            {
              content: {
                parts: [{ text: 'URL image received' }],
              },
            },
          ],
        };
      },
    };
    generateContentStreamMock.mockResolvedValueOnce(fakeStream);
    process.env.GEMINI_API_KEY = 'test-key';

    const provider = new GeminiProvider('test-key');
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

    expect(generateContentStreamMock).toHaveBeenCalledTimes(1);
    const callArgs = generateContentStreamMock.mock.calls[0][0];
    expect(callArgs.contents[0].parts[0]).toEqual({
      fileData: {
        mimeType: 'image/png',
        fileUri: 'https://example.com/image.png',
      },
    });
  });

  it('handles MediaBlock with data URI (already prefixed)', async () => {
    const fakeStream = {
      async *[Symbol.asyncIterator]() {
        yield {
          candidates: [
            {
              content: {
                parts: [{ text: 'Data URI image received' }],
              },
            },
          ],
        };
      },
    };
    generateContentStreamMock.mockResolvedValueOnce(fakeStream);
    process.env.GEMINI_API_KEY = 'test-key';

    const provider = new GeminiProvider('test-key');
    const contents: IContent[] = [
      {
        speaker: 'human',
        blocks: [
          {
            type: 'media',
            mimeType: 'image/png',
            data: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
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

    expect(generateContentStreamMock).toHaveBeenCalledTimes(1);
    const callArgs = generateContentStreamMock.mock.calls[0][0];
    // Gemini expects just the base64 data, not the data URI prefix
    expect(callArgs.contents[0].parts[0]).toEqual({
      inlineData: {
        mimeType: 'image/png',
        data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      },
    });
  });
});
