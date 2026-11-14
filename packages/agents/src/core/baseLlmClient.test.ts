/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterAll,
  type Mock,
} from 'bun:test';
import { BaseLLMClient } from './baseLlmClient.js';
import type { ContentGenerator } from '@vybestack/llxprt-code-core/core/contentGenerator.js';
import type { ModelOutput } from '@vybestack/llxprt-code-core/llm-types/index.js';

const realRetryModule = {
  ...(await import('@vybestack/llxprt-code-core/utils/retry.js')),
};

// Mock retryWithBackoff to immediately call the function once without delays
void vi.mock('@vybestack/llxprt-code-core/utils/retry.js', () => ({
  retryWithBackoff: vi.fn(
    async <T>(
      fn: () => Promise<T>,
      options?: { shouldRetryOnContent?: (response: T) => boolean },
    ) => {
      const result = await fn();
      if (options?.shouldRetryOnContent?.(result) === true) {
        throw new Error('Retry attempts exhausted');
      }
      return result;
    },
  ),
}));

function textModelOutput(text: string): ModelOutput {
  return {
    content: {
      speaker: 'ai',
      blocks: [{ type: 'text', text }],
    },
  };
}

let mockContentGenerator: ContentGenerator;
let baseLlmClient: BaseLLMClient;
describe('BaseLLMClient', () => {
  beforeEach(setupClient);
  describe('generateJson', () => {
    it(
      'should generate valid JSON from a prompt',
      testShouldGenerateValidJSONFromAPrompt1,
    );
    it(
      'should handle JSON wrapped in markdown code blocks',
      testShouldHandleJSONWrappedInMarkdownCodeBlocks2,
    );
    it(
      'should use provided schema for validation',
      testShouldUseProvidedSchemaForValidation3,
    );
    it(
      'should handle generation errors gracefully',
      testShouldHandleGenerationErrorsGracefully4,
    );
    it('should handle empty response', testShouldHandleEmptyResponse5);
    it(
      'should handle invalid JSON in response',
      testShouldHandleInvalidJSONInResponse6,
    );
    it(
      'should support custom temperature',
      testShouldSupportCustomTemperature7,
    );
  });
  describe('generateEmbedding', () => {
    it(
      'should generate embeddings for text',
      testShouldGenerateEmbeddingsForText8,
    );
    it(
      'should handle multiple text inputs',
      testShouldHandleMultipleTextInputs9,
    );
    it('should handle embedding errors', testShouldHandleEmbeddingErrors10);
    it(
      'should validate embeddings response',
      testShouldValidateEmbeddingsResponse11,
    );
  });
  describe('countTokens', () => {
    it('should count tokens in text', testShouldCountTokensInText12);
    it('should handle count errors', testShouldHandleCountErrors13);
    it('should handle contents array', testShouldHandleContentsArray14);
  });
  describe('generateContent', () => {
    it(
      'should call generateContent with correct parameters',
      testShouldCallGenerateContentWithCorrectParameters15,
    );
    it('should handle empty response', testShouldHandleEmptyResponse16);
    it(
      'should support system instruction',
      testShouldSupportSystemInstruction17,
    );
  });
  describe('constructor', () => {
    it(
      'should throw if contentGenerator is not provided',
      testShouldThrowIfContentGeneratorIsNotProvided18,
    );
    it(
      'should accept a valid ContentGenerator',
      testShouldAcceptAValidContentGenerator19,
    );
  });
  afterAll(restoreRetry);
});

async function testShouldGenerateValidJSONFromAPrompt1(): Promise<void> {
  (
    mockContentGenerator.generateContent as Mock<
      typeof mockContentGenerator.generateContent
    >
  ).mockResolvedValue(textModelOutput('{"name": "test", "value": 42}'));

  const result = await baseLlmClient.generateJson({
    prompt: 'Generate a JSON object with name and value',
    model: 'gemini-pro',
  });

  expect(result).toStrictEqual({ name: 'test', value: 42 });
  expect(mockContentGenerator.generateContent).toHaveBeenCalledTimes(1);
}

async function testShouldHandleJSONWrappedInMarkdownCodeBlocks2(): Promise<void> {
  (
    mockContentGenerator.generateContent as Mock<
      typeof mockContentGenerator.generateContent
    >
  ).mockResolvedValue(textModelOutput('```json\n{"status": "ok"}\n```'));

  const result = await baseLlmClient.generateJson({
    prompt: 'Generate status',
    model: 'gemini-pro',
  });

  expect(result).toStrictEqual({ status: 'ok' });
}

async function testShouldUseProvidedSchemaForValidation3(): Promise<void> {
  (
    mockContentGenerator.generateContent as Mock<
      typeof mockContentGenerator.generateContent
    >
  ).mockResolvedValue(textModelOutput('{"required": "field"}'));

  const schema = {
    type: 'object',
    properties: {
      required: { type: 'string' },
    },
    required: ['required'],
  };

  await baseLlmClient.generateJson({
    prompt: 'Generate data',
    schema,
    model: 'gemini-pro',
  });

  const callArgs = (
    mockContentGenerator.generateContent as Mock<
      typeof mockContentGenerator.generateContent
    >
  ).mock.calls[0][0];
  expect(callArgs.settings?.responseJsonSchema).toStrictEqual(schema);
  expect(callArgs.modelParams?.responseMimeType).toBe('application/json');
}

async function testShouldHandleGenerationErrorsGracefully4(): Promise<void> {
  (
    mockContentGenerator.generateContent as Mock<
      typeof mockContentGenerator.generateContent
    >
  ).mockRejectedValue(new Error('API Error'));

  await expect(
    baseLlmClient.generateJson({
      prompt: 'Generate data',
      model: 'gemini-pro',
    }),
  ).rejects.toThrow('Failed to generate content: API Error');
}

async function testShouldHandleEmptyResponse5(): Promise<void> {
  (
    mockContentGenerator.generateContent as Mock<
      typeof mockContentGenerator.generateContent
    >
  ).mockResolvedValue(textModelOutput(''));

  await expect(
    baseLlmClient.generateJson({
      prompt: 'Generate data',
      model: 'gemini-pro',
    }),
  ).rejects.toThrow('Failed to generate content');
}

async function testShouldHandleInvalidJSONInResponse6(): Promise<void> {
  (
    mockContentGenerator.generateContent as Mock<
      typeof mockContentGenerator.generateContent
    >
  ).mockResolvedValue(textModelOutput('not valid json'));

  await expect(
    baseLlmClient.generateJson({
      prompt: 'Generate data',
      model: 'gemini-pro',
    }),
  ).rejects.toThrow('Failed to generate content');
}

async function testShouldSupportCustomTemperature7(): Promise<void> {
  (
    mockContentGenerator.generateContent as Mock<
      typeof mockContentGenerator.generateContent
    >
  ).mockResolvedValue(textModelOutput('{"temp": "test"}'));

  await baseLlmClient.generateJson({
    prompt: 'Generate data',
    model: 'gemini-pro',
    temperature: 0.7,
  });

  const callArgs = (
    mockContentGenerator.generateContent as Mock<
      typeof mockContentGenerator.generateContent
    >
  ).mock.calls[0][0];
  expect(callArgs.settings?.temperature).toBe(0.7);
}

async function testShouldGenerateEmbeddingsForText8(): Promise<void> {
  (
    mockContentGenerator.embedContent as Mock<
      typeof mockContentGenerator.embedContent
    >
  ).mockResolvedValue({
    embeddings: [[0.1, 0.2, 0.3, 0.4, 0.5]],
  });

  const result = await baseLlmClient.generateEmbedding({
    text: 'test text',
    model: 'embedding-001',
  });

  expect(result).toStrictEqual([0.1, 0.2, 0.3, 0.4, 0.5]);
  expect(mockContentGenerator.embedContent).toHaveBeenCalledTimes(1);
}

async function testShouldHandleMultipleTextInputs9(): Promise<void> {
  (
    mockContentGenerator.embedContent as Mock<
      typeof mockContentGenerator.embedContent
    >
  ).mockResolvedValue({
    embeddings: [
      [0.1, 0.2],
      [0.3, 0.4],
    ],
  });

  const result = await baseLlmClient.generateEmbedding({
    text: ['text1', 'text2'],
    model: 'embedding-001',
  });

  expect(result).toStrictEqual([
    [0.1, 0.2],
    [0.3, 0.4],
  ]);
}

async function testShouldHandleEmbeddingErrors10(): Promise<void> {
  (
    mockContentGenerator.embedContent as Mock<
      typeof mockContentGenerator.embedContent
    >
  ).mockRejectedValue(new Error('Embedding failed'));

  await expect(
    baseLlmClient.generateEmbedding({
      text: 'test',
      model: 'embedding-001',
    }),
  ).rejects.toThrow('Failed to generate embedding: Embedding failed');
}

async function testShouldValidateEmbeddingsResponse11(): Promise<void> {
  (
    mockContentGenerator.embedContent as Mock<
      typeof mockContentGenerator.embedContent
    >
  ).mockResolvedValue({
    embeddings: [],
  });

  await expect(
    baseLlmClient.generateEmbedding({
      text: 'test',
      model: 'embedding-001',
    }),
  ).rejects.toThrow('No embeddings found in API response');
}

async function testShouldCountTokensInText12(): Promise<void> {
  (
    mockContentGenerator.countTokens as Mock<
      typeof mockContentGenerator.countTokens
    >
  ).mockResolvedValue({
    totalTokens: 42,
  });

  const result = await baseLlmClient.countTokens({
    text: 'test text',
    model: 'gemini-pro',
  });

  expect(result).toBe(42);
  expect(mockContentGenerator.countTokens).toHaveBeenCalledTimes(1);
}

async function testShouldHandleCountErrors13(): Promise<void> {
  (
    mockContentGenerator.countTokens as Mock<
      typeof mockContentGenerator.countTokens
    >
  ).mockRejectedValue(new Error('Count failed'));

  await expect(
    baseLlmClient.countTokens({
      text: 'test',
      model: 'gemini-pro',
    }),
  ).rejects.toThrow('Failed to count tokens: Count failed');
}

async function testShouldHandleContentsArray14(): Promise<void> {
  (
    mockContentGenerator.countTokens as Mock<
      typeof mockContentGenerator.countTokens
    >
  ).mockResolvedValue({
    totalTokens: 100,
  });

  const result = await baseLlmClient.countTokens({
    contents: [
      { speaker: 'human', blocks: [{ type: 'text', text: 'message 1' }] },
      { speaker: 'ai', blocks: [{ type: 'text', text: 'response 1' }] },
    ],
    model: 'gemini-pro',
  });

  expect(result).toBe(100);
  const callArgs = (
    mockContentGenerator.countTokens as Mock<
      typeof mockContentGenerator.countTokens
    >
  ).mock.calls[0][0];
  expect(callArgs.contents).toHaveLength(2);
}

async function testShouldCallGenerateContentWithCorrectParameters15(): Promise<void> {
  const mockOutput = textModelOutput('This is the content.');
  (
    mockContentGenerator.generateContent as Mock<
      typeof mockContentGenerator.generateContent
    >
  ).mockResolvedValue(mockOutput);

  const abortController = new AbortController();
  const options = {
    model: 'test-model',
    contents: [
      {
        speaker: 'human',
        blocks: [{ type: 'text', text: 'Give me content.' }],
      },
    ],
    abortSignal: abortController.signal,
    promptId: 'content-prompt-id',
  } as const;

  const result = await baseLlmClient.generateContent(options);

  expect(result).toBe(mockOutput);

  expect(mockContentGenerator.generateContent).toHaveBeenCalledTimes(1);
  const callArgs = (
    mockContentGenerator.generateContent as Mock<
      typeof mockContentGenerator.generateContent
    >
  ).mock.calls[0][0];
  expect(callArgs.model).toBe('test-model');
  expect(callArgs.settings?.temperature).toBe(0);
  expect(callArgs.settings?.topP).toBe(1);
}

async function testShouldHandleEmptyResponse16(): Promise<void> {
  (
    mockContentGenerator.generateContent as Mock<
      typeof mockContentGenerator.generateContent
    >
  ).mockResolvedValue(textModelOutput(''));

  const abortController = new AbortController();
  const options = {
    model: 'test-model',
    contents: [
      {
        speaker: 'human',
        blocks: [{ type: 'text', text: 'Give me content.' }],
      },
    ],
    abortSignal: abortController.signal,
    promptId: 'content-prompt-id',
  } as const;

  await expect(baseLlmClient.generateContent(options)).rejects.toThrow(
    'Failed to generate content',
  );
}

async function testShouldSupportSystemInstruction17(): Promise<void> {
  (
    mockContentGenerator.generateContent as Mock<
      typeof mockContentGenerator.generateContent
    >
  ).mockResolvedValue(textModelOutput('Response with instruction.'));

  const abortController = new AbortController();
  await baseLlmClient.generateContent({
    model: 'test-model',
    contents: [{ speaker: 'human', blocks: [{ type: 'text', text: 'Query' }] }],
    systemInstruction: 'Be helpful',
    abortSignal: abortController.signal,
    promptId: 'test-id',
  });

  const callArgs = (
    mockContentGenerator.generateContent as Mock<
      typeof mockContentGenerator.generateContent
    >
  ).mock.calls[0][0];
  expect(callArgs.settings?.systemInstruction).toBe('Be helpful');
}

function testShouldThrowIfContentGeneratorIsNotProvided18(): void {
  expect(() => {
    new BaseLLMClient(null as unknown as ContentGenerator);
  }).toThrow('ContentGenerator is required');
}

function testShouldAcceptAValidContentGenerator19(): void {
  expect(() => new BaseLLMClient(mockContentGenerator)).not.toThrow();
}

function setupClient(): void {
  mockContentGenerator = {
    generateContent: vi.fn(),
    generateContentStream: vi.fn(),
    countTokens: vi.fn(),
    embedContent: vi.fn(),
  };
  baseLlmClient = new BaseLLMClient(mockContentGenerator);
}
function restoreRetry(): void {
  void vi.mock(
    '@vybestack/llxprt-code-core/utils/retry.js',
    () => realRetryModule,
  );
}
