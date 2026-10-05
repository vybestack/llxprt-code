/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'bun:test';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { createRuntimeConfigStub } from '@vybestack/llxprt-code-core/test-utils/runtime.js';
import { delay } from '@vybestack/llxprt-code-core/utils/delay.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { IProvider } from '../IProvider.js';
import { ProviderManager } from '../ProviderManager.js';
import {
  LoadBalancingProvider,
  type LoadBalancerSubProfile,
} from '../LoadBalancingProvider.js';
import {
  collectContents,
  isAsyncIterableContents,
} from '../utils/collectContents.js';

function backend(name: string, providerName: string): LoadBalancerSubProfile {
  return {
    name,
    providerName,
    modelId: name,
    baseURL: `https://${name}.example.com`,
    authToken: `${name}-token`,
  };
}

describe('LoadBalancingProvider positional cancellation', () => {
  it('cancels a failover request without retrying or changing its contents', async () => {
    const settingsService = new SettingsService();
    const providerManager = new ProviderManager({
      settingsService,
      config: createRuntimeConfigStub(settingsService),
    });
    const controller = new AbortController();
    const request: IContent[] = [
      { speaker: 'human', blocks: [{ type: 'text', text: 'first' }] },
      { speaker: 'human', blocks: [{ type: 'text', text: 'second' }] },
    ];
    const expectedBytes = new TextEncoder().encode(JSON.stringify(request));
    let historyDrains = 0;
    async function* history(): AsyncGenerator<IContent> {
      historyDrains++;
      yield* request;
    }

    let attempts = 0;
    let receivedBytes: Uint8Array | undefined;
    const primary: IProvider = {
      name: 'test-provider-1',
      async *generateChatCompletion(options): AsyncGenerator<IContent> {
        attempts++;
        if (isAsyncIterableContents(options)) {
          throw new Error('delegate should receive options');
        }
        const contents = await collectContents(options.contents);
        receivedBytes = new TextEncoder().encode(JSON.stringify(contents));
        const signal = options.invocation?.signal;
        controller.abort();
        if (signal?.aborted !== true) {
          throw new Error('positional request signal was not forwarded');
        }
        await delay(60_000, signal);
        yield { speaker: 'ai', blocks: [{ type: 'text', text: 'too late' }] };
      },
      getModels: async () => [],
      getDefaultModel: () => 'test-model-1',
    };
    const secondary: IProvider = {
      name: 'test-provider-2',
      async *generateChatCompletion(): AsyncGenerator<IContent> {
        attempts++;
        yield { speaker: 'ai', blocks: [{ type: 'text', text: 'failover' }] };
      },
      getModels: async () => [],
      getDefaultModel: () => 'test-model-2',
    };
    providerManager.registerProvider(primary);
    providerManager.registerProvider(secondary);
    const lb = new LoadBalancingProvider(
      {
        profileName: 'positional-signal',
        strategy: 'failover',
        subProfiles: [
          backend('first', primary.name),
          backend('second', secondary.name),
        ],
        lbProfileEphemeralSettings: { failover_retry_count: 3 },
      },
      providerManager,
    );

    await expect(
      (async () => {
        for await (const _chunk of lb.generateChatCompletion(
          history(),
          undefined,
          controller.signal,
        )) {
          // consume
        }
      })(),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(receivedBytes).toStrictEqual(expectedBytes);
    expect(historyDrains).toBe(1);
    expect(attempts).toBe(1);
  });
});
