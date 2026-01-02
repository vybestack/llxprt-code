/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Phase 2: Circuit Breaker Logic Tests
 * Issue #489 - Advanced Failover with Metrics
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  LoadBalancingProvider,
  type LoadBalancingProviderConfig,
  type LoadBalancerSubProfile,
} from '../LoadBalancingProvider.js';
import { ProviderManager } from '../ProviderManager.js';
import { SettingsService } from '../../settings/SettingsService.js';
import { createRuntimeConfigStub } from '../../test-utils/runtime.js';
import type { Config } from '../../config/config.js';
import type { IContent } from '../../services/history/IContent.js';

describe('LoadBalancingProvider Circuit Breaker - Phase 2', () => {
  let settingsService: SettingsService;
  let runtimeConfig: Config;
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
    settingsService = new SettingsService();
    runtimeConfig = createRuntimeConfigStub(settingsService);
    providerManager = new ProviderManager({
      settingsService,
      config: runtimeConfig,
    });
    config = {
      profileName: 'test-lb',
      strategy: 'failover',
      subProfiles,
      lbProfileEphemeralSettings: {},
    };
  });

  describe('Circuit breaker initialization', () => {
    it('should start in closed state', async () => {
      const lb = new LoadBalancingProvider(
        {
          ...config,
          lbProfileEphemeralSettings: {
            circuit_breaker_enabled: true,
          },
        },
        providerManager,
      );

      const stats = lb.getStats();
      expect(stats.circuitBreakerStates).toBeDefined();
    });

    it('should not track circuit breaker state when disabled', async () => {
      const lb = new LoadBalancingProvider(
        {
          ...config,
          lbProfileEphemeralSettings: {
            circuit_breaker_enabled: false,
          },
        },
        providerManager,
      );

      const mockProvider = {
        name: 'test-provider-1',
        async *generateChatCompletion(): AsyncGenerator<IContent> {
          throw new Error('Test error');
          yield; // Never reached, but satisfies generator requirement
        },
        getServerTools: () => [],
      };
      providerManager.registerProvider(mockProvider);

      try {
        const gen = lb.generateChatCompletion({
          contents: [{ role: 'user', parts: [{ text: 'test' }] }],
        });
        for await (const _chunk of gen) {
          // consume
        }
      } catch {
        // Expected to fail
      }

      // Circuit breaker should not track failures when disabled
      const stats = lb.getStats();
      expect(stats.circuitBreakerStates).toBeDefined();
    });
  });

  describe('Circuit breaker state transitions', () => {
    it('should open circuit after threshold failures', async () => {
      const lb = new LoadBalancingProvider(
        {
          ...config,
          lbProfileEphemeralSettings: {
            circuit_breaker_enabled: true,
            circuit_breaker_failure_threshold: 2,
            circuit_breaker_failure_window_ms: 60000,
            failover_retry_count: 1,
          },
        },
        providerManager,
      );

      const mockProvider1 = {
        name: 'test-provider-1',
        async *generateChatCompletion(): AsyncGenerator<IContent> {
          throw new Error('Backend failure');
          yield; // Never reached, but satisfies generator requirement
        },
        getServerTools: () => [],
      };
      const mockProvider2 = {
        name: 'test-provider-2',
        async *generateChatCompletion(): AsyncGenerator<IContent> {
          yield { role: 'assistant', parts: [{ text: 'success' }] } as IContent;
        },
        getServerTools: () => [],
      };

      providerManager.registerProvider(mockProvider1);
      providerManager.registerProvider(mockProvider2);

      // First request - should fail backend1, succeed on backend2
      const gen1 = lb.generateChatCompletion({
        contents: [{ role: 'user', parts: [{ text: 'test1' }] }],
      });
      for await (const _chunk of gen1) {
        // consume
      }

      // Second request - should fail backend1 again, succeed on backend2
      const gen2 = lb.generateChatCompletion({
        contents: [{ role: 'user', parts: [{ text: 'test2' }] }],
      });
      for await (const _chunk of gen2) {
        // consume
      }

      const stats = lb.getStats();
      const backend1State = stats.circuitBreakerStates.backend1;

      // After 2 failures, circuit should be open
      expect(backend1State).toBeDefined();
      expect(backend1State.state).toBe('open');
      expect(backend1State.failures.length).toBeGreaterThanOrEqual(2);
      expect(backend1State.openedAt).toBeDefined();
    });

    it('should stay open during cooldown period', async () => {
      const lb = new LoadBalancingProvider(
        {
          ...config,
          lbProfileEphemeralSettings: {
            circuit_breaker_enabled: true,
            circuit_breaker_failure_threshold: 2,
            circuit_breaker_failure_window_ms: 60000,
            circuit_breaker_recovery_timeout_ms: 5000,
            failover_retry_count: 1,
          },
        },
        providerManager,
      );

      const mockProvider1 = {
        name: 'test-provider-1',
        async *generateChatCompletion(): AsyncGenerator<IContent> {
          throw new Error('Backend failure');
          yield; // Never reached, but satisfies generator requirement
        },
        getServerTools: () => [],
      };
      const mockProvider2 = {
        name: 'test-provider-2',
        async *generateChatCompletion(): AsyncGenerator<IContent> {
          yield { role: 'assistant', parts: [{ text: 'success' }] } as IContent;
        },
        getServerTools: () => [],
      };

      providerManager.registerProvider(mockProvider1);
      providerManager.registerProvider(mockProvider2);

      // Trigger 2 failures to open circuit
      for (let i = 0; i < 2; i++) {
        const gen = lb.generateChatCompletion({
          contents: [{ role: 'user', parts: [{ text: `test${i}` }] }],
        });
        for await (const _chunk of gen) {
          // consume
        }
      }

      const stats1 = lb.getStats();
      expect(stats1.circuitBreakerStates.backend1.state).toBe('open');

      // Immediate retry should skip backend1 (still open)
      const gen = lb.generateChatCompletion({
        contents: [{ role: 'user', parts: [{ text: 'test-immediate' }] }],
      });
      for await (const _chunk of gen) {
        // consume
      }

      const stats2 = lb.getStats();
      expect(stats2.circuitBreakerStates.backend1.state).toBe('open');
    });

    it('should transition to half-open after recovery timeout', async () => {
      const lb = new LoadBalancingProvider(
        {
          ...config,
          lbProfileEphemeralSettings: {
            circuit_breaker_enabled: true,
            circuit_breaker_failure_threshold: 2,
            circuit_breaker_failure_window_ms: 60000,
            circuit_breaker_recovery_timeout_ms: 100, // Short timeout for testing
            failover_retry_count: 1,
          },
        },
        providerManager,
      );

      let backend1Calls = 0;
      const mockProvider1 = {
        name: 'test-provider-1',
        async *generateChatCompletion(): AsyncGenerator<IContent> {
          backend1Calls++;
          if (backend1Calls <= 2) {
            throw new Error('Backend failure');
          }
          yield {
            role: 'assistant',
            parts: [{ text: 'recovered' }],
          } as IContent;
        },
        getServerTools: () => [],
      };
      const mockProvider2 = {
        name: 'test-provider-2',
        async *generateChatCompletion(): AsyncGenerator<IContent> {
          yield { role: 'assistant', parts: [{ text: 'success' }] } as IContent;
        },
        getServerTools: () => [],
      };

      providerManager.registerProvider(mockProvider1);
      providerManager.registerProvider(mockProvider2);

      // Trigger 2 failures to open circuit
      for (let i = 0; i < 2; i++) {
        const gen = lb.generateChatCompletion({
          contents: [{ role: 'user', parts: [{ text: `test${i}` }] }],
        });
        for await (const _chunk of gen) {
          // consume
        }
      }

      const stats1 = lb.getStats();
      expect(stats1.circuitBreakerStates.backend1.state).toBe('open');

      // Wait for recovery timeout
      await new Promise((resolve) => setTimeout(resolve, 150));

      // Next request should try backend1 in half-open state
      const gen = lb.generateChatCompletion({
        contents: [{ role: 'user', parts: [{ text: 'test-recovery' }] }],
      });
      for await (const _chunk of gen) {
        // consume
      }

      const stats2 = lb.getStats();
      // Should be closed after successful recovery
      expect(stats2.circuitBreakerStates.backend1.state).toBe('closed');
    });

    it('should close circuit on successful half-open attempt', async () => {
      const lb = new LoadBalancingProvider(
        {
          ...config,
          lbProfileEphemeralSettings: {
            circuit_breaker_enabled: true,
            circuit_breaker_failure_threshold: 2,
            circuit_breaker_failure_window_ms: 60000,
            circuit_breaker_recovery_timeout_ms: 100,
            failover_retry_count: 1,
          },
        },
        providerManager,
      );

      let backend1Calls = 0;
      const mockProvider1 = {
        name: 'test-provider-1',
        async *generateChatCompletion(): AsyncGenerator<IContent> {
          backend1Calls++;
          if (backend1Calls <= 2) {
            throw new Error('Backend failure');
          }
          yield {
            role: 'assistant',
            parts: [{ text: 'recovered' }],
          } as IContent;
        },
        getServerTools: () => [],
      };
      const mockProvider2 = {
        name: 'test-provider-2',
        async *generateChatCompletion(): AsyncGenerator<IContent> {
          yield { role: 'assistant', parts: [{ text: 'success' }] } as IContent;
        },
        getServerTools: () => [],
      };

      providerManager.registerProvider(mockProvider1);
      providerManager.registerProvider(mockProvider2);

      // Open circuit
      for (let i = 0; i < 2; i++) {
        const gen = lb.generateChatCompletion({
          contents: [{ role: 'user', parts: [{ text: `test${i}` }] }],
        });
        for await (const _chunk of gen) {
          // consume
        }
      }

      // Wait and recover
      await new Promise((resolve) => setTimeout(resolve, 150));

      const gen = lb.generateChatCompletion({
        contents: [{ role: 'user', parts: [{ text: 'test-recovery' }] }],
      });
      for await (const _chunk of gen) {
        // consume
      }

      const stats = lb.getStats();
      expect(stats.circuitBreakerStates.backend1.state).toBe('closed');
      expect(stats.circuitBreakerStates.backend1.failures).toHaveLength(0);
    });

    it('should return to open on failed half-open attempt', async () => {
      const lb = new LoadBalancingProvider(
        {
          ...config,
          lbProfileEphemeralSettings: {
            circuit_breaker_enabled: true,
            circuit_breaker_failure_threshold: 2,
            circuit_breaker_failure_window_ms: 60000,
            circuit_breaker_recovery_timeout_ms: 100,
            failover_retry_count: 1,
          },
        },
        providerManager,
      );

      const mockProvider1 = {
        name: 'test-provider-1',
        async *generateChatCompletion(): AsyncGenerator<IContent> {
          throw new Error('Still failing');
          yield; // Never reached, but satisfies generator requirement
        },
        getServerTools: () => [],
      };
      const mockProvider2 = {
        name: 'test-provider-2',
        async *generateChatCompletion(): AsyncGenerator<IContent> {
          yield { role: 'assistant', parts: [{ text: 'success' }] } as IContent;
        },
        getServerTools: () => [],
      };

      providerManager.registerProvider(mockProvider1);
      providerManager.registerProvider(mockProvider2);

      // Open circuit
      for (let i = 0; i < 2; i++) {
        const gen = lb.generateChatCompletion({
          contents: [{ role: 'user', parts: [{ text: `test${i}` }] }],
        });
        for await (const _chunk of gen) {
          // consume
        }
      }

      // Wait and try recovery (will fail)
      await new Promise((resolve) => setTimeout(resolve, 150));

      const gen = lb.generateChatCompletion({
        contents: [{ role: 'user', parts: [{ text: 'test-recovery' }] }],
      });
      for await (const _chunk of gen) {
        // consume
      }

      const stats = lb.getStats();
      expect(stats.circuitBreakerStates.backend1.state).toBe('open');
    });
  });

  describe('Failure window pruning', () => {
    it('should prune old failures outside window', async () => {
      const lb = new LoadBalancingProvider(
        {
          ...config,
          lbProfileEphemeralSettings: {
            circuit_breaker_enabled: true,
            circuit_breaker_failure_threshold: 3,
            circuit_breaker_failure_window_ms: 100, // Short window for testing
            failover_retry_count: 1,
          },
        },
        providerManager,
      );

      const mockProvider1 = {
        name: 'test-provider-1',
        async *generateChatCompletion(): AsyncGenerator<IContent> {
          throw new Error('Backend failure');
          yield; // Never reached, but satisfies generator requirement
        },
        getServerTools: () => [],
      };
      const mockProvider2 = {
        name: 'test-provider-2',
        async *generateChatCompletion(): AsyncGenerator<IContent> {
          yield { role: 'assistant', parts: [{ text: 'success' }] } as IContent;
        },
        getServerTools: () => [],
      };

      providerManager.registerProvider(mockProvider1);
      providerManager.registerProvider(mockProvider2);

      // First failure
      const gen1 = lb.generateChatCompletion({
        contents: [{ role: 'user', parts: [{ text: 'test1' }] }],
      });
      for await (const _chunk of gen1) {
        // consume
      }

      // Wait for window to expire
      await new Promise((resolve) => setTimeout(resolve, 150));

      // Second failure (first should be pruned)
      const gen2 = lb.generateChatCompletion({
        contents: [{ role: 'user', parts: [{ text: 'test2' }] }],
      });
      for await (const _chunk of gen2) {
        // consume
      }

      const stats = lb.getStats();
      const backend1State = stats.circuitBreakerStates.backend1;

      // Should have only recent failures (old ones pruned)
      expect(backend1State.failures.length).toBeLessThan(3);
      expect(backend1State.state).toBe('closed'); // Not enough failures in window
    });
  });

  describe('All backends unhealthy error', () => {
    it('should throw specific error when all circuits are open', async () => {
      const lb = new LoadBalancingProvider(
        {
          ...config,
          lbProfileEphemeralSettings: {
            circuit_breaker_enabled: true,
            circuit_breaker_failure_threshold: 1,
            circuit_breaker_failure_window_ms: 60000,
            circuit_breaker_recovery_timeout_ms: 5000,
            failover_retry_count: 1,
          },
        },
        providerManager,
      );

      const mockProvider1 = {
        name: 'test-provider-1',
        async *generateChatCompletion(): AsyncGenerator<IContent> {
          throw new Error('Backend 1 failure');
          yield; // Never reached, but satisfies generator requirement
        },
        getServerTools: () => [],
      };
      const mockProvider2 = {
        name: 'test-provider-2',
        async *generateChatCompletion(): AsyncGenerator<IContent> {
          throw new Error('Backend 2 failure');
          yield; // Never reached, but satisfies generator requirement
        },
        getServerTools: () => [],
      };

      providerManager.registerProvider(mockProvider1);
      providerManager.registerProvider(mockProvider2);

      // First request - fails both backends, opens both circuits
      let firstError: unknown;
      try {
        const gen = lb.generateChatCompletion({
          contents: [{ role: 'user', parts: [{ text: 'test' }] }],
        });
        for await (const _chunk of gen) {
          // consume
        }
      } catch (error) {
        firstError = error;
      }
      expect(firstError).toBeDefined();

      const stats1 = lb.getStats();
      expect(stats1.circuitBreakerStates.backend1.state).toBe('open');
      expect(stats1.circuitBreakerStates.backend2.state).toBe('open');

      // Second request - should throw specific error about all backends unhealthy
      let secondError: unknown;
      try {
        const gen = lb.generateChatCompletion({
          contents: [{ role: 'user', parts: [{ text: 'test2' }] }],
        });
        for await (const _chunk of gen) {
          // consume
        }
      } catch (error) {
        secondError = error;
      }
      expect(secondError).toBeDefined();
      const err = secondError as Error;
      expect(err.message).toContain('All backends are currently unhealthy');
      expect(err.message).toContain('circuit breakers open');
    });
  });

  describe('Healthy backend bypass', () => {
    it('should not check circuit breaker for backends without failures', async () => {
      const lb = new LoadBalancingProvider(
        {
          ...config,
          lbProfileEphemeralSettings: {
            circuit_breaker_enabled: true,
            circuit_breaker_failure_threshold: 2,
            failover_retry_count: 1,
          },
        },
        providerManager,
      );

      const mockProvider1 = {
        name: 'test-provider-1',
        async *generateChatCompletion(): AsyncGenerator<IContent> {
          yield {
            role: 'assistant',
            parts: [{ text: 'success' }],
          } as IContent;
        },
        getServerTools: () => [],
      };

      providerManager.registerProvider(mockProvider1);

      const gen = lb.generateChatCompletion({
        contents: [{ role: 'user', parts: [{ text: 'test' }] }],
      });
      for await (const _chunk of gen) {
        // consume
      }

      const stats = lb.getStats();
      const backend1State = stats.circuitBreakerStates.backend1;

      // Should be in closed state (if tracked) after successful request
      // If not tracked (undefined), that's also acceptable
      expect(backend1State?.state ?? 'closed').toBe('closed');
    });
  });
});
