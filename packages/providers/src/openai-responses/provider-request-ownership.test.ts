/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { bindProviderMedia } from '@vybestack/llxprt-code-core/runtime/bindProviderMedia.js';
import { afterEach, describe, expect, it } from 'bun:test';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { LocalMediaStore } from '@vybestack/llxprt-code-core';
import { RequestMediaResolver } from '@vybestack/llxprt-code-core/storage/request-media-resolver.js';
import { createProviderRuntimeContext } from '@vybestack/llxprt-code-core/runtime/providerRuntimeContext.js';
import { createProviderCallOptions } from '@vybestack/llxprt-code-test-utils/core/providerCallOptions.js';
import { createRuntimeConfigStub } from '@vybestack/llxprt-code-test-utils/core/runtime.js';
import type { IProvider, GenerateChatOptions } from '../IProvider.js';
import { OpenAIProvider } from '../openai/OpenAIProvider.js';
import { OpenAIResponsesProvider } from './OpenAIResponsesProvider.js';

function gate(): { promise: Promise<void>; open(): void } {
  let open = (): void => {};
  const promise = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { promise, open };
}

describe('provider request ownership', () => {
  const originalFetch = global.fetch;
  const directories: string[] = [];
  afterEach(async () => {
    global.fetch = originalFetch;
    await Promise.all(
      directories
        .splice(0)
        .map((path) => rm(path, { recursive: true, force: true })),
    );
  });

  async function fixture(provider: IProvider): Promise<{
    options: ReturnType<typeof createProviderCallOptions>;
    provider: IProvider;
    entered: ReturnType<typeof gate>;
    resume: ReturnType<typeof gate>;
    settings: SettingsService;
    resolver: RequestMediaResolver;
  }> {
    await mkdir(join(process.cwd(), 'tmp'), { recursive: true });
    const directory = await mkdtemp(
      join(process.cwd(), 'tmp/request-ownership-'),
    );
    directories.push(directory);
    const store = new LocalMediaStore({
      rootDirectory: directory,
      quotaBytes: 1024,
    });
    const image = await store.admit({
      bytes: new Uint8Array([1, 2, 3]),
      mimeType: 'image/png',
      semanticMetadata: { variantPolicy: 'admitted-v1' },
    });
    const resolver = new RequestMediaResolver(store);
    const entered = gate();
    const resume = gate();
    const settings = new SettingsService();
    settings.setProviderSetting(provider.name, 'model', 'gpt-5.6');
    settings.setProviderSetting(provider.name, 'responsesMode', 'responses');
    settings.setProviderSetting(provider.name, 'prompt-caching', 'off');
    settings.set('tool-output-max-tokens', 0);
    settings.setProviderSetting(provider.name, 'custom-headers', {
      'X-Owner': 'admitted',
    });
    const config = createRuntimeConfigStub(settings, {
      getEphemeralSettings: () => ({
        'tool-output-max-tokens': settings.get('tool-output-max-tokens'),
        'tool-output-truncate-mode': 'warn',
      }),
    });
    const runtime = createProviderRuntimeContext({
      runtimeId: 'same-label',
      settingsService: settings,
      config,
      mediaResolver: {
        resolve: async (input) => {
          entered.open();
          await resume.promise;
          return resolver.resolve(input);
        },
      },
    });
    if (
      !(provider instanceof OpenAIProvider) &&
      !(provider instanceof OpenAIResponsesProvider)
    )
      throw new Error('Expected concrete provider owner');
    provider.setRuntimeSettingsService(settings);
    const options = createProviderCallOptions({
      providerName: provider.name,
      settings,
      config,
      runtime,
      resolved: {
        model: 'gpt-5.6',
        baseURL: 'https://owned.invalid/v1',
        authToken: 'owned-token',
      },
      contents: [
        {
          speaker: 'ai',
          blocks: [
            {
              type: 'tool_call',
              id: 'read-1',
              name: 'read_file',
              parameters: { path: 'owned.txt' },
            },
          ],
        },
        {
          speaker: 'tool',
          blocks: [
            {
              type: 'tool_response',
              callId: 'read-1',
              toolName: 'read_file',
              result: 'original tool payload '.repeat(100),
            },
          ],
        },
        { speaker: 'human', blocks: [image] },
      ],
    });
    return {
      options,
      entered,
      resume,
      settings,
      resolver,
      provider: bindProviderMedia(
        provider,
        runtime.mediaResolver,
        runtime.requestMediaBudgetBytes,
      ),
    };
  }

  function mutateOwner(settings: SettingsService, name: string): void {
    settings.setProviderSetting(name, 'prompt-caching', '1h');
    settings.set('tool-output-max-tokens', 1);
    settings.setProviderSetting(name, 'custom-headers', {
      'X-Owner': 'replacement',
    });
    settings.setProviderSetting(
      name,
      'base-url',
      'https://replacement.invalid/v1',
    );
    settings.setProviderSetting(name, 'model', 'replacement-model');
  }

  async function drain(
    provider: IProvider,
    options: GenerateChatOptions,
  ): Promise<void> {
    for await (const _content of provider.generateChatCompletion(options)) {
      /* Drain the real parser. */
    }
  }

  for (const create of [
    (): IProvider => new OpenAIResponsesProvider('owned-token'),
    (): IProvider => new OpenAIProvider('owned-token'),
  ]) {
    describe(`Responses request policy ownership ${create().name}`, () => {
      it('keeps admitted tool policy, caching and headers when the owner changes during media preparation', async () => {
        let provider = create();
        const fixtureOwner = await fixture(provider);
        const { options, entered, resume, settings, resolver } = fixtureOwner;
        provider = fixtureOwner.provider;
        let transported = '';
        let headers = new Headers();
        let endpoint = '';
        global.fetch = async (input, init): Promise<Response> => {
          endpoint = String(input);
          headers = new Headers(init?.headers);
          transported = await new Response(init?.body).text();
          return new Response(
            'data: {"type":"response.completed","response":{"id":"done","status":"completed"}}\n\ndata: [DONE]\n\n',
            { headers: { 'content-type': 'text/event-stream' } },
          );
        };
        const running = drain(provider, options);
        await entered.promise;
        mutateOwner(settings, provider.name);
        resume.open();
        await running;
        expect(transported).toContain('original tool payload');
        expect(transported).not.toContain('prompt_cache_key');
        expect(headers.get('X-Owner')).not.toBe('replacement');
        expect(endpoint).not.toContain('replacement.invalid');
        expect(transported).not.toContain('replacement-model');
        expect(resolver.accounting().activeRequestCount).toBe(0);
      });

      it('uses the same admitted tool policy for public prompt projection', async () => {
        let provider = create();
        const fixtureOwner = await fixture(provider);
        const { options, entered, resume, settings, resolver } = fixtureOwner;
        provider = fixtureOwner.provider;
        const projecting = provider.projectPromptEnvelope?.(options);
        await entered.promise;
        mutateOwner(settings, provider.name);
        resume.open();
        const projection = await projecting;
        expect(JSON.stringify(projection?.finalizedProjection)).toContain(
          'original tool payload',
        );
        await projection?.releaseIfUnsent?.();
        expect(resolver.accounting().activeRequestCount).toBe(0);
      });

      it('honors replacement policy on a later request rather than ignoring policy changes', async () => {
        let provider = create();
        const fixtureOwner = await fixture(provider);
        const { options, resume, settings } = fixtureOwner;
        provider = fixtureOwner.provider;
        mutateOwner(settings, provider.name);
        resume.open();
        let transported = '';
        global.fetch = async (_input, init): Promise<Response> => {
          transported = await new Response(init?.body).text();
          return new Response(
            'data: {"type":"response.completed","response":{"id":"done","status":"completed"}}\n\ndata: [DONE]\n\n',
            { headers: { 'content-type': 'text/event-stream' } },
          );
        };
        await drain(provider, { ...options, invocation: undefined });
        expect(transported).not.toContain('original tool payload');
      });
    });
  }
});
