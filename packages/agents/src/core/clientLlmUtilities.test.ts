/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, type Mock } from 'bun:test';

void vi.mock('@vybestack/llxprt-code-core/core/prompts.js', () => ({
  getCoreSystemPromptAsync: vi.fn().mockResolvedValue('test system prompt'),
}));

void vi.mock('./clientToolGovernance.js', () => ({
  getEnabledToolNamesForPrompt: vi.fn().mockReturnValue(['tool1', 'tool2']),
  shouldIncludeSubagentDelegationForConfig: vi.fn().mockResolvedValue(false),
}));

void vi.mock('@vybestack/llxprt-code-core/utils/errorReporting.js', () => ({
  reportError: vi.fn().mockResolvedValue(undefined),
}));

void vi.mock('@vybestack/llxprt-code-core/utils/retry.js', () => ({
  retryWithBackoff: vi.fn((fn: () => Promise<unknown>) => fn()),
}));

import {
  generateJson,
  generateContent,
  generateEmbedding,
} from './clientLlmUtilities.js';
import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import type { ContentGenerator } from '@vybestack/llxprt-code-core/core/contentGenerator.js';
import type { BaseLLMClient } from './baseLlmClient.js';
import type { ModelOutput } from '@vybestack/llxprt-code-core/llm-types/index.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { getCoreSystemPromptAsync } from '@vybestack/llxprt-code-core/core/prompts.js';

const TEST_MODEL = 'test-model';
const SESSION_ID = 'session-id';
const SYSTEM_PROMPT = 'test system prompt';
const USER_MEMORY = 'user memory';
const EMBEDDING_MODEL = 'embedding-model';

function makeConfig(overrides: Partial<Config> = {}): Config {
  return {
    getUserMemory: vi.fn().mockReturnValue(USER_MEMORY),
    getCoreMemory: vi.fn().mockReturnValue(undefined),
    getMcpInstructions: vi.fn().mockReturnValue(undefined),
    isInteractive: vi.fn().mockReturnValue(true),
    getSettingsService: vi.fn().mockReturnValue({
      get: vi.fn().mockReturnValue(undefined),
    }),
    ...overrides,
  } as unknown as Config;
}

function makeContentGenerator(
  overrides: Partial<ContentGenerator> = {},
): ContentGenerator {
  return {
    generateContent: vi.fn().mockResolvedValue({
      content: {
        speaker: 'ai',
        blocks: [{ type: 'text', text: '{"key":"value"}' }],
      },
    } as ModelOutput),
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
    (
      getCoreSystemPromptAsync as Mock<typeof getCoreSystemPromptAsync>
    ).mockResolvedValue(SYSTEM_PROMPT);
  });

  it('returns parsed JSON for valid model response', async () => {
    const contents = [
      {
        speaker: 'human',
        blocks: [{ type: 'text', text: 'hello' }],
      } as IContent,
    ];
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

  it('uses the request provider in the lightweight system prompt', async () => {
    const contents = [
      {
        speaker: 'human',
        blocks: [{ type: 'text', text: 'hello' }],
      } as IContent,
    ];

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
      'request-provider',
    );

    expect(getCoreSystemPromptAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        userMemory: USER_MEMORY,
        model: TEST_MODEL,
        provider: 'request-provider',
      }),
    );
  });

  it('converts plain text "user"/"model" responses for next_speaker checks', async () => {
    (
      baseLlmClient.generateJson as Mock<typeof baseLlmClient.generateJson>
    ).mockResolvedValue('user' as unknown as Record<string, unknown>);

    const contents = [
      {
        speaker: 'human',
        blocks: [{ type: 'text', text: 'determine next_speaker please' }],
      } as IContent,
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
    (
      baseLlmClient.generateJson as Mock<typeof baseLlmClient.generateJson>
    ).mockRejectedValue(apiError);

    const contents = [
      {
        speaker: 'human',
        blocks: [{ type: 'text', text: 'hello' }],
      } as IContent,
    ];

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
  const mockResponse: ModelOutput = {
    content: {
      speaker: 'ai',
      blocks: [{ type: 'text', text: 'generated text' }],
    },
  };

  beforeEach(() => {
    config = makeConfig();
    contentGenerator = makeContentGenerator({
      generateContent: vi.fn().mockResolvedValue(mockResponse),
    });
    vi.clearAllMocks();
    (
      getCoreSystemPromptAsync as Mock<typeof getCoreSystemPromptAsync>
    ).mockResolvedValue(SYSTEM_PROMPT);
  });

  it('returns generated content with merged config', async () => {
    const contents = [
      {
        speaker: 'human',
        blocks: [{ type: 'text', text: 'write something' }],
      } as IContent,
    ];
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
        settings: expect.objectContaining({
          temperature: 0.5,
          topP: 1,
          systemInstruction: SYSTEM_PROMPT,
        }),
      }),
      SESSION_ID,
    );
  });

  it('uses lightweight system prompt (getCoreSystemPromptAsync, no env context)', async () => {
    const contents = [
      {
        speaker: 'human',
        blocks: [{ type: 'text', text: 'hello' }],
      } as IContent,
    ];

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
    (
      contentGenerator.generateContent as Mock<
        typeof contentGenerator.generateContent
      >
    ).mockRejectedValue(new Error('network error'));

    const contents = [
      {
        speaker: 'human',
        blocks: [{ type: 'text', text: 'hello' }],
      } as IContent,
    ];

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
    (
      baseLlmClient.generateEmbedding as Mock<
        typeof baseLlmClient.generateEmbedding
      >
    ).mockResolvedValue(embeddings);

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

/**
 * Issue #3176, finding D7 — the auxiliary (lightweight) prompt path must pass
 * `coreMemory: config.getCoreMemory()` so the per-call `.LLXPRT_SYSTEM` disk
 * read does not fire when core memory is available in memory.
 *
 * These tests use a mock that faithfully simulates the real
 * `getCoreSystemPromptAsync` core-memory channel: when `coreMemory` is a
 * non-empty string it echoes it; when it is `undefined` it returns a sentinel
 * representing the disk fallback. The assertion is on the system instruction
 * CONTENT delivered to the LLM client — not on mock-call bookkeeping.
 */
describe('buildLightweightSystemPrompt core memory (issue #3176, D7)', () => {
  const DISK_FALLBACK_SENTINEL = 'DISK_FALLBACK_FIRED';
  let contentGenerator: ContentGenerator;
  let baseLlmClient: BaseLLMClient;
  const abortSignal = new AbortController().signal;

  beforeEach(() => {
    contentGenerator = makeContentGenerator();
    baseLlmClient = makeBaseLlmClient();
    vi.clearAllMocks();
    (
      getCoreSystemPromptAsync as Mock<typeof getCoreSystemPromptAsync>
    ).mockImplementation(async (userMemoryOrOptions) => {
      const coreMemory =
        typeof userMemoryOrOptions === 'object'
          ? userMemoryOrOptions.coreMemory
          : undefined;
      if (typeof coreMemory === 'string' && coreMemory.trim()) {
        return coreMemory;
      }
      return DISK_FALLBACK_SENTINEL;
    });
  });

  function captureSystemInstruction(): string {
    const callArgs = (
      baseLlmClient.generateJson as Mock<typeof baseLlmClient.generateJson>
    ).mock.calls[0]?.[0] as { systemInstruction?: string } | undefined;
    return callArgs?.systemInstruction ?? '';
  }

  // T6
  it('passes in-memory core memory and avoids the disk fallback (D7)', async () => {
    const IN_MEMORY = 'IN_MEMORY_CORE_SENTINEL';
    const configWithMemory = makeConfig({
      getCoreMemory: vi.fn().mockReturnValue(IN_MEMORY),
    });

    await generateJson(
      configWithMemory,
      contentGenerator,
      baseLlmClient,
      [
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'hello' }],
        } as IContent,
      ],
      {},
      abortSignal,
      TEST_MODEL,
      {},
      SESSION_ID,
    );

    const sysInstr = captureSystemInstruction();
    // The in-memory value reached the model …
    expect(sysInstr).toContain(IN_MEMORY);
    // … and the disk fallback did NOT fire.
    expect(sysInstr).not.toContain(DISK_FALLBACK_SENTINEL);
    // The config's getCoreMemory was the source, proving the wiring.
    expect(configWithMemory.getCoreMemory).toHaveBeenCalled();
  });

  // T7
  it('delivers the full core-memory content to the model (no suppression)', async () => {
    const CORE_CONTENT = 'FULL_CORE_MEMORY_BODY';
    const configWithMemory = makeConfig({
      getCoreMemory: vi.fn().mockReturnValue(CORE_CONTENT),
    });

    await generateJson(
      configWithMemory,
      contentGenerator,
      baseLlmClient,
      [
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'hello' }],
        } as IContent,
      ],
      {},
      abortSignal,
      TEST_MODEL,
      {},
      SESSION_ID,
    );

    // The content must be the actual in-memory value, not an empty string
    // (passing '' would suppress it — the issue explicitly forbids that).
    expect(captureSystemInstruction()).toBe(CORE_CONTENT);
  });
});
