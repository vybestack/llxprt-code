/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Phase 4: TPM Tracking Tests
 * Issue #489 - Advanced Failover with Metrics
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  LoadBalancingProvider,
  type LoadBalancingProviderConfig,
  type LoadBalancerSubProfile,
} from '../LoadBalancingProvider.js';
import { ProviderManager } from '../ProviderManager.js';
import type { IContent } from '../../services/history/IContent.js';

/**
 * Helper function to create a mock provider with usage metadata
 */
function createMockProviderWithUsage(
  name: string,
  promptTokens: number,
  candidateTokens: number,
  responseText = 'Response',
  callCounter?: { count: number },
) {
  return {
    name,
    async *generateChatCompletion(): AsyncGenerator<IContent> {
      if (callCounter) {
        callCounter.count++;
      }
      yield {
        role: 'assistant',
        parts: [{ text: responseText }],
        usageMetadata: {
          promptTokenCount: promptTokens,
          candidatesTokenCount: candidateTokens,
        },
      } as unknown as IContent;
    },
    getServerTools: () => [],
  };
}

describe('LoadBalancingProvider TPM Tracking - Phase 4', () => {
  let providerManager: ProviderManager;
  let config: LoadBalancingProviderConfig;
  const subProfiles: LoadBalancerSubProfile[] = [
    {
      name: 'backend1',
      providerName: 'test-provider-1',
      modelId: 'test-model-1',
      baseURL: 'https://test1.com',
      authToken: 'token1',
    },
    {
      name: 'backend2',
      providerName: 'test-provider-2',
      modelId: 'test-model-2',
      baseURL: 'https://test2.com',
      authToken: 'token2',
    },
  ];

  beforeEach(() => {
    providerManager = new ProviderManager();
    config = {
      profileName: 'test-lb',
      strategy: 'failover',
      subProfiles,
      lbProfileEphemeralSettings: {},
    };
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('TPM calculation basics', () => {
    it('should return 0 TPM when no requests made', () => {
      const lb = new LoadBalancingProvider(config, providerManager);
      const stats = lb.getStats();

      expect(stats.currentTPM.backend1 || 0).toBe(0);
      expect(stats.currentTPM.backend2 || 0).toBe(0);
    });

    it('should track tokens after successful request', async () => {
      const lb = new LoadBalancingProvider(config, providerManager);

      const mockProvider = createMockProviderWithUsage(
        'test-provider-1',
        100,
        50,
        'Hello!',
      );
      providerManager.registerProvider(mockProvider);

      const gen = lb.generateChatCompletion({
        contents: [{ role: 'user', parts: [{ text: 'test' }] }],
      });

      for await (const _chunk of gen) {
        // consume
      }

      const stats = lb.getStats();
      // Should have tracked tokens (150 total)
      expect(stats.currentTPM.backend1).toBeGreaterThan(0);
    });
  });

  describe('TPM rolling window', () => {
    it('should use 5-minute rolling window for TPM', async () => {
      vi.useFakeTimers();

      const lb = new LoadBalancingProvider(config, providerManager);

      const mockProvider = createMockProviderWithUsage(
        'test-provider-1',
        500,
        500,
      );
      providerManager.registerProvider(mockProvider);

      // Make a request
      const gen = lb.generateChatCompletion({
        contents: [{ role: 'user', parts: [{ text: 'test' }] }],
      });

      for await (const _chunk of gen) {
        // consume
      }

      // Initial TPM should be 1000 (tokens / 1 minute elapsed)
      let stats = lb.getStats();
      expect(stats.currentTPM.backend1).toBe(1000);

      // Advance time by 4 minutes - should now average over 5 elapsed minutes
      // TPM = 1000 tokens / 5 minutes = 200
      vi.advanceTimersByTime(4 * 60 * 1000);
      stats = lb.getStats();
      // After 5 minutes elapsed, TPM should be lower
      expect(stats.currentTPM.backend1).toBe(200);
    });

    it('should clean up old buckets outside 5-minute window', async () => {
      vi.useFakeTimers();

      const lb = new LoadBalancingProvider(config, providerManager);

      const mockProvider = createMockProviderWithUsage(
        'test-provider-1',
        100,
        100,
      );
      providerManager.registerProvider(mockProvider);

      // Make first request
      const gen1 = lb.generateChatCompletion({
        contents: [{ role: 'user', parts: [{ text: 'test1' }] }],
      });
      for await (const _chunk of gen1) {
        // consume
      }

      // Advance time by 6 minutes (beyond window)
      vi.advanceTimersByTime(6 * 60 * 1000);

      // Make second request
      const gen2 = lb.generateChatCompletion({
        contents: [{ role: 'user', parts: [{ text: 'test2' }] }],
      });
      for await (const _chunk of gen2) {
        // consume
      }

      const stats = lb.getStats();
      // Only second request's tokens should be counted (first is outside window)
      expect(stats.currentTPM.backend1).toBe(200); // 200 tokens / 1 minute
    });
  });

  describe('TPM threshold trigger', () => {
    it('should not trigger failover when TPM above threshold', async () => {
      const lb = new LoadBalancingProvider(
        {
          ...config,
          lbProfileEphemeralSettings: {
            tpm_threshold: 100, // Low threshold
          },
        },
        providerManager,
      );

      const backend1Calls = { count: 0 };
      const mockProvider1 = createMockProviderWithUsage(
        'test-provider-1',
        500,
        500,
        'Response',
        backend1Calls,
      );
      providerManager.registerProvider(mockProvider1);

      // First request - should succeed and establish high TPM
      const gen1 = lb.generateChatCompletion({
        contents: [{ role: 'user', parts: [{ text: 'test1' }] }],
      });
      for await (const _chunk of gen1) {
        // consume
      }

      // Second request - TPM is 1000, above threshold of 100
      const gen2 = lb.generateChatCompletion({
        contents: [{ role: 'user', parts: [{ text: 'test2' }] }],
      });
      for await (const _chunk of gen2) {
        // consume
      }

      // Should have called backend1 for both requests
      expect(backend1Calls.count).toBe(2);
    });

    it('should trigger failover when TPM below threshold', async () => {
      vi.useFakeTimers();

      const lb = new LoadBalancingProvider(
        {
          ...config,
          lbProfileEphemeralSettings: {
            tpm_threshold: 500, // Moderate threshold
            failover_retry_count: 1,
          },
        },
        providerManager,
      );

      const backend1Calls = { count: 0 };
      const backend2Calls = { count: 0 };
      const mockProvider1 = createMockProviderWithUsage(
        'test-provider-1',
        50,
        50,
        'Response',
        backend1Calls,
      );
      const mockProvider2 = createMockProviderWithUsage(
        'test-provider-2',
        500,
        500,
        'Response from backend2',
        backend2Calls,
      );
      providerManager.registerProvider(mockProvider1);
      providerManager.registerProvider(mockProvider2);

      // First request - establishes TPM of 100 (single request)
      const gen1 = lb.generateChatCompletion({
        contents: [{ role: 'user', parts: [{ text: 'test1' }] }],
      });
      for await (const _chunk of gen1) {
        // consume
      }

      // Advance time by 4 minutes to drop TPM
      // TPM = 100 tokens / 5 minutes = 20, which is below threshold of 500
      vi.advanceTimersByTime(4 * 60 * 1000);

      // Second request - TPM is now below threshold, should skip backend1
      const gen2 = lb.generateChatCompletion({
        contents: [{ role: 'user', parts: [{ text: 'test2' }] }],
      });
      for await (const _chunk of gen2) {
        // consume
      }

      // Backend1 called once for first request
      expect(backend1Calls.count).toBe(1);
      // Backend2 called for second request (failover due to low TPM)
      expect(backend2Calls.count).toBe(1);
    });

    it('should not check TPM when threshold not configured', async () => {
      const lb = new LoadBalancingProvider(
        {
          ...config,
          lbProfileEphemeralSettings: {
            // No tpm_threshold configured
          },
        },
        providerManager,
      );

      const backend1Calls = { count: 0 };
      const mockProvider1 = createMockProviderWithUsage(
        'test-provider-1',
        1,
        1,
        'Response',
        backend1Calls,
      );
      providerManager.registerProvider(mockProvider1);

      // First request
      const gen1 = lb.generateChatCompletion({
        contents: [{ role: 'user', parts: [{ text: 'test1' }] }],
      });
      for await (const _chunk of gen1) {
        // consume
      }

      // Second request - even with low TPM, should not failover without threshold
      const gen2 = lb.generateChatCompletion({
        contents: [{ role: 'user', parts: [{ text: 'test2' }] }],
      });
      for await (const _chunk of gen2) {
        // consume
      }

      // Should have called backend1 for both requests
      expect(backend1Calls.count).toBe(2);
    });
  });

  describe('TPM calculation edge cases', () => {
    it('should handle single bucket correctly', async () => {
      const lb = new LoadBalancingProvider(config, providerManager);

      const mockProvider = createMockProviderWithUsage(
        'test-provider-1',
        500,
        500,
      );
      providerManager.registerProvider(mockProvider);

      const gen = lb.generateChatCompletion({
        contents: [{ role: 'user', parts: [{ text: 'test' }] }],
      });

      for await (const _chunk of gen) {
        // consume
      }

      const stats = lb.getStats();
      // Single bucket: 1000 tokens / 1 minute = 1000 TPM
      expect(stats.currentTPM.backend1).toBe(1000);
    });

    it('should handle multiple buckets in same minute', async () => {
      const lb = new LoadBalancingProvider(config, providerManager);

      const mockProvider = createMockProviderWithUsage(
        'test-provider-1',
        100,
        100,
      );
      providerManager.registerProvider(mockProvider);

      // Make 3 requests in same minute
      for (let i = 0; i < 3; i++) {
        const gen = lb.generateChatCompletion({
          contents: [{ role: 'user', parts: [{ text: `test${i}` }] }],
        });
        for await (const _chunk of gen) {
          // consume
        }
      }

      const stats = lb.getStats();
      // 3 requests * 200 tokens = 600 tokens / 1 minute = 600 TPM
      expect(stats.currentTPM.backend1).toBe(600);
    });

    it('should calculate TPM over elapsed time not occupied buckets', async () => {
      vi.useFakeTimers();

      const lb = new LoadBalancingProvider(config, providerManager);

      const mockProvider = createMockProviderWithUsage(
        'test-provider-1',
        500,
        500,
      );
      providerManager.registerProvider(mockProvider);

      // Make request at minute 0
      const gen1 = lb.generateChatCompletion({
        contents: [{ role: 'user', parts: [{ text: 'test1' }] }],
      });
      for await (const _chunk of gen1) {
        // consume
      }

      // Advance to minute 2 (skip minute 1)
      vi.advanceTimersByTime(2 * 60 * 1000);

      // Make request at minute 2
      const gen2 = lb.generateChatCompletion({
        contents: [{ role: 'user', parts: [{ text: 'test2' }] }],
      });
      for await (const _chunk of gen2) {
        // consume
      }

      const stats = lb.getStats();
      // 2000 tokens over 3 minutes (minute 0 to minute 2 inclusive) = 666.67 TPM
      expect(Math.round(stats.currentTPM.backend1)).toBeCloseTo(667, 0);
    });
  });
});
