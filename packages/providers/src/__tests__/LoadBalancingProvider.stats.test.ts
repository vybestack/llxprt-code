/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
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

describe('LoadBalancingProvider', () => {
  let settingsService: SettingsService;
  let config: Config;
  let providerManager: ProviderManager;

  beforeEach(() => {
    settingsService = new SettingsService();
    config = createRuntimeConfigStub(settingsService);
    providerManager = new ProviderManager({ settingsService, config });
  });

  afterEach(() => {
    // Clean up any registered providers
  });

  describe('getStats method exposure', () => {
    it('should expose getStats method that returns LoadBalancerStats', () => {
      const lbConfig: LoadBalancingProviderConfig = {
        profileName: 'stats-exposure-test',
        strategy: 'round-robin',
        subProfiles: [
          { name: 'sub-1', providerName: 'gemini', modelId: 'gemini-flash' },
        ],
      };

      const provider = new LoadBalancingProvider(lbConfig, providerManager);

      // Verify getStats method exists
      expect(provider).toHaveProperty('getStats');
      expect(
        typeof (provider as unknown as { getStats: () => unknown }).getStats,
      ).toBe('function');

      // Call getStats and verify it returns an object
      const stats = (
        provider as unknown as { getStats: () => unknown }
      ).getStats();
      expect(stats).toBeDefined();
      expect(typeof stats).toBe('object');
    });

    it('should return stats with profileName field', () => {
      const lbConfig: LoadBalancingProviderConfig = {
        profileName: 'my-test-profile',
        strategy: 'round-robin',
        subProfiles: [
          { name: 'sub-1', providerName: 'gemini', modelId: 'gemini-flash' },
        ],
      };

      const provider = new LoadBalancingProvider(lbConfig, providerManager);

      const stats = (
        provider as unknown as {
          getStats: () => { profileName: string };
        }
      ).getStats();

      expect(stats.profileName).toBe('my-test-profile');
    });

    it('should return stats with totalRequests field', () => {
      const lbConfig: LoadBalancingProviderConfig = {
        profileName: 'total-requests-test',
        strategy: 'round-robin',
        subProfiles: [
          { name: 'sub-1', providerName: 'gemini', modelId: 'gemini-flash' },
        ],
      };

      const provider = new LoadBalancingProvider(lbConfig, providerManager);

      const stats = (
        provider as unknown as {
          getStats: () => { totalRequests: number };
        }
      ).getStats();

      expect(stats).toHaveProperty('totalRequests');
      expect(typeof stats.totalRequests).toBe('number');
    });

    it('should return stats with lastSelected field', () => {
      const lbConfig: LoadBalancingProviderConfig = {
        profileName: 'last-selected-test',
        strategy: 'round-robin',
        subProfiles: [
          { name: 'sub-1', providerName: 'gemini', modelId: 'gemini-flash' },
        ],
      };

      const provider = new LoadBalancingProvider(lbConfig, providerManager);

      const stats = (
        provider as unknown as {
          getStats: () => { lastSelected: string | null };
        }
      ).getStats();

      expect(stats).toHaveProperty('lastSelected');
      // Can be null or string
      expect(
        stats.lastSelected === null || typeof stats.lastSelected === 'string',
      ).toBe(true);
    });

    it('should return stats with profileCounts field', () => {
      const lbConfig: LoadBalancingProviderConfig = {
        profileName: 'profile-counts-test',
        strategy: 'round-robin',
        subProfiles: [
          { name: 'sub-1', providerName: 'gemini', modelId: 'gemini-flash' },
        ],
      };

      const provider = new LoadBalancingProvider(lbConfig, providerManager);

      const stats = (
        provider as unknown as {
          getStats: () => { profileCounts: Record<string, number> };
        }
      ).getStats();

      expect(stats).toHaveProperty('profileCounts');
      expect(typeof stats.profileCounts).toBe('object');
    });
  });
  describe('initial stats state (0 requests)', () => {
    it('should have totalRequests = 0 when no requests have been made', () => {
      const lbConfig: LoadBalancingProviderConfig = {
        profileName: 'zero-requests-test',
        strategy: 'round-robin',
        subProfiles: [
          { name: 'sub-1', providerName: 'gemini', modelId: 'gemini-flash' },
          { name: 'sub-2', providerName: 'gemini', modelId: 'gemini-pro' },
        ],
      };

      const provider = new LoadBalancingProvider(lbConfig, providerManager);

      const stats = (
        provider as unknown as {
          getStats: () => { totalRequests: number };
        }
      ).getStats();

      expect(stats.totalRequests).toBe(0);
    });

    it('should have lastSelected = null when no requests have been made', () => {
      const lbConfig: LoadBalancingProviderConfig = {
        profileName: 'null-last-selected-test',
        strategy: 'round-robin',
        subProfiles: [
          { name: 'sub-1', providerName: 'gemini', modelId: 'gemini-flash' },
          { name: 'sub-2', providerName: 'gemini', modelId: 'gemini-pro' },
        ],
      };

      const provider = new LoadBalancingProvider(lbConfig, providerManager);

      const stats = (
        provider as unknown as {
          getStats: () => { lastSelected: string | null };
        }
      ).getStats();

      expect(stats.lastSelected).toBeNull();
    });

    it('should have all profileCounts = 0 when no requests have been made', () => {
      const lbConfig: LoadBalancingProviderConfig = {
        profileName: 'zero-profile-counts-test',
        strategy: 'round-robin',
        subProfiles: [
          { name: 'sub-1', providerName: 'gemini', modelId: 'gemini-flash' },
          { name: 'sub-2', providerName: 'gemini', modelId: 'gemini-pro' },
        ],
      };

      const provider = new LoadBalancingProvider(lbConfig, providerManager);

      const stats = (
        provider as unknown as {
          getStats: () => { profileCounts: Record<string, number> };
        }
      ).getStats();

      // ProfileCounts should be empty object or have all zeros
      const counts = Object.values(stats.profileCounts);
      const allZeroOrEmpty =
        counts.length === 0 || counts.every((c) => c === 0);
      expect(allZeroOrEmpty).toBe(true);
    });
  });
  describe('stats tracking after requests', () => {
    it('should track request count for single sub-profile after 1 request', async () => {
      const lbConfig: LoadBalancingProviderConfig = {
        profileName: 'single-request-test',
        strategy: 'round-robin',
        subProfiles: [
          { name: 'sub-1', providerName: 'gemini', modelId: 'gemini-flash' },
        ],
      };

      const provider = new LoadBalancingProvider(lbConfig, providerManager);

      const mockProvider = {
        name: 'gemini',
        async *generateChatCompletion(): AsyncIterableIterator<IContent> {
          yield { role: 'model', parts: [{ text: 'response' }] };
        },
        getModels: async () => [],
        getDefaultModel: () => 'gemini-flash',
        getServerTools: () => [],
        invokeServerTool: async () => ({}),
      };

      const originalGetProvider =
        providerManager.getProviderByName.bind(providerManager);
      providerManager.getProviderByName = () => mockProvider as IProvider;

      try {
        // Make 1 request
        const iterator = provider.generateChatCompletion({
          contents: [{ role: 'user', parts: [{ text: 'test' }] }],
        });
        for await (const _chunk of iterator) {
          // Consume
        }

        // Check stats
        const stats = (
          provider as unknown as {
            getStats: () => {
              totalRequests: number;
              profileCounts: Record<string, number>;
            };
          }
        ).getStats();

        expect(stats.totalRequests).toBe(1);
        expect(stats.profileCounts['sub-1']).toBe(1);
      } finally {
        providerManager.getProviderByName = originalGetProvider;
      }
    });

    it('should update lastSelected after first request', async () => {
      const lbConfig: LoadBalancingProviderConfig = {
        profileName: 'first-last-selected-test',
        strategy: 'round-robin',
        subProfiles: [
          {
            name: 'first-sub',
            providerName: 'gemini',
            modelId: 'gemini-flash',
          },
        ],
      };

      const provider = new LoadBalancingProvider(lbConfig, providerManager);

      const mockProvider = {
        name: 'gemini',
        async *generateChatCompletion(): AsyncIterableIterator<IContent> {
          yield { role: 'model', parts: [{ text: 'response' }] };
        },
        getModels: async () => [],
        getDefaultModel: () => 'gemini-flash',
        getServerTools: () => [],
        invokeServerTool: async () => ({}),
      };

      const originalGetProvider =
        providerManager.getProviderByName.bind(providerManager);
      providerManager.getProviderByName = () => mockProvider as IProvider;

      try {
        // Make 1 request
        const iterator = provider.generateChatCompletion({
          contents: [{ role: 'user', parts: [{ text: 'test' }] }],
        });
        for await (const _chunk of iterator) {
          // Consume
        }

        // Check lastSelected
        const stats = (
          provider as unknown as {
            getStats: () => { lastSelected: string | null };
          }
        ).getStats();

        expect(stats.lastSelected).toBe('first-sub');
      } finally {
        providerManager.getProviderByName = originalGetProvider;
      }
    });

    it('should track round-robin distribution across 2 sub-profiles', async () => {
      const lbConfig: LoadBalancingProviderConfig = {
        profileName: 'two-profile-distribution-test',
        strategy: 'round-robin',
        subProfiles: [
          { name: 'sub-1', providerName: 'gemini', modelId: 'gemini-flash' },
          { name: 'sub-2', providerName: 'gemini', modelId: 'gemini-pro' },
        ],
      };

      const provider = new LoadBalancingProvider(lbConfig, providerManager);

      const mockProvider = {
        name: 'gemini',
        async *generateChatCompletion(): AsyncIterableIterator<IContent> {
          yield { role: 'model', parts: [{ text: 'response' }] };
        },
        getModels: async () => [],
        getDefaultModel: () => 'gemini-flash',
        getServerTools: () => [],
        invokeServerTool: async () => ({}),
      };

      const originalGetProvider =
        providerManager.getProviderByName.bind(providerManager);
      providerManager.getProviderByName = () => mockProvider as IProvider;

      try {
        // Make 4 requests (2 full round-robins)
        for (let i = 0; i < 4; i++) {
          const iterator = provider.generateChatCompletion({
            contents: [{ role: 'user', parts: [{ text: `test ${i}` }] }],
          });
          for await (const _chunk of iterator) {
            // Consume
          }
        }

        // Check stats
        const stats = (
          provider as unknown as {
            getStats: () => {
              totalRequests: number;
              profileCounts: Record<string, number>;
            };
          }
        ).getStats();

        expect(stats.totalRequests).toBe(4);
        expect(stats.profileCounts['sub-1']).toBe(2);
        expect(stats.profileCounts['sub-2']).toBe(2);
      } finally {
        providerManager.getProviderByName = originalGetProvider;
      }
    });

    it('should track round-robin distribution across 3 sub-profiles', async () => {
      const lbConfig: LoadBalancingProviderConfig = {
        profileName: 'three-profile-distribution-test',
        strategy: 'round-robin',
        subProfiles: [
          { name: 'sub-1', providerName: 'gemini', modelId: 'model-1' },
          { name: 'sub-2', providerName: 'gemini', modelId: 'model-2' },
          { name: 'sub-3', providerName: 'gemini', modelId: 'model-3' },
        ],
      };

      const provider = new LoadBalancingProvider(lbConfig, providerManager);

      const mockProvider = {
        name: 'gemini',
        async *generateChatCompletion(): AsyncIterableIterator<IContent> {
          yield { role: 'model', parts: [{ text: 'response' }] };
        },
        getModels: async () => [],
        getDefaultModel: () => 'model-1',
        getServerTools: () => [],
        invokeServerTool: async () => ({}),
      };

      const originalGetProvider =
        providerManager.getProviderByName.bind(providerManager);
      providerManager.getProviderByName = () => mockProvider as IProvider;

      try {
        // Make 6 requests (2 full round-robins)
        for (let i = 0; i < 6; i++) {
          const iterator = provider.generateChatCompletion({
            contents: [{ role: 'user', parts: [{ text: `test ${i}` }] }],
          });
          for await (const _chunk of iterator) {
            // Consume
          }
        }

        // Check stats
        const stats = (
          provider as unknown as {
            getStats: () => {
              totalRequests: number;
              profileCounts: Record<string, number>;
            };
          }
        ).getStats();

        expect(stats.totalRequests).toBe(6);
        expect(stats.profileCounts['sub-1']).toBe(2);
        expect(stats.profileCounts['sub-2']).toBe(2);
        expect(stats.profileCounts['sub-3']).toBe(2);
      } finally {
        providerManager.getProviderByName = originalGetProvider;
      }
    });

    it('should track uneven distribution correctly (7 requests, 3 profiles)', async () => {
      const lbConfig: LoadBalancingProviderConfig = {
        profileName: 'uneven-distribution-test',
        strategy: 'round-robin',
        subProfiles: [
          { name: 'sub-1', providerName: 'gemini', modelId: 'model-1' },
          { name: 'sub-2', providerName: 'gemini', modelId: 'model-2' },
          { name: 'sub-3', providerName: 'gemini', modelId: 'model-3' },
        ],
      };

      const provider = new LoadBalancingProvider(lbConfig, providerManager);

      const mockProvider = {
        name: 'gemini',
        async *generateChatCompletion(): AsyncIterableIterator<IContent> {
          yield { role: 'model', parts: [{ text: 'response' }] };
        },
        getModels: async () => [],
        getDefaultModel: () => 'model-1',
        getServerTools: () => [],
        invokeServerTool: async () => ({}),
      };

      const originalGetProvider =
        providerManager.getProviderByName.bind(providerManager);
      providerManager.getProviderByName = () => mockProvider as IProvider;

      try {
        // Make 7 requests (2 full round-robins + 1 extra)
        for (let i = 0; i < 7; i++) {
          const iterator = provider.generateChatCompletion({
            contents: [{ role: 'user', parts: [{ text: `test ${i}` }] }],
          });
          for await (const _chunk of iterator) {
            // Consume
          }
        }

        // Check stats
        const stats = (
          provider as unknown as {
            getStats: () => {
              totalRequests: number;
              profileCounts: Record<string, number>;
            };
          }
        ).getStats();

        expect(stats.totalRequests).toBe(7);
        // Round-robin: sub-1, sub-2, sub-3, sub-1, sub-2, sub-3, sub-1
        expect(stats.profileCounts['sub-1']).toBe(3); // Gets one extra
        expect(stats.profileCounts['sub-2']).toBe(2);
        expect(stats.profileCounts['sub-3']).toBe(2);
      } finally {
        providerManager.getProviderByName = originalGetProvider;
      }
    });

    it('should update lastSelected to most recent sub-profile', async () => {
      const lbConfig: LoadBalancingProviderConfig = {
        profileName: 'last-selected-update-test',
        strategy: 'round-robin',
        subProfiles: [
          { name: 'sub-1', providerName: 'gemini', modelId: 'model-1' },
          { name: 'sub-2', providerName: 'gemini', modelId: 'model-2' },
          { name: 'sub-3', providerName: 'gemini', modelId: 'model-3' },
        ],
      };

      const provider = new LoadBalancingProvider(lbConfig, providerManager);

      const mockProvider = {
        name: 'gemini',
        async *generateChatCompletion(): AsyncIterableIterator<IContent> {
          yield { role: 'model', parts: [{ text: 'response' }] };
        },
        getModels: async () => [],
        getDefaultModel: () => 'model-1',
        getServerTools: () => [],
        invokeServerTool: async () => ({}),
      };

      const originalGetProvider =
        providerManager.getProviderByName.bind(providerManager);
      providerManager.getProviderByName = () => mockProvider as IProvider;

      try {
        // Make requests and check lastSelected after each
        const expectedOrder = ['sub-1', 'sub-2', 'sub-3', 'sub-1', 'sub-2'];

        for (let i = 0; i < expectedOrder.length; i++) {
          const iterator = provider.generateChatCompletion({
            contents: [{ role: 'user', parts: [{ text: `test ${i}` }] }],
          });
          for await (const _chunk of iterator) {
            // Consume
          }

          const stats = (
            provider as unknown as {
              getStats: () => { lastSelected: string | null };
            }
          ).getStats();

          expect(stats.lastSelected).toBe(expectedOrder[i]);
        }
      } finally {
        providerManager.getProviderByName = originalGetProvider;
      }
    });
  });
  describe('stats persistence across multiple calls', () => {
    it('should accumulate stats across multiple generateChatCompletion calls', async () => {
      const lbConfig: LoadBalancingProviderConfig = {
        profileName: 'stats-accumulation-test',
        strategy: 'round-robin',
        subProfiles: [
          { name: 'sub-1', providerName: 'gemini', modelId: 'model-1' },
          { name: 'sub-2', providerName: 'gemini', modelId: 'model-2' },
        ],
      };

      const provider = new LoadBalancingProvider(lbConfig, providerManager);

      const mockProvider = {
        name: 'gemini',
        async *generateChatCompletion(): AsyncIterableIterator<IContent> {
          yield { role: 'model', parts: [{ text: 'response' }] };
        },
        getModels: async () => [],
        getDefaultModel: () => 'model-1',
        getServerTools: () => [],
        invokeServerTool: async () => ({}),
      };

      const originalGetProvider =
        providerManager.getProviderByName.bind(providerManager);
      providerManager.getProviderByName = () => mockProvider as IProvider;

      try {
        // First batch: 2 requests
        for (let i = 0; i < 2; i++) {
          const iterator = provider.generateChatCompletion({
            contents: [{ role: 'user', parts: [{ text: `test ${i}` }] }],
          });
          for await (const _chunk of iterator) {
            // Consume
          }
        }

        let stats = (
          provider as unknown as {
            getStats: () => {
              totalRequests: number;
              profileCounts: Record<string, number>;
            };
          }
        ).getStats();

        expect(stats.totalRequests).toBe(2);
        expect(stats.profileCounts['sub-1']).toBe(1);
        expect(stats.profileCounts['sub-2']).toBe(1);

        // Second batch: 3 more requests
        for (let i = 2; i < 5; i++) {
          const iterator = provider.generateChatCompletion({
            contents: [{ role: 'user', parts: [{ text: `test ${i}` }] }],
          });
          for await (const _chunk of iterator) {
            // Consume
          }
        }

        stats = (
          provider as unknown as {
            getStats: () => {
              totalRequests: number;
              profileCounts: Record<string, number>;
            };
          }
        ).getStats();

        // Total should be 5 (2 + 3)
        expect(stats.totalRequests).toBe(5);
        // Round-robin: sub-1, sub-2, sub-1, sub-2, sub-1
        expect(stats.profileCounts['sub-1']).toBe(3);
        expect(stats.profileCounts['sub-2']).toBe(2);
      } finally {
        providerManager.getProviderByName = originalGetProvider;
      }
    });

    it('should not reset stats between calls', async () => {
      const lbConfig: LoadBalancingProviderConfig = {
        profileName: 'stats-persistence-test',
        strategy: 'round-robin',
        subProfiles: [
          { name: 'sub-1', providerName: 'gemini', modelId: 'model-1' },
        ],
      };

      const provider = new LoadBalancingProvider(lbConfig, providerManager);

      const mockProvider = {
        name: 'gemini',
        async *generateChatCompletion(): AsyncIterableIterator<IContent> {
          yield { role: 'model', parts: [{ text: 'response' }] };
        },
        getModels: async () => [],
        getDefaultModel: () => 'model-1',
        getServerTools: () => [],
        invokeServerTool: async () => ({}),
      };

      const originalGetProvider =
        providerManager.getProviderByName.bind(providerManager);
      providerManager.getProviderByName = () => mockProvider as IProvider;

      try {
        // Make requests one at a time and check stats increment
        for (let expectedTotal = 1; expectedTotal <= 5; expectedTotal++) {
          const iterator = provider.generateChatCompletion({
            contents: [{ role: 'user', parts: [{ text: 'test' }] }],
          });
          for await (const _chunk of iterator) {
            // Consume
          }

          const stats = (
            provider as unknown as {
              getStats: () => { totalRequests: number };
            }
          ).getStats();

          expect(stats.totalRequests).toBe(expectedTotal);
        }
      } finally {
        providerManager.getProviderByName = originalGetProvider;
      }
    });
  });
});
