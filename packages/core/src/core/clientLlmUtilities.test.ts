/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./prompts.js', () => ({
  getCoreSystemPromptAsync: vi.fn().mockResolvedValue('test system prompt'),
}));

vi.mock('./clientToolGovernance.js', () => ({
  getEnabledToolNamesForPrompt: vi.fn().mockReturnValue(['tool1', 'tool2']),
  shouldIncludeSubagentDelegationForConfig: vi.fn().mockResolvedValue(false),
}));

vi.mock('../utils/errorReporting.js', () => ({
  reportError: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../utils/retry.js', () => ({
  retryWithBackoff: vi.fn((fn: () => Promise<unknown>) => fn()),
}));

import {
  generateJson,
  generateContent,
  generateEmbedding,
} from './clientLlmUtilities.js';
import type { Config } from '../config/config.js';
import type { ContentGenerator } from './contentGenerator.js';
import type { BaseLLMClient } from './baseLlmClient.js';
import type { GenerateContentResponse } from '@google/genai';
import { getCoreSystemPromptAsync } from './prompts.js';

const TEST_MODEL = 'test-model';
const SESSION_ID = 'session-id';
const SYSTEM_PROMPT = 'test system prompt';
const USER_MEMORY = 'user memory';
const EMBEDDING_MODEL = 'embedding-model';

function makeConfig(overrides: Partial<Config> = {}): Config {
  return {
    getUserMemory: vi.fn().mockReturnValue(USER_MEMORY),
    getMcpClientManager: vi.fn().mockReturnValue(undefined),
    isInteractive: vi.fn().mockReturnValue(true),
    ...overrides,
  } as unknown as Config;
}

function makeContentGenerator(
  overrides: Partial<ContentGenerator> = {},
): ContentGenerator {
  return {
    generateContent: vi.fn().mockResolvedValue({
      candidates: [{ content: { parts: [{ text: '{"key":"value"}' }] } }],
    }),
    generateContentStream: vi.fn(),
    countTokens: vi.fn(),
    embedContent: vi.fn(),
    ...overrides,
  } as unknown as ContentGenerator;
}

function makeBaseLlmClient(
  overrides: Partial<BaseLLMClient> = {},
): BaseLLMClient {
  return {
    generateJson: vi.fn().mockResolvedValue({ key: 'value' }),
    generateEmbedding: vi.fn().mockResolvedValue([[0.1, 0.2, 0.3]]),
    countTokens: vi.fn(),
    generateContent: vi.fn(),
    ...overrides,
  } as unknown as BaseLLMClient;
}

describe('generateJson', () => {
  let config: Config;
  let contentGenerator: ContentGenerator;
  let baseLlmClient: BaseLLMClient;
  const abortSignal = new AbortController().signal;

  beforeEach(() => {
    config = makeConfig();
    contentGenerator = makeContentGenerator();
    baseLlmClient = makeBaseLlmClient();
    vi.clearAllMocks();
    vi.mocked(getCoreSystemPromptAsync).mockResolvedValue(SYSTEM_PROMPT);
  });

  it('returns parsed JSON for valid model response', async () => {
    const contents = [{ role: 'user', parts: [{ text: 'hello' }] }];
    const schema = { type: 'object' };

    const result = await generateJson(
      config,
      contentGenerator,
      baseLlmClient,
      contents,
      schema,
      abortSignal,
      TEST_MODEL,
      {},
      SESSION_ID,
    );

    expect(result).toStrictEqual({ key: 'value' });
  });

  it('uses lightweight system prompt (getCoreSystemPromptAsync, no env context)', async () => {
    const contents = [{ role: 'user', parts: [{ text: 'hello' }] }];

    await generateJson(
      config,
      contentGenerator,
      baseLlmClient,
      contents,
      {},
      abortSignal,
      TEST_MODEL,
      {},
      SESSION_ID,
    );

    expect(getCoreSystemPromptAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        userMemory: USER_MEMORY,
        model: TEST_MODEL,
      }),
    );
  });

  it('converts plain text "user"/"model" responses for next_speaker checks', async () => {
    vi.mocked(baseLlmClient.generateJson).mockResolvedValue(
      'user' as unknown as Record<string, unknown>,
    );

    const contents = [
      { role: 'user', parts: [{ text: 'determine next_speaker please' }] },
    ];

    const result = await generateJson(
      config,
      contentGenerator,
      baseLlmClient,
      contents,
      {},
      abortSignal,
      TEST_MODEL,
      {},
      SESSION_ID,
    );

    expect(result).toStrictEqual({
      reasoning: 'Gemini returned plain text response',
      next_speaker: 'user',
    });
  });

  it('rethrows errors when not aborted', async () => {
    const apiError = new Error('API failure');
    vi.mocked(baseLlmClient.generateJson).mockRejectedValue(apiError);

    const contents = [{ role: 'user', parts: [{ text: 'hello' }] }];

    await expect(
      generateJson(
        config,
        contentGenerator,
        baseLlmClient,
        contents,
        {},
        abortSignal,
        TEST_MODEL,
        {},
        SESSION_ID,
      ),
    ).rejects.toThrow('API failure');
  });
});

describe('generateContent', () => {
  let config: Config;
  let contentGenerator: ContentGenerator;
  const abortSignal = new AbortController().signal;
  const mockResponse: GenerateContentResponse = {
    candidates: [{ content: { parts: [{ text: 'generated text' }] } }],
  } as GenerateContentResponse;

  beforeEach(() => {
    config = makeConfig();
    contentGenerator = makeContentGenerator({
      generateContent: vi.fn().mockResolvedValue(mockResponse),
    });
    vi.clearAllMocks();
    vi.mocked(getCoreSystemPromptAsync).mockResolvedValue(SYSTEM_PROMPT);
  });

  it('returns generated content with merged config', async () => {
    const contents = [{ role: 'user', parts: [{ text: 'write something' }] }];
    const baseConfig = { temperature: 0, topP: 1 };

    const result = await generateContent(
      config,
      contentGenerator,
      contents,
      { temperature: 0.5 },
      abortSignal,
      TEST_MODEL,
      SESSION_ID,
      baseConfig,
    );

    expect(result).toBe(mockResponse);
    expect(contentGenerator.generateContent).toHaveBeenCalledWith(
      expect.objectContaining({
        model: TEST_MODEL,
        config: expect.objectContaining({
          temperature: 0.5,
          topP: 1,
          systemInstruction: SYSTEM_PROMPT,
        }),
      }),
      SESSION_ID,
    );
  });

  it('uses lightweight system prompt (getCoreSystemPromptAsync, no env context)', async () => {
    const contents = [{ role: 'user', parts: [{ text: 'hello' }] }];

    await generateContent(
      config,
      contentGenerator,
      contents,
      {},
      abortSignal,
      TEST_MODEL,
      SESSION_ID,
      {},
    );

    expect(getCoreSystemPromptAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        userMemory: USER_MEMORY,
        model: TEST_MODEL,
      }),
    );
    expect(getCoreSystemPromptAsync).not.toHaveBeenCalledWith(
      expect.objectContaining({ envParts: expect.anything() }),
    );
  });

  it('wraps and rethrows non-abort errors with model name', async () => {
    vi.mocked(contentGenerator.generateContent).mockRejectedValue(
      new Error('network error'),
    );

    const contents = [{ role: 'user', parts: [{ text: 'hello' }] }];

    await expect(
      generateContent(
        config,
        contentGenerator,
        contents,
        {},
        abortSignal,
        TEST_MODEL,
        SESSION_ID,
        {},
      ),
    ).rejects.toThrow(`Failed to generate content with model ${TEST_MODEL}`);
  });
});

describe('generateEmbedding', () => {
  let baseLlmClient: BaseLLMClient;

  beforeEach(() => {
    baseLlmClient = makeBaseLlmClient();
  });

  it('returns empty array for empty input without calling API', async () => {
    const result = await generateEmbedding(baseLlmClient, [], EMBEDDING_MODEL);

    expect(result).toStrictEqual([]);
    expect(baseLlmClient.generateEmbedding).not.toHaveBeenCalled();
  });

  it('delegates to BaseLLMClient and returns embeddings', async () => {
    const embeddings = [
      [0.1, 0.2],
      [0.3, 0.4],
    ];
    vi.mocked(baseLlmClient.generateEmbedding).mockResolvedValue(embeddings);

    const result = await generateEmbedding(
      baseLlmClient,
      ['text1', 'text2'],
      EMBEDDING_MODEL,
    );

    expect(result).toStrictEqual(embeddings);
    expect(baseLlmClient.generateEmbedding).toHaveBeenCalledWith({
      text: ['text1', 'text2'],
      model: EMBEDDING_MODEL,
    });
  });
});
