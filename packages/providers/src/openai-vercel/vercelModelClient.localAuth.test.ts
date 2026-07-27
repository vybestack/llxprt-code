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
 * Behavioral tests for the openai-vercel local-endpoint auth exemption (issue #2506).
 *
 * The @ai-sdk/openai `createOpenAI` factory validates `apiKey` via `loadApiKey`,
 * which throws `LoadAPIKeyError` for `undefined` but tolerates an empty/placeholder
 * string. The classic openai provider passes `authToken || ''`; the vercel provider
 * must behave the same for local endpoints so keyless servers (e.g. Ollama) work.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('@ai-sdk/openai', () => ({
  createOpenAI: vi.fn(() => vi.fn((modelId: string) => ({ modelId }))),
}));

import { createOpenAI } from '@ai-sdk/openai';
import { createOpenAIClient } from './vercelModelClient.js';
import { AuthenticationError } from './errors.js';
import type { ProviderClientConfig } from './vercelModelClient.js';
import type { NormalizedGenerateChatOptions } from '../BaseProvider.js';

function buildOptions(
  baseURL: string | undefined,
  authToken: string | undefined,
): NormalizedGenerateChatOptions {
  return {
    settings: {
      get: () => undefined,
    } as unknown as NormalizedGenerateChatOptions['settings'],
    invocation: {} as NormalizedGenerateChatOptions['invocation'],
    metadata: {},
    resolved: {
      model: 'llama3',
      baseURL,
      authToken,
      streaming: false,
    },
  } as unknown as NormalizedGenerateChatOptions;
}

function buildClientConfig(
  baseURL: string | undefined,
  overrides?: Partial<ProviderClientConfig>,
): ProviderClientConfig {
  return {
    baseURL,
    providerName: 'openaivercel',
    requiresAuth: undefined,
    customHeaders: undefined,
    ...overrides,
  };
}

async function callClientAndExtractApiKey(
  baseURL: string | undefined,
  authToken: string | undefined,
  clientOverrides?: Partial<ProviderClientConfig>,
): Promise<unknown> {
  const mockCreateOpenAI = createOpenAI as ReturnType<typeof vi.fn>;
  await createOpenAIClient(
    buildOptions(baseURL, authToken),
    buildClientConfig(baseURL, clientOverrides),
  );
  return (mockCreateOpenAI.mock.calls[0][0] as { apiKey: unknown }).apiKey;
}

describe('createOpenAIClient local-endpoint auth exemption (issue #2506)', () => {
  let originalOpenAiKey: string | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    originalOpenAiKey = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
  });

  afterEach(() => {
    if (originalOpenAiKey !== undefined) {
      process.env.OPENAI_API_KEY = originalOpenAiKey;
    } else {
      delete process.env.OPENAI_API_KEY;
    }
    vi.restoreAllMocks();
  });

  it('passes an empty-string apiKey for a local endpoint when no key is set', async () => {
    const apiKey = await callClientAndExtractApiKey(
      'http://127.0.0.1:11434/v1/',
      undefined,
    );
    expect(apiKey).toBe('');
  });

  it('passes the real auth token when a key is provided for a local endpoint', async () => {
    const apiKey = await callClientAndExtractApiKey(
      'http://127.0.0.1:11434/v1/',
      'real-key',
    );
    expect(apiKey).toBe('real-key');
  });

  it('passes an empty-string apiKey for localhost', async () => {
    const apiKey = await callClientAndExtractApiKey(
      'http://localhost:11434/v1/',
      undefined,
    );
    expect(apiKey).toBe('');
  });

  it('passes an empty-string apiKey for a private IP range', async () => {
    const apiKey = await callClientAndExtractApiKey(
      'http://192.168.1.10:11434/v1/',
      undefined,
    );
    expect(apiKey).toBe('');
  });

  it('passes an empty-string apiKey for an IPv6 loopback endpoint', async () => {
    const apiKey = await callClientAndExtractApiKey(
      'http://[::1]:11434/v1/',
      undefined,
    );
    expect(apiKey).toBe('');
  });

  it('passes an empty-string apiKey when requiresAuth is false even for a remote endpoint', async () => {
    const apiKey = await callClientAndExtractApiKey(
      'https://api.openai.com/v1',
      undefined,
      { requiresAuth: false },
    );
    expect(apiKey).toBe('');
  });

  it('throws AuthenticationError for a non-local endpoint with no key (no regression)', async () => {
    const mockCreateOpenAI = createOpenAI as ReturnType<typeof vi.fn>;

    await expect(
      createOpenAIClient(
        buildOptions('https://api.openai.com/v1', undefined),
        buildClientConfig('https://api.openai.com/v1'),
      ),
    ).rejects.toThrow(AuthenticationError);

    expect(mockCreateOpenAI).not.toHaveBeenCalled();
  });

  it('passes the real key through to createOpenAI for a non-local endpoint', async () => {
    const apiKey = await callClientAndExtractApiKey(
      'https://api.openai.com/v1',
      'sk-real',
    );
    expect(apiKey).toBe('sk-real');
  });
});
