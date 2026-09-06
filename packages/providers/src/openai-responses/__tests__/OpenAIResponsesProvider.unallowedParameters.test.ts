/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, describe, expect, it, vi } from 'bun:test';
import type { OAuthManager } from '../../auth/index.js';
import { createProviderCallOptions } from '@vybestack/llxprt-code-core/test-utils/providerCallOptions.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { createOpenAIResponsesAliasProvider } from '../../composition/aliasProviderFactory.js';
import {
  loadProviderAliasEntries,
  type ProviderAliasEntry,
} from '../../composition/providerAliases.js';
import { OpenAIResponsesProvider } from '../OpenAIResponsesProvider.js';

const SAMPLING_PARAMETERS = {
  temperature: 0.4,
  top_p: 0.8,
  top_k: 32,
  frequency_penalty: 0.2,
  presence_penalty: 0.3,
} as const;
const ALLOWED_PARAMETER = { service_tier: 'priority' } as const;

const CODEX_OAUTH_MANAGER = {
  getToken: async () => 'codex-access-token',
  isAuthenticated: async () => true,
  getOAuthToken: async () => ({
    access_token: 'codex-access-token',
    token_type: 'Bearer',
    expiry: Math.floor(Date.now() / 1000) + 3600,
    account_id: 'test-account-id',
  }),
} as unknown as OAuthManager;

function findCodexAlias(): ProviderAliasEntry {
  const entry = loadProviderAliasEntries().find(
    ({ alias }) => alias === 'codex',
  );
  if (entry === undefined) {
    throw new Error('codex alias entry not found');
  }
  return entry;
}

function createCodexProvider(
  entry: ProviderAliasEntry = findCodexAlias(),
): OpenAIResponsesProvider {
  const provider = createOpenAIResponsesAliasProvider(
    entry,
    'unused-api-key',
    undefined,
    {},
    CODEX_OAUTH_MANAGER,
    false,
  );
  if (provider === null) {
    throw new Error('codex alias provider was not created');
  }
  return provider;
}

function streamingResponse(): Response {
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          encoder.encode(
            'data: {"type":"response.completed","response":{"id":"response-1","status":"completed"}}\n\n',
          ),
        );
        controller.enqueue(encoder.encode('data: [DONE]\n\n'));
        controller.close();
      },
    }),
    {
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
    },
  );
}

async function captureSerializedRequest(
  provider: OpenAIResponsesProvider,
  model: string,
): Promise<Record<string, unknown>> {
  let requestBody: string | undefined;
  vi.spyOn(globalThis, 'fetch').mockImplementation(
    async (
      _input: RequestInfo | URL,
      init?: RequestInit,
    ): Promise<Response> => {
      if (init?.body !== undefined && init.body !== null) {
        requestBody =
          typeof init.body === 'string'
            ? init.body
            : await new Response(init.body).text();
      }
      return streamingResponse();
    },
  );

  const settings = new SettingsService();
  settings.setProviderSetting(provider.name, 'model', model);
  for (const [key, value] of Object.entries({
    ...SAMPLING_PARAMETERS,
    ...ALLOWED_PARAMETER,
  })) {
    settings.setProviderSetting(provider.name, key, value);
  }
  const options = createProviderCallOptions({
    providerName: provider.name,
    settings,
    contents: [
      {
        speaker: 'human',
        blocks: [{ type: 'text', text: 'Return one word.' }],
      },
    ],
  });

  for await (const _content of provider.generateChatCompletion(options)) {
    // Drain the response so the production request path completes.
  }

  if (requestBody === undefined) {
    throw new Error('request body was not captured');
  }
  const parsed: unknown = JSON.parse(requestBody);
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('serialized request body was not a JSON object');
  }
  return Object.fromEntries(Object.entries(parsed));
}

describe('OpenAI Responses unallowed model parameters', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each(['gpt-6-astra', 'gpt-5.6-sol'])(
    'strips sampling parameters declared by the real Codex alias for %s',
    async (model) => {
      const body = await captureSerializedRequest(createCodexProvider(), model);

      for (const parameter of Object.keys(SAMPLING_PARAMETERS)) {
        expect(body).not.toHaveProperty(parameter);
      }
      expect(body).toHaveProperty('service_tier', 'priority');
    },
  );

  it('uses the model-default rules captured from the alias entry at construction', async () => {
    const codexEntry = findCodexAlias();
    const provider = createCodexProvider({
      ...codexEntry,
      alias: 'construction-rules-codex',
    });

    const body = await captureSerializedRequest(provider, 'gpt-5.6-sol');

    for (const parameter of Object.keys(SAMPLING_PARAMETERS)) {
      expect(body).not.toHaveProperty(parameter);
    }
    expect(body).toHaveProperty('service_tier', 'priority');
  });

  it('preserves sampling parameters for a plain OpenAI Responses model without an alias rule', async () => {
    const body = await captureSerializedRequest(
      new OpenAIResponsesProvider('test-api-key', 'https://api.openai.com/v1'),
      'gpt-4.1',
    );

    expect(body).toMatchObject({
      ...SAMPLING_PARAMETERS,
      ...ALLOWED_PARAMETER,
    });
  });
});
