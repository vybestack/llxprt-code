/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterEach, describe, expect, it, spyOn, mock } from 'bun:test';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { createProviderCallOptions } from '@vybestack/llxprt-code-core/test-utils/providerCallOptions.js';
import { createRuntimeConfigStub } from '@vybestack/llxprt-code-core/test-utils/runtime.js';
import { createProviderRuntimeContext } from '@vybestack/llxprt-code-core/runtime/providerRuntimeContext.js';
import { createRuntimeInvocationContext } from '@vybestack/llxprt-code-core/runtime/RuntimeInvocationContext.js';
import { createOpenAIResponsesAliasProvider } from './aliasProviderFactory.js';
import { OpenAIResponsesProvider } from '../openai-responses/OpenAIResponsesProvider.js';
import {
  buildCodexOAuthManager,
  sseResponse,
} from '../openai-responses/codexStateful.test-helpers.js';
import type { OpenAIResponsesRequest } from '../openai-responses/OpenAIResponsesTypes.js';
import type { StreamResponseOptions } from '../openai-responses/openAIResponsesWebSocketTransport.js';
import * as webSocketTransport from '../openai-responses/openAIResponsesWebSocketTransport.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';

async function generate(
  provider: OpenAIResponsesProvider,
  baseURL: string,
): Promise<IContent[]> {
  const settings = new SettingsService();
  settings.setProviderSetting(provider.name, 'model', 'gpt-5.6-luna');
  settings.setProviderSetting(provider.name, 'max_tokens', 123);
  settings.setProviderSetting(provider.name, 'temperature', 0.4);
  const config = createRuntimeConfigStub(settings);
  const runtime = createProviderRuntimeContext({
    settingsService: settings,
    runtimeId: 'codex-proxy',
    config,
  });
  const invocation = createRuntimeInvocationContext({
    runtime,
    settings,
    providerName: provider.name,
    ephemeralsSnapshot: {},
  });
  const contents: IContent[] = [];
  for await (const content of provider.generateChatCompletion(
    createProviderCallOptions({
      providerName: provider.name,
      settings,
      config,
      runtime,
      invocation,
      contents: [
        { speaker: 'human', blocks: [{ type: 'text', text: 'hello' }] },
      ],
      resolved: { model: 'gpt-5.6-luna', baseURL },
    }),
  )) {
    contents.push(content);
  }
  return contents;
}

describe('provider-selected Codex semantics', () => {
  afterEach(() => {
    mock.restore();
  });
  for (const [baseURL, effectiveURL] of [
    [
      'http://127.0.0.1:18443/backend-api/codex',
      'http://127.0.0.1:18443/backend-api/codex',
    ],
    [
      'https://chatgpt.com/backend-api/codex',
      'https://chatgpt.com/backend-api/codex',
    ],
    [
      'https://chatgpt.com/backend-api/codex',
      'http://127.0.0.1:18443/backend-api/codex',
    ],
  ]) {
    it(`uses Codex authentication, request settings and WebSocket transport from ${baseURL} through ${effectiveURL}`, async () => {
      const requests: OpenAIResponsesRequest[] = [];
      const options: StreamResponseOptions[] = [];
      spyOn(
        webSocketTransport,
        'createCodexResponsesWebSocketTransport',
      ).mockReturnValue({
        async *streamResponse(
          request: OpenAIResponsesRequest,
          transportOptions: StreamResponseOptions,
        ): AsyncIterableIterator<IContent> {
          requests.push(request);
          options.push(transportOptions);
          yield { speaker: 'ai', blocks: [{ type: 'text', text: 'ok' }] };
        },
        close(): void {},
      });
      spyOn(globalThis, 'fetch').mockImplementation(async () =>
        sseResponse('generic', 'ok'),
      );
      const provider = createOpenAIResponsesAliasProvider(
        {
          alias: 'codex',
          filePath: 'test',
          source: 'builtin',
          config: {
            baseProvider: 'openai-responses',
            'base-url': baseURL,
            modelDefaults: [
              {
                pattern: '.*',
                ephemeralSettings: {},
                unallowedParameters: ['temperature'],
              },
            ],
          },
        },
        undefined,
        undefined,
        {},
        buildCodexOAuthManager(),
        false,
      );
      await generate(provider, effectiveURL);
      expect(requests).toHaveLength(1);
      expect(requests[0].store).toBe(false);
      expect(requests[0].max_output_tokens).toBeUndefined();
      expect(requests[0].temperature).toBeUndefined();
      expect(options[0].responsesURL).toBe(`${effectiveURL}/responses`);
      expect(options[0].headers['ChatGPT-Account-ID']).toBe('acct_codex_123');
      expect(options[0].headers.Authorization).toBe('Bearer codex-token');
      provider.clearState();
    });
  }

  it('retains Codex settings and account headers when a proxy rejects WebSocket and HTTP is used', async () => {
    const requests: Array<Record<string, unknown>> = [];
    const headers: Headers[] = [];
    const urls: string[] = [];
    spyOn(
      webSocketTransport,
      'createCodexResponsesWebSocketTransport',
    ).mockReturnValue({
      async *streamResponse(): AsyncIterableIterator<IContent> {
        yield await Promise.reject(new Error('WebSocket upgrade rejected'));
      },
      close(): void {},
    });
    spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
      urls.push(String(url));
      requests.push(await new Response(init?.body).json());
      headers.push(new Headers(init?.headers));
      return sseResponse('proxy-http', 'ok');
    });
    const baseURL = 'http://127.0.0.1:18443/backend-api/codex';
    const provider = createOpenAIResponsesAliasProvider(
      {
        alias: 'codex',
        filePath: 'test',
        source: 'builtin',
        config: { baseProvider: 'openai-responses', 'base-url': baseURL },
      },
      undefined,
      undefined,
      {},
      buildCodexOAuthManager(),
      false,
    );
    await generate(provider, baseURL);
    expect(urls).toStrictEqual([`${baseURL}/responses`]);
    expect(requests[0].store).toBe(false);
    expect(requests[0].max_output_tokens).toBeUndefined();
    expect(requests[0].previous_response_id).toBeUndefined();
    expect(headers[0].get('ChatGPT-Account-ID')).toBe('acct_codex_123');
    expect(headers[0].get('Authorization')).toBe('Bearer codex-token');
    provider.clearState();
  });

  it('keeps generic Responses HTTP and model parameters even at a Codex-shaped URL', async () => {
    const requests: Array<Record<string, unknown>> = [];
    const headers: Headers[] = [];
    spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
      requests.push(await new Response(init?.body).json());
      headers.push(new Headers(init?.headers));
      return sseResponse('generic', 'ok');
    });
    const baseURL = 'https://chatgpt.com/backend-api/codex';
    const provider = new OpenAIResponsesProvider('api-key', baseURL);
    await generate(provider, baseURL);
    expect(requests).toHaveLength(1);
    expect(requests[0].max_output_tokens).toBe(123);
    expect(requests[0].temperature).toBe(0.4);
    expect(headers[0].has('ChatGPT-Account-ID')).toBe(false);
    expect(headers[0].get('Authorization')).toBe('Bearer api-key');
  });
});
