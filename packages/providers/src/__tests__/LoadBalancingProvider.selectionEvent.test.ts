/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  coreEvents,
  CoreEvent,
  type LoadBalancerSelectionPayload,
} from '@vybestack/llxprt-code-core';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { IProvider } from '../IProvider.js';
import { ProviderManager } from '../ProviderManager.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { createRuntimeConfigStub } from '@vybestack/llxprt-code-core/test-utils/runtime.js';
import {
  LoadBalancingProvider,
  type LoadBalancingProviderConfig,
} from '../LoadBalancingProvider.js';

/**
 * The footer only re-renders the load-balancer identity when a core event
 * fires. The provider therefore MUST emit a dedicated
 * LoadBalancerSelectionChanged event whenever it selects a (new) sub-profile,
 * so the UI can recompute `lb:<lb>:<sub>:<model>`. A sub-profile rotation is a
 * UI-refresh trigger, NOT an actual model switch, so it must use its own event
 * rather than reusing ModelChanged.
 *
 * These are behavioral tests driving the REAL round-robin selection path
 * (no stubbed selection logic); only the leaf delegate provider is a boundary.
 */
describe('LoadBalancingProvider selection emits a dedicated selection event', () => {
  let settingsService: SettingsService;
  let providerManager: ProviderManager;

  function createMockDelegate(name: string): IProvider {
    return {
      name,
      async *generateChatCompletion(): AsyncIterableIterator<IContent> {
        yield { speaker: 'ai', blocks: [{ type: 'text', text: 'ok' }] };
      },
      getModels: async () => [],
      getDefaultModel: () => 'delegate-model',
      getServerTools: () => [],
      invokeServerTool: async () => ({}),
    } as unknown as IProvider;
  }

  async function drainOneRequest(
    provider: LoadBalancingProvider,
    index: number,
  ): Promise<void> {
    const iterator = provider.generateChatCompletion({
      contents: [
        { speaker: 'human', blocks: [{ type: 'text', text: `m${index}` }] },
      ],
    });
    for await (const _chunk of iterator) {
      // consume
    }
  }

  beforeEach(() => {
    settingsService = new SettingsService();
    const config = createRuntimeConfigStub(settingsService);
    providerManager = new ProviderManager({ settingsService, config });
    coreEvents.removeAllListeners();
  });

  afterEach(() => {
    coreEvents.removeAllListeners();
  });

  it('emits LoadBalancerSelectionChanged (not ModelChanged) when a sub-profile is selected', async () => {
    const lbConfig: LoadBalancingProviderConfig = {
      profileName: 'glm',
      strategy: 'round-robin',
      subProfiles: [
        { name: 'zai', providerName: 'gemini', modelId: 'glm-4-zai' },
        { name: 'makoraglm51', providerName: 'gemini', modelId: 'glm-5-mak' },
      ],
    };
    const provider = new LoadBalancingProvider(lbConfig, providerManager);

    const originalGetProvider =
      providerManager.getProviderByName.bind(providerManager);
    providerManager.getProviderByName = (name: string) => {
      if (name === 'gemini') return createMockDelegate('gemini');
      return originalGetProvider(name);
    };

    let modelChangedCount = 0;
    coreEvents.on(CoreEvent.ModelChanged, () => {
      modelChangedCount += 1;
    });
    const selectionPayloads: LoadBalancerSelectionPayload[] = [];
    coreEvents.on(CoreEvent.LoadBalancerSelectionChanged, (payload) => {
      selectionPayloads.push(payload);
    });

    try {
      await drainOneRequest(provider, 0);
    } finally {
      providerManager.getProviderByName = originalGetProvider;
    }

    // First request selects a sub-profile for the first time => must signal
    // via the dedicated event, carrying the full identity, and must NOT abuse
    // the ModelChanged event (a sub-profile rotation is not a model switch).
    expect(modelChangedCount).toBe(0);
    expect(selectionPayloads).toHaveLength(1);
    expect(selectionPayloads[0]).toStrictEqual({
      profileName: 'glm',
      subProfileName: 'zai',
      model: 'glm-4-zai',
    });
    expect(provider.getStats().lastSelected).toBe('zai');
  });

  it('emits a fresh trigger when round-robin moves to a different sub-profile', async () => {
    const lbConfig: LoadBalancingProviderConfig = {
      profileName: 'glm',
      strategy: 'round-robin',
      subProfiles: [
        { name: 'zai', providerName: 'gemini', modelId: 'glm-4-zai' },
        { name: 'makoraglm51', providerName: 'gemini', modelId: 'glm-5-mak' },
      ],
    };
    const provider = new LoadBalancingProvider(lbConfig, providerManager);

    const originalGetProvider =
      providerManager.getProviderByName.bind(providerManager);
    providerManager.getProviderByName = (name: string) => {
      if (name === 'gemini') return createMockDelegate('gemini');
      return originalGetProvider(name);
    };

    const selections: Array<string | null | undefined> = [];
    coreEvents.on(CoreEvent.LoadBalancerSelectionChanged, (payload) => {
      selections.push(payload.subProfileName);
    });

    try {
      await drainOneRequest(provider, 0); // zai
      await drainOneRequest(provider, 1); // makoraglm51
    } finally {
      providerManager.getProviderByName = originalGetProvider;
    }

    // The footer must learn about BOTH distinct selections.
    expect(selections).toContain('zai');
    expect(selections).toContain('makoraglm51');
  });
});
