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

/**
 * End-to-end behavioral tests for the openai-vercel local-endpoint auth
 * exemption (issue #2506). These exercise the full OpenAIVercelProvider path
 * (generateChatCompletion -> createConfiguredModel -> createOpenAIClient) and
 * assert that @ai-sdk/openai's `createOpenAI` receives a non-undefined apiKey
 * for local endpoints, so `loadApiKey` does not throw before the request fires.
 */

import { vi, describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { OpenAIVercelProvider } from './OpenAIVercelProvider.js';
import { CredentialResolutionError } from '@vybestack/llxprt-code-auth';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { createProviderCallOptions } from '@vybestack/llxprt-code-core/test-utils/providerCallOptions.js';
import { createRuntimeConfigStub } from '@vybestack/llxprt-code-core/test-utils/runtime.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';

void vi.mock('ai', () => ({
  generateText: vi.fn(),
  streamText: vi.fn(),
  extractReasoningMiddleware: vi.fn(() => ({})),
  wrapLanguageModel: vi.fn((model) => model),
}));

void vi.mock('@ai-sdk/openai', () => ({
  createOpenAI: vi.fn(() => vi.fn((modelId: string) => ({ modelId }))),
}));

async function collectResults(
  iterator: AsyncIterableIterator<IContent>,
): Promise<IContent[]> {
  const results: IContent[] = [];
  for await (const content of iterator) {
    results.push(content);
  }
  return results;
}

describe('OpenAIVercelProvider local-endpoint keyless auth (issue #2506)', () => {
  let settingsService: SettingsService;
  let config: ReturnType<typeof createRuntimeConfigStub>;
  let originalOpenAiKey: string | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    originalOpenAiKey = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    settingsService = new SettingsService();
    settingsService.set('activeProvider', 'openaivercel');
    config = createRuntimeConfigStub(settingsService);
  });

  afterEach(() => {
    if (originalOpenAiKey !== undefined) {
      process.env.OPENAI_API_KEY = originalOpenAiKey;
    } else {
      delete process.env.OPENAI_API_KEY;
    }
    vi.restoreAllMocks();
  });

  it('constructs createOpenAI with a non-undefined apiKey for a local Ollama endpoint with no key', async () => {
    const { generateText } = await import('ai');
    (generateText as ReturnType<typeof vi.fn>).mockResolvedValue({
      text: 'ok',
      toolCalls: [],
      finishReason: 'stop',
      usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
    });

    const provider = new OpenAIVercelProvider(
      undefined,
      'http://127.0.0.1:11434/v1/',
      { settingsService },
    );

    const options = createProviderCallOptions({
      config,
      contents: [
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'hi' }],
        },
      ],
      settings: settingsService,
      resolved: {
        streaming: false,
        baseURL: 'http://127.0.0.1:11434/v1/',
        model: 'llama3',
        authToken: undefined,
      },
      providerName: 'openaivercel',
    });

    await collectResults(provider.generateChatCompletion(options));

    const { createOpenAI } = await import('@ai-sdk/openai');
    const mockCreateOpenAI = createOpenAI as ReturnType<typeof vi.fn>;
    expect(mockCreateOpenAI).toHaveBeenCalledTimes(1);
    const callArgs = mockCreateOpenAI.mock.calls[0][0] as {
      apiKey: unknown;
    };
    expect(typeof callArgs.apiKey).toBe('string');
  });

  it('throws CredentialResolutionError for a remote endpoint with no key', async () => {
    const provider = new OpenAIVercelProvider(undefined, undefined, {
      settingsService,
    });

    const options = createProviderCallOptions({
      config,
      contents: [
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'hi' }],
        },
      ],
      settings: settingsService,
      resolved: {
        streaming: false,
        baseURL: 'https://api.openai.com/v1',
        model: 'gpt-4o',
        authToken: undefined,
      },
      providerName: 'openaivercel',
    });

    const { createOpenAI } = await import('@ai-sdk/openai');
    const mockCreateOpenAI = createOpenAI as ReturnType<typeof vi.fn>;

    await expect(
      collectResults(provider.generateChatCompletion(options)),
    ).rejects.toThrow(CredentialResolutionError);

    expect(mockCreateOpenAI).not.toHaveBeenCalled();
  });

  it('constructs createOpenAI with a non-undefined apiKey for a remote endpoint when requires-auth is false', async () => {
    const { generateText } = await import('ai');
    (generateText as ReturnType<typeof vi.fn>).mockResolvedValue({
      text: 'ok',
      toolCalls: [],
      finishReason: 'stop',
      usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
    });

    const provider = new OpenAIVercelProvider(undefined, undefined, {
      settingsService,
    });

    const options = createProviderCallOptions({
      config,
      contents: [
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'hi' }],
        },
      ],
      settings: settingsService,
      resolved: {
        streaming: false,
        baseURL: 'https://api.openai.com/v1',
        model: 'gpt-4o',
        authToken: undefined,
      },
      providerName: 'openaivercel',
      settingsOverrides: {
        provider: { 'requires-auth': false },
      },
    });

    await collectResults(provider.generateChatCompletion(options));

    const { createOpenAI } = await import('@ai-sdk/openai');
    const mockCreateOpenAI = createOpenAI as ReturnType<typeof vi.fn>;
    expect(mockCreateOpenAI).toHaveBeenCalledTimes(1);
    const callArgs = mockCreateOpenAI.mock.calls[0][0] as {
      apiKey: unknown;
    };
    expect(typeof callArgs.apiKey).toBe('string');
  });
});
