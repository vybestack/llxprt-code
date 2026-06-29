/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach } from 'vitest';
import type { IProvider } from '../IProvider.js';
import { ProviderManager } from '../ProviderManager.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { createRuntimeConfigStub } from '@vybestack/llxprt-code-core/test-utils/runtime.js';
import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import {
  LoadBalancingProvider,
  type LoadBalancingProviderConfig,
} from '../LoadBalancingProvider.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';

function makeMockProvider(name: string): IProvider {
  return {
    name,
    async *generateChatCompletion(): AsyncIterableIterator<IContent> {
      yield { role: 'model', parts: [{ text: `${name} response` }] };
    },
    getModels: async () => [],
    getDefaultModel: () => 'model',
    getServerTools: () => [],
    invokeServerTool: async () => ({}),
  } as unknown as IProvider;
}

async function drain(iterator: AsyncIterableIterator<IContent>): Promise<void> {
  for await (const _chunk of iterator) {
    // consume
  }
}

describe('LoadBalancingProvider active-model stats (issue #2193)', () => {
  let settingsService: SettingsService;
  let config: Config;
  let providerManager: ProviderManager;

  beforeEach(() => {
    settingsService = new SettingsService();
    config = createRuntimeConfigStub(settingsService);
    providerManager = new ProviderManager({ settingsService, config });
  });

  describe('members', () => {
    it('exposes the member sub-profile names in configuration order', () => {
      const lbConfig: LoadBalancingProviderConfig = {
        profileName: 'members-test',
        strategy: 'round-robin',
        subProfiles: [
          { name: 'fast', providerName: 'gemini', modelId: 'gemini-flash' },
          { name: 'smart', providerName: 'openai', modelId: 'gpt-4' },
          { name: 'cheap', providerName: 'anthropic', modelId: 'claude-haiku' },
        ],
      };

      const provider = new LoadBalancingProvider(lbConfig, providerManager);
      const stats = provider.getStats();

      expect(stats.members).toStrictEqual(['fast', 'smart', 'cheap']);
    });
  });

  describe('lastSelectedModel before any request', () => {
    it('is null when no sub-profile has been selected yet', () => {
      const lbConfig: LoadBalancingProviderConfig = {
        profileName: 'pending-model-test',
        strategy: 'round-robin',
        subProfiles: [
          { name: 'fast', providerName: 'gemini', modelId: 'gemini-flash' },
          { name: 'smart', providerName: 'openai', modelId: 'gpt-4' },
        ],
      };

      const provider = new LoadBalancingProvider(lbConfig, providerManager);
      const stats = provider.getStats();

      expect(stats.lastSelected).toBeNull();
      expect(stats.lastSelectedModel).toBeNull();
    });
  });

  describe('lastSelectedModel when a sub-profile omits its model', () => {
    it('is null after selecting a sub-profile that has no modelId', async () => {
      const lbConfig: LoadBalancingProviderConfig = {
        profileName: 'no-model-id-test',
        strategy: 'round-robin',
        subProfiles: [
          // modelId intentionally omitted → resolveSubProfileModel() === ''
          { name: 'no-model', providerName: 'gemini' },
        ],
      };

      const provider = new LoadBalancingProvider(lbConfig, providerManager);
      const original = providerManager.getProviderByName.bind(providerManager);
      providerManager.getProviderByName = () => makeMockProvider('gemini');

      try {
        await drain(
          provider.generateChatCompletion({
            contents: [{ role: 'user', parts: [{ text: 'one' }] }],
          }),
        );
        const stats = provider.getStats();
        // The sub-profile is selected/tracked...
        expect(stats.lastSelected).toBe('no-model');
        // ...but with no model it reports null rather than an empty string.
        expect(stats.lastSelectedModel).toBeNull();
      } finally {
        providerManager.getProviderByName = original;
      }
    });
  });

  describe('lastSelectedModel after selection (round-robin)', () => {
    it('reports the model of the most recently selected sub-profile', async () => {
      const lbConfig: LoadBalancingProviderConfig = {
        profileName: 'rr-active-model-test',
        strategy: 'round-robin',
        subProfiles: [
          { name: 'fast', providerName: 'gemini', modelId: 'gemini-flash' },
          { name: 'smart', providerName: 'openai', modelId: 'gpt-4' },
        ],
      };

      const provider = new LoadBalancingProvider(lbConfig, providerManager);
      const original = providerManager.getProviderByName.bind(providerManager);
      providerManager.getProviderByName = (name: string) => {
        if (name === 'gemini') return makeMockProvider('gemini');
        if (name === 'openai') return makeMockProvider('openai');
        return original(name);
      };

      try {
        // First request → 'fast' (gemini-flash)
        await drain(
          provider.generateChatCompletion({
            contents: [{ role: 'user', parts: [{ text: 'one' }] }],
          }),
        );
        let stats = provider.getStats();
        expect(stats.lastSelected).toBe('fast');
        expect(stats.lastSelectedModel).toBe('gemini-flash');

        // Second request → 'smart' (gpt-4)
        await drain(
          provider.generateChatCompletion({
            contents: [{ role: 'user', parts: [{ text: 'two' }] }],
          }),
        );
        stats = provider.getStats();
        expect(stats.lastSelected).toBe('smart');
        expect(stats.lastSelectedModel).toBe('gpt-4');
      } finally {
        providerManager.getProviderByName = original;
      }
    });
  });

  describe('lastSelectedModel for resolved sub-profiles', () => {
    it('uses the resolved sub-profile model field', async () => {
      const lbConfig: LoadBalancingProviderConfig = {
        profileName: 'resolved-active-model-test',
        strategy: 'round-robin',
        subProfiles: [
          {
            name: 'resolved-sub',
            providerName: 'gemini',
            model: 'gemini-2.5-pro',
            ephemeralSettings: {},
            modelParams: {},
          },
        ],
      };

      const provider = new LoadBalancingProvider(lbConfig, providerManager);
      const original = providerManager.getProviderByName.bind(providerManager);
      providerManager.getProviderByName = () => makeMockProvider('gemini');

      try {
        await drain(
          provider.generateChatCompletion({
            contents: [{ role: 'user', parts: [{ text: 'one' }] }],
          }),
        );
        const stats = provider.getStats();
        expect(stats.lastSelected).toBe('resolved-sub');
        expect(stats.lastSelectedModel).toBe('gemini-2.5-pro');
      } finally {
        providerManager.getProviderByName = original;
      }
    });
  });

  describe('resetStats', () => {
    it('clears lastSelectedModel back to null', async () => {
      const lbConfig: LoadBalancingProviderConfig = {
        profileName: 'reset-active-model-test',
        strategy: 'round-robin',
        subProfiles: [
          { name: 'fast', providerName: 'gemini', modelId: 'gemini-flash' },
          { name: 'smart', providerName: 'openai', modelId: 'gpt-4' },
        ],
      };

      const provider = new LoadBalancingProvider(lbConfig, providerManager);
      const original = providerManager.getProviderByName.bind(providerManager);
      providerManager.getProviderByName = () => makeMockProvider('gemini');

      try {
        await drain(
          provider.generateChatCompletion({
            contents: [{ role: 'user', parts: [{ text: 'one' }] }],
          }),
        );
        let stats = provider.getStats();
        expect(stats.lastSelectedModel).toBe('gemini-flash');

        provider.resetStats();

        stats = provider.getStats();
        expect(stats.lastSelected).toBeNull();
        expect(stats.lastSelectedModel).toBeNull();
      } finally {
        providerManager.getProviderByName = original;
      }
    });
  });
});
