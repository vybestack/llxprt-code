/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { callerOwnedRawProviderSource } from '@vybestack/llxprt-code-core/services/history/caller-owned-provider-request.js';
import { captureProviderRequestDiagnostics } from '@vybestack/llxprt-code-core/runtime/providerRequestDiagnostics.js';
import type { GenerateChatOptions, ProviderChatOptions } from '../IProvider.js';
import { OpenAIProvider } from '../openai/OpenAIProvider.js';
import { LoggingProviderWrapper } from '../LoggingProviderWrapper.js';
import { LoadBalancingProvider } from '../LoadBalancingProvider.js';
import { ProviderManager } from '../ProviderManager.js';
import { RetryOrchestrator } from '../RetryOrchestrator.js';
import { copyProviderRequestOptions } from '../requestAdmission.js';
import { streamCallOptions } from './streamCallOptions.js';
import {
  createConfigStub,
  createRuntimeContext,
} from './LoggingProviderWrapper.test-helpers.js';
import { operationFileCreates } from '../../../agents/src/compression/__tests__/support/operation-file-creates.js';

const rows: readonly IContent[] = [
  {
    speaker: 'human',
    blocks: [{ type: 'text', text: 'Preserve "quotes", 雪 and \\.' }],
  },
];

async function drain(
  provider:
    | OpenAIProvider
    | LoggingProviderWrapper
    | LoadBalancingProvider
    | RetryOrchestrator,
  options: ProviderChatOptions,
): Promise<void> {
  for await (const chunk of provider.generateChatCompletion(options))
    void chunk;
}

describe('caller-owned public entry paths', () => {
  const entries: ReadonlyArray<
    'base' | 'load-balancer' | 'logging' | 'retry' | 'copied-selection'
  > = ['base', 'load-balancer', 'logging', 'retry', 'copied-selection'];
  for (const entry of entries) {
    it(`${entry} forwards bare arrays with identical wire bytes and no files`, async () => {
      const bodies: string[] = [];
      const server = Bun.serve({
        hostname: '127.0.0.1',
        port: 0,
        async fetch(request): Promise<Response> {
          bodies.push(await request.text());
          return Response.json({
            id: 'entry',
            choices: [
              {
                message: { role: 'assistant', content: 'ok' },
                finish_reason: 'stop',
              },
            ],
          });
        },
      });
      const baseURL = `http://127.0.0.1:${server.port}/v1`;
      const settings = new SettingsService();
      const config = createConfigStub(false);
      const runtime = createRuntimeContext(settings, config);
      const base = new OpenAIProvider('test-key', baseURL);
      let provider:
        | OpenAIProvider
        | LoggingProviderWrapper
        | LoadBalancingProvider
        | RetryOrchestrator = base;
      if (entry === 'retry')
        provider = new RetryOrchestrator(base, { initialDelayMs: 0 });
      if (entry === 'logging') {
        provider = new LoggingProviderWrapper(base, null, undefined, () =>
          captureProviderRequestDiagnostics(config, runtime.sessionSettings),
        );
      }
      if (entry === 'load-balancer') {
        const manager = new ProviderManager({
          sessionSettings: runtime.sessionSettings,
          settingsService: settings,
          config,
        });
        manager.registerProvider(base);
        provider = new LoadBalancingProvider(
          {
            profileName: 'caller-owned',
            strategy: 'round-robin',
            subProfiles: [
              {
                name: 'member',
                providerName: 'openai',
                model: 'gpt-4o',
                baseURL,
                authToken: 'test-key',
                ephemeralSettings: { streaming: 'disabled' },
                modelParams: {},
              },
            ],
          },
          manager,
        );
      }
      const options = streamCallOptions({
        providerName: 'openai',
        settings,
        config,
        runtime,
        contents: rows,
        resolved: {
          model: 'gpt-4o',
          baseURL,
          authToken: 'test-key',
          streaming: false,
        },
        ephemerals: { streaming: 'disabled' },
      });
      try {
        await drain(provider, options);
        const creates = await operationFileCreates(async () => {
          if (entry !== 'copied-selection') {
            await drain(provider, { ...options, contents: rows });
            return;
          }
          const selection =
            await callerOwnedRawProviderSource(rows).openProviderRequest();
          try {
            await drain(
              provider,
              copyProviderRequestOptions({
                ...options,
                requestRows: selection,
                contentCount: selection.count,
                contents: {
                  async *[Symbol.asyncIterator](): AsyncGenerator<IContent> {
                    yield await Promise.reject<IContent>(
                      new Error('Unrelated contents consumed'),
                    );
                  },
                },
              }),
            );
          } finally {
            await selection.close();
          }
        }, true);
        expect(creates).toStrictEqual({ files: [], directories: [] });
        expect(bodies).toHaveLength(2);
        expect(bodies[1]).toBe(bodies[0]);
        expect(bodies[1]).toContain('Preserve');
      } finally {
        await server.stop(true);
      }
    });
  }

  it('keeps the indexed selection when a forwarding wrapper copies options', async () => {
    const selection =
      await callerOwnedRawProviderSource(rows).openProviderRequest();
    const options: GenerateChatOptions = {
      contents: {
        async *[Symbol.asyncIterator](): AsyncGenerator<IContent> {
          yield await Promise.reject<IContent>(
            new Error('Unrelated contents consumed'),
          );
        },
      },
      requestRows: selection,
      contentCount: selection.count,
    };
    const copied = copyProviderRequestOptions(options);
    expect(copied.requestRows).toBe(selection);
    expect(copied.contentCount).toBe(rows.length);
    await selection.close();
  });
});
