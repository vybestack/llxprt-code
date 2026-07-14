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

  describe('stats with different provider types', () => {
    it('should track stats correctly when using different provider types', async () => {
      const lbConfig: LoadBalancingProviderConfig = {
        profileName: 'mixed-provider-stats-test',
        strategy: 'round-robin',
        subProfiles: [
          {
            name: 'gemini-sub',
            providerName: 'gemini',
            modelId: 'gemini-flash',
          },
          { name: 'openai-sub', providerName: 'openai', modelId: 'gpt-4' },
          {
            name: 'anthropic-sub',
            providerName: 'anthropic',
            modelId: 'claude-3',
          },
        ],
      };

      const provider = new LoadBalancingProvider(lbConfig, providerManager);

      const createMockProvider = (name: string) => ({
        name,
        async *generateChatCompletion(): AsyncIterableIterator<IContent> {
          yield { role: 'model', parts: [{ text: `${name} response` }] };
        },
        getModels: async () => [],
        getDefaultModel: () => 'model',
        getServerTools: () => [],
        invokeServerTool: async () => ({}),
      });

      const originalGetProvider =
        providerManager.getProviderByName.bind(providerManager);
      providerManager.getProviderByName = (name: string) => {
        if (name === 'gemini') return createMockProvider('gemini') as IProvider;
        if (name === 'openai') return createMockProvider('openai') as IProvider;
        if (name === 'anthropic')
          return createMockProvider('anthropic') as IProvider;
        return originalGetProvider(name);
      };

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

        const stats = (
          provider as unknown as {
            getStats: () => {
              totalRequests: number;
              profileCounts: Record<string, number>;
              lastSelected: string | null;
            };
          }
        ).getStats();

        expect(stats.totalRequests).toBe(6);
        expect(stats.profileCounts['gemini-sub']).toBe(2);
        expect(stats.profileCounts['openai-sub']).toBe(2);
        expect(stats.profileCounts['anthropic-sub']).toBe(2);
        expect(stats.lastSelected).toBe('anthropic-sub'); // Last in round-robin
      } finally {
        providerManager.getProviderByName = originalGetProvider;
      }
    });
  });
  describe('percentage distribution calculation', () => {
    it('should allow calculation of percentage distribution from profileCounts', async () => {
      const lbConfig: LoadBalancingProviderConfig = {
        profileName: 'percentage-test',
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
        // Make 10 requests for easy percentage calculation
        for (let i = 0; i < 10; i++) {
          const iterator = provider.generateChatCompletion({
            contents: [{ role: 'user', parts: [{ text: `test ${i}` }] }],
          });
          for await (const _chunk of iterator) {
            // Consume
          }
        }

        const stats = (
          provider as unknown as {
            getStats: () => {
              totalRequests: number;
              profileCounts: Record<string, number>;
            };
          }
        ).getStats();

        // Calculate percentages from stats
        const calculatePercentage = (count: number, total: number): number =>
          total === 0 ? 0 : (count / total) * 100;

        const percentage1 = calculatePercentage(
          stats.profileCounts['sub-1'],
          stats.totalRequests,
        );
        const percentage2 = calculatePercentage(
          stats.profileCounts['sub-2'],
          stats.totalRequests,
        );

        // With 10 requests and 2 profiles, should be 50% each
        expect(percentage1).toBe(50);
        expect(percentage2).toBe(50);
        expect(percentage1 + percentage2).toBe(100);
      } finally {
        providerManager.getProviderByName = originalGetProvider;
      }
    });

    it('should support percentage calculation with uneven distribution', async () => {
      const lbConfig: LoadBalancingProviderConfig = {
        profileName: 'uneven-percentage-test',
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
        // Make 10 requests (3 profiles: 4, 3, 3 distribution)
        for (let i = 0; i < 10; i++) {
          const iterator = provider.generateChatCompletion({
            contents: [{ role: 'user', parts: [{ text: `test ${i}` }] }],
          });
          for await (const _chunk of iterator) {
            // Consume
          }
        }

        const stats = (
          provider as unknown as {
            getStats: () => {
              totalRequests: number;
              profileCounts: Record<string, number>;
            };
          }
        ).getStats();

        const calculatePercentage = (count: number, total: number): number =>
          total === 0 ? 0 : (count / total) * 100;

        const percentage1 = calculatePercentage(
          stats.profileCounts['sub-1'],
          stats.totalRequests,
        );
        const percentage2 = calculatePercentage(
          stats.profileCounts['sub-2'],
          stats.totalRequests,
        );
        const percentage3 = calculatePercentage(
          stats.profileCounts['sub-3'],
          stats.totalRequests,
        );

        // Round-robin: sub-1 (4 requests = 40%), sub-2 (3 = 30%), sub-3 (3 = 30%)
        expect(percentage1).toBe(40);
        expect(percentage2).toBe(30);
        expect(percentage3).toBe(30);
        expect(percentage1 + percentage2 + percentage3).toBe(100);
      } finally {
        providerManager.getProviderByName = originalGetProvider;
      }
    });
  });
  describe('optional stats reset capability', () => {
    it('should expose resetStats method for resetting statistics', async () => {
      const lbConfig: LoadBalancingProviderConfig = {
        profileName: 'reset-stats-test',
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
        // Make some requests
        for (let i = 0; i < 4; i++) {
          const iterator = provider.generateChatCompletion({
            contents: [{ role: 'user', parts: [{ text: `test ${i}` }] }],
          });
          for await (const _chunk of iterator) {
            // Consume
          }
        }

        // Verify stats are accumulated
        let stats = (
          provider as unknown as {
            getStats: () => {
              totalRequests: number;
              profileCounts: Record<string, number>;
              lastSelected: string | null;
            };
          }
        ).getStats();

        expect(stats.totalRequests).toBe(4);

        // Reset stats
        (provider as unknown as { resetStats: () => void }).resetStats();

        // Verify stats are reset
        stats = (
          provider as unknown as {
            getStats: () => {
              totalRequests: number;
              profileCounts: Record<string, number>;
              lastSelected: string | null;
            };
          }
        ).getStats();

        expect(stats.totalRequests).toBe(0);
        expect(stats.lastSelected).toBeNull();

        const counts = Object.values(stats.profileCounts);
        const allZeroOrEmpty =
          counts.length === 0 || counts.every((c) => c === 0);
        expect(allZeroOrEmpty).toBe(true);
      } finally {
        providerManager.getProviderByName = originalGetProvider;
      }
    });

    it('should not affect round-robin counter when stats are reset', async () => {
      const lbConfig: LoadBalancingProviderConfig = {
        profileName: 'reset-no-affect-counter-test',
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
        // Make 2 requests (sub-1, sub-2)
        for (let i = 0; i < 2; i++) {
          const iterator = provider.generateChatCompletion({
            contents: [{ role: 'user', parts: [{ text: `test ${i}` }] }],
          });
          for await (const _chunk of iterator) {
            // Consume
          }
        }

        // Reset stats
        (provider as unknown as { resetStats: () => void }).resetStats();

        // Next request should still go to sub-3 (counter not reset)
        const iterator = provider.generateChatCompletion({
          contents: [{ role: 'user', parts: [{ text: 'test post-reset' }] }],
        });
        for await (const _chunk of iterator) {
          // Consume
        }

        const stats = (
          provider as unknown as {
            getStats: () => {
              totalRequests: number;
              profileCounts: Record<string, number>;
              lastSelected: string | null;
            };
          }
        ).getStats();

        // After reset, should have 1 request to sub-3
        expect(stats.totalRequests).toBe(1);
        expect(stats.lastSelected).toBe('sub-3');
        expect(stats.profileCounts['sub-3']).toBe(1);
      } finally {
        providerManager.getProviderByName = originalGetProvider;
      }
    });
  });
  describe('stats type interface compliance', () => {
    it('should return stats conforming to LoadBalancerStats interface structure', () => {
      const lbConfig: LoadBalancingProviderConfig = {
        profileName: 'interface-compliance-test',
        strategy: 'round-robin',
        subProfiles: [
          { name: 'sub-1', providerName: 'gemini', modelId: 'model-1' },
        ],
      };

      const provider = new LoadBalancingProvider(lbConfig, providerManager);

      const stats = (
        provider as unknown as {
          getStats: () => {
            profileName: string;
            lastSelected: string | null;
            totalRequests: number;
            profileCounts: Record<string, number>;
          };
        }
      ).getStats();

      // Verify all required fields exist with correct types
      expect(typeof stats.profileName).toBe('string');
      expect(
        stats.lastSelected === null || typeof stats.lastSelected === 'string',
      ).toBe(true);
      expect(typeof stats.totalRequests).toBe('number');
      expect(typeof stats.profileCounts).toBe('object');
      expect(stats.profileCounts).not.toBeNull();
    });
  });
});
