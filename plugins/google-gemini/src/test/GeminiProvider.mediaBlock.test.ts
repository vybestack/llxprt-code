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

import { assertInstanceOf } from './testSupport.js';
import { describe, it, expect, beforeEach, afterEach, vi } from 'bun:test';
import { GeminiProvider } from '../gemini/GeminiProvider.js';
import type {
  IContent,
  MediaReferenceBlock,
} from '@vybestack/llxprt-code-core/services/history/IContent.js';
import {
  createProviderCallOptions as createOptions,
  type ProviderCallOptionsInit,
} from './testSupport.js';
function isStream(
  value: readonly IContent[] | AsyncIterable<IContent>,
): value is AsyncIterable<IContent> {
  return Symbol.asyncIterator in value;
}
function createProviderCallOptions(
  init: Omit<ProviderCallOptionsInit, 'contents'> & {
    contents?: readonly IContent[] | AsyncIterable<IContent>;
  },
): ReturnType<typeof createOptions> {
  const rows = init.contents ?? [];
  const contents: AsyncIterable<IContent> = isStream(rows)
    ? rows
    : {
        async *[Symbol.asyncIterator](): AsyncGenerator<IContent> {
          yield* rows;
        },
      };
  return createOptions({ ...init, contents });
}

import type {
  RequestMediaResolutionService,
  ResolvedMediaRequest,
} from '@vybestack/llxprt-code-core/storage/request-media-resolver.js';

const realLlxprtCodeSettingsModule = {
  ...(await import('@vybestack/llxprt-code-settings')),
};

const generateContentStreamMock = vi.fn();

// The provider releases the SDK `Content[]` once the call settles (issue #854
// WP09), so requests are snapshotted at call time for later assertions.
interface SentRequest {
  contents: Array<{ role: string; parts: Array<Record<string, unknown>> }>;
}
let sentRequests: SentRequest[] = [];

const googleGenAIConstructor = vi.fn().mockImplementation(() => ({
  models: {
    generateContentStream: (request: SentRequest) => {
      sentRequests.push(structuredClone(request));
      return generateContentStreamMock(request);
    },
  },
}));

import type { CreateGeminiApiClient } from '../gemini/GeminiProvider.js';
// The factory is injected into GeminiProvider rather than module-mocked:
// `vi.mock` registers process-wide and bun hoists it ahead of the whole
// run, so the stub leaked into every suite loaded alongside this one.
const injectedClientFactory =
  googleGenAIConstructor as unknown as CreateGeminiApiClient;

void vi.mock('@vybestack/llxprt-code-core/core/prompts.js', () => ({
  getCoreSystemPromptAsync: vi.fn().mockResolvedValue('system prompt'),
}));

const mockSettingsService = {
  set: vi.fn(),
  get: vi.fn(),
  getProviderSettings: vi.fn().mockReturnValue({}),
  updateSettings: vi.fn(),
  getAllGlobalSettings: vi.fn().mockReturnValue({}),
};

void vi.mock('@vybestack/llxprt-code-settings', () => ({
  ...realLlxprtCodeSettingsModule,
  getSettingsService: vi.fn(() => mockSettingsService),
}));

describe('GeminiProvider - MediaBlock support', () => {
  const originalGeminiApiKey = process.env.GEMINI_API_KEY;

  beforeEach(() => {
    vi.clearAllMocks();
    generateContentStreamMock.mockReset();
    sentRequests = [];
    delete process.env.GEMINI_API_KEY;
  });

  afterEach(() => {
    if (originalGeminiApiKey === undefined) {
      delete process.env.GEMINI_API_KEY;
    } else {
      process.env.GEMINI_API_KEY = originalGeminiApiKey;
    }
  });

  it(
    'converts MediaBlock in user messages to inlineData parts',
    convertsUserMedia,
  );

  it(
    'handles multiple MediaBlocks in a single user message',
    convertsMultipleMedia,
  );

  it('handles user message with only MediaBlocks (no text)', convertsMediaOnly);

  it('handles URL-encoded MediaBlock with fileData', convertsUrlMedia);

  it(
    'handles MediaBlock with data URI (already prefixed)',
    stripsDataUriPrefix,
  );

  it(
    'converts PDF MediaBlock to inlineData (Gemini handles all media generically)',
    convertsPdfMedia,
  );

  it(
    'handles audio and video media generically (no silent drops)',
    convertsAudioMedia,
  );

  it(
    'preserves stream and media-release failures in one aggregate error',
    preservesGenerationAndReleaseFailures,
  );
});

async function convertsUserMedia(): Promise<void> {
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

  const provider = new GeminiProvider(
    'test-key',
    undefined,
    undefined,
    injectedClientFactory,
  );
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
  const callArgs = sentRequests[0];
  expect(callArgs.contents).toBeDefined();
  expect(callArgs.contents).toHaveLength(1);
  expect(callArgs.contents[0].role).toBe('user');
  expect(callArgs.contents[0].parts).toHaveLength(2);
  expect(callArgs.contents[0].parts[0]).toStrictEqual({
    text: 'What is in this image?',
  });
  expect(callArgs.contents[0].parts[1]).toStrictEqual({
    inlineData: {
      mimeType: 'image/png',
      data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    },
  });
}

async function convertsMultipleMedia(): Promise<void> {
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

  const provider = new GeminiProvider(
    'test-key',
    undefined,
    undefined,
    injectedClientFactory,
  );
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
  const callArgs = sentRequests[0];
  expect(callArgs.contents[0].parts).toHaveLength(3);
  expect(callArgs.contents[0].parts[0]).toStrictEqual({
    text: 'Compare these images:',
  });
  expect(callArgs.contents[0].parts[1]).toStrictEqual({
    inlineData: {
      mimeType: 'image/png',
      data: 'data1',
    },
  });
  expect(callArgs.contents[0].parts[2]).toStrictEqual({
    inlineData: {
      mimeType: 'image/jpeg',
      data: 'data2',
    },
  });
}

async function convertsMediaOnly(): Promise<void> {
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

  const provider = new GeminiProvider(
    'test-key',
    undefined,
    undefined,
    injectedClientFactory,
  );
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
  const callArgs = sentRequests[0];
  expect(callArgs.contents[0].parts).toHaveLength(1);
  expect(callArgs.contents[0].parts[0]).toStrictEqual({
    inlineData: {
      mimeType: 'image/png',
      data: 'imagedata',
    },
  });
}

async function convertsUrlMedia(): Promise<void> {
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

  const provider = new GeminiProvider(
    'test-key',
    undefined,
    undefined,
    injectedClientFactory,
  );
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
  const callArgs = sentRequests[0];
  expect(callArgs.contents[0].parts[0]).toStrictEqual({
    fileData: {
      mimeType: 'image/png',
      fileUri: 'https://example.com/image.png',
    },
  });
}

async function stripsDataUriPrefix(): Promise<void> {
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

  const provider = new GeminiProvider(
    'test-key',
    undefined,
    undefined,
    injectedClientFactory,
  );
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
  const callArgs = sentRequests[0];
  // Gemini expects just the base64 data, not the data URI prefix
  expect(callArgs.contents[0].parts[0]).toStrictEqual({
    inlineData: {
      mimeType: 'image/png',
      data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    },
  });
}

async function convertsPdfMedia(): Promise<void> {
  const fakeStream = {
    async *[Symbol.asyncIterator]() {
      yield {
        candidates: [
          {
            content: {
              parts: [{ text: 'PDF content analyzed' }],
            },
          },
        ],
      };
    },
  };
  generateContentStreamMock.mockResolvedValueOnce(fakeStream);
  process.env.GEMINI_API_KEY = 'test-key';

  const provider = new GeminiProvider(
    'test-key',
    undefined,
    undefined,
    injectedClientFactory,
  );
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

  for await (const _chunk of generator) {
    /* drain */
  }

  expect(generateContentStreamMock).toHaveBeenCalledTimes(1);
  const callArgs = sentRequests[0];
  expect(callArgs.contents[0].parts).toHaveLength(2);
  expect(callArgs.contents[0].parts[1]).toStrictEqual({
    inlineData: {
      mimeType: 'application/pdf',
      data: 'JVBERi0xLjQ=',
    },
  });
}

async function convertsAudioMedia(): Promise<void> {
  const fakeStream = {
    async *[Symbol.asyncIterator]() {
      yield {
        candidates: [
          {
            content: {
              parts: [{ text: 'Media received' }],
            },
          },
        ],
      };
    },
  };
  generateContentStreamMock.mockResolvedValueOnce(fakeStream);
  process.env.GEMINI_API_KEY = 'test-key';

  const provider = new GeminiProvider(
    'test-key',
    undefined,
    undefined,
    injectedClientFactory,
  );
  const contents: IContent[] = [
    {
      speaker: 'human',
      blocks: [
        { type: 'text', text: 'Analyze this' },
        {
          type: 'media',
          mimeType: 'audio/mpeg',
          data: 'audiodata',
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

  for await (const _chunk of generator) {
    /* drain */
  }

  expect(generateContentStreamMock).toHaveBeenCalledTimes(1);
  const callArgs = sentRequests[0];
  expect(callArgs.contents[0].parts).toHaveLength(2);
  expect(callArgs.contents[0].parts[1]).toStrictEqual({
    inlineData: {
      mimeType: 'audio/mpeg',
      data: 'audiodata',
    },
  });
}

async function preservesGenerationAndReleaseFailures(): Promise<void> {
  const reference = createFailureMediaReference();
  const materialized: IContent[] = [
    {
      speaker: 'human',
      blocks: [
        {
          type: 'media',
          mimeType: 'image/png',
          encoding: 'base64',
          data: 'QUJD',
        },
      ],
    },
  ];
  const request: ResolvedMediaRequest = {
    withContents: (consume) => consume(materialized),
    registerCleanup: () => {},
    accounting: () => ({
      selectedReferenceCount: 1,
      uniqueContentCount: 1,
      selectedNormalizedBytes: 4,
      materializedNormalizedBytes: 4,
      storeReadCount: 1,
      reservedContentCount: 1,
      released: false,
    }),
    release: async () => {
      throw new Error('media release failed');
    },
  };
  const mediaResolver: RequestMediaResolutionService = {
    resolve: async () => request,
  };
  generateContentStreamMock.mockResolvedValueOnce({
    [Symbol.asyncIterator]: () => ({
      next: async () => {
        throw new Error('stream generation failed');
      },
    }),
  });
  const provider = new GeminiProvider(
    'test-key',
    undefined,
    undefined,
    injectedClientFactory,
  );
  const options = createProviderCallOptions({
    providerName: provider.name,
    contents: [{ speaker: 'human', blocks: [reference] }],
  });
  const iterator = provider.generateChatCompletion({
    ...options,
    runtime: { ...options.runtime, mediaResolver },
  });

  let error: unknown;
  try {
    for await (const _content of iterator) {
      throw new Error('Unexpected Gemini content');
    }
  } catch (reason) {
    error = reason;
  }

  assertInstanceOf(
    error,
    AggregateError,
    'Expected generation and release AggregateError',
  );
  expect(error.errors).toStrictEqual([
    new Error('stream generation failed'),
    new Error('media release failed'),
  ]);
}

function createFailureMediaReference(): MediaReferenceBlock {
  const contentId =
    'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
  return {
    type: 'media' as const,
    mimeType: 'image/png',
    encoding: 'reference' as const,
    contentId,
    originalContentId: contentId,
    selectedContentId: contentId,
    originalObject: {
      contentId,
      mimeType: 'image/png',
      byteLength: 3,
      normalizedBase64Length: 4,
    },
    selectedObject: {
      contentId,
      mimeType: 'image/png',
      byteLength: 3,
      normalizedBase64Length: 4,
    },
    transformation: {
      policyId: 'identity',
      policyVersion: 1,
      parameters: {},
    },
    byteLength: 3,
    normalizedBase64Length: 4,
    semanticMetadata: {},
  };
}
