/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral test pinning that onStreamLiveness survives the resolved-options
 * building/delegation in LoadBalancingProvider (issue #2607 finding 6). The
 * spread logic in resolvedOptionsBuilder.ts preserves onStreamLiveness via
 * `...options`, so invoking it at the delegate must reach the original
 * observable callback supplied by the caller. No mock interaction assertions —
 * only the real delegation path with a boundary delegate provider.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { StreamLivenessEvent } from '@vybestack/llxprt-code-core/utils/streamIdleTimeout.js';
import type { GenerateChatOptions, IProvider } from '../IProvider.js';
import { ProviderManager } from '../ProviderManager.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { createRuntimeConfigStub } from '@vybestack/llxprt-code-core/test-utils/runtime.js';
import {
  LoadBalancingProvider,
  type LoadBalancingProviderConfig,
} from '../LoadBalancingProvider.js';

describe('LoadBalancingProvider — onStreamLiveness propagation (issue #2607 finding 6)', () => {
  let settingsService: SettingsService;
  let providerManager: ProviderManager;

  beforeEach(() => {
    settingsService = new SettingsService();
    const config = createRuntimeConfigStub(settingsService);
    providerManager = new ProviderManager({ settingsService, config });
  });

  it('onStreamLiveness invoked at the delegate reaches the original caller callback', async () => {
    const captured: StreamLivenessEvent[] = [];

    function createLivenessDelegate(name: string): IProvider {
      return {
        name,
        async *generateChatCompletion(
          optionsOrContents: GenerateChatOptions | IContent[],
        ): AsyncIterableIterator<IContent> {
          const opts = Array.isArray(optionsOrContents)
            ? undefined
            : optionsOrContents;
          opts?.onStreamLiveness?.({
            sourceEvent: 'response.created',
            sseObserved: true,
          });
          yield { speaker: 'ai', blocks: [{ type: 'text', text: 'ok' }] };
        },
        getModels: async () => [],
        getDefaultModel: () => 'delegate-model',
        getServerTools: () => [],
        invokeServerTool: async () => ({}),
      } as unknown as IProvider;
    }

    const lbConfig: LoadBalancingProviderConfig = {
      profileName: 'lb',
      strategy: 'round-robin',
      subProfiles: [{ name: 's1', providerName: 'gemini', modelId: 'gpt-4' }],
    };

    const provider = new LoadBalancingProvider(lbConfig, providerManager);

    const originalGetProvider =
      providerManager.getProviderByName.bind(providerManager);
    providerManager.getProviderByName = (name: string) => {
      if (name === 'gemini') return createLivenessDelegate('gemini');
      return originalGetProvider(name);
    };

    try {
      const iterator = provider.generateChatCompletion({
        contents: [
          { speaker: 'human', blocks: [{ type: 'text', text: 'hi' }] },
        ],
        onStreamLiveness: (event) => captured.push(event),
      } as GenerateChatOptions);

      for await (const _chunk of iterator) {
        // drain
      }
    } finally {
      providerManager.getProviderByName = originalGetProvider;
    }

    expect(captured).toContainEqual({
      sourceEvent: 'response.created',
      sseObserved: true,
    });
  });
});
