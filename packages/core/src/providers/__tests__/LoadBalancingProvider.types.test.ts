/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Phase 1: Types and Interfaces Tests
 * Issue #489 - Advanced Failover with Metrics
 */

import { describe, it, expect } from 'vitest';
import type {
  BackendMetrics,
  CircuitBreakerState,
  ExtendedLoadBalancerStats,
} from '../LoadBalancingProvider.js';

describe('LoadBalancingProvider Types - Phase 1', () => {
  describe('BackendMetrics interface', () => {
    it('should have all required fields with correct types', () => {
      const metrics: BackendMetrics = {
        requests: 10,
        successes: 8,
        failures: 2,
        timeouts: 1,
        tokens: 5000,
        totalLatencyMs: 15000,
        avgLatencyMs: 1500,
      };

      expect(metrics.requests).toBe(10);
      expect(metrics.successes).toBe(8);
      expect(metrics.failures).toBe(2);
      expect(metrics.timeouts).toBe(1);
      expect(metrics.tokens).toBe(5000);
      expect(metrics.totalLatencyMs).toBe(15000);
      expect(metrics.avgLatencyMs).toBe(1500);
    });

    it('should accept zero values for all fields', () => {
      const metrics: BackendMetrics = {
        requests: 0,
        successes: 0,
        failures: 0,
        timeouts: 0,
        tokens: 0,
        totalLatencyMs: 0,
        avgLatencyMs: 0,
      };

      expect(metrics.requests).toBe(0);
      expect(metrics.avgLatencyMs).toBe(0);
    });
  });

  describe('CircuitBreakerState interface', () => {
    it('should support closed state with empty failures', () => {
      const state: CircuitBreakerState = {
        state: 'closed',
        failures: [],
      };

      expect(state.state).toBe('closed');
      expect(state.failures).toHaveLength(0);
      expect(state.openedAt).toBeUndefined();
      expect(state.lastAttempt).toBeUndefined();
    });

    it('should support open state with failures and timestamp', () => {
      const now = Date.now();
      const state: CircuitBreakerState = {
        state: 'open',
        failures: [
          { timestamp: now - 1000, error: new Error('First failure') },
          { timestamp: now, error: new Error('Second failure') },
        ],
        openedAt: now,
      };

      expect(state.state).toBe('open');
      expect(state.failures).toHaveLength(2);
      expect(state.openedAt).toBe(now);
    });

    it('should support half-open state with lastAttempt', () => {
      const now = Date.now();
      const state: CircuitBreakerState = {
        state: 'half-open',
        failures: [],
        openedAt: now - 30000,
        lastAttempt: now,
      };

      expect(state.state).toBe('half-open');
      expect(state.lastAttempt).toBe(now);
    });

    it('should store error objects in failures array', () => {
      const error1 = new Error('Network timeout');
      const error2 = new Error('Service unavailable');
      const state: CircuitBreakerState = {
        state: 'open',
        failures: [
          { timestamp: Date.now() - 1000, error: error1 },
          { timestamp: Date.now(), error: error2 },
        ],
      };

      expect(state.failures[0].error.message).toBe('Network timeout');
      expect(state.failures[1].error.message).toBe('Service unavailable');
    });
  });

  describe('ExtendedLoadBalancerStats interface', () => {
    it('should extend LoadBalancerStats with new fields', () => {
      const stats: ExtendedLoadBalancerStats = {
        // Base LoadBalancerStats fields
        profileName: 'test-lb',
        totalRequests: 100,
        lastSelected: 'backend1',
        profileCounts: {
          backend1: 60,
          backend2: 40,
        },
        // Extended fields
        backendMetrics: {
          backend1: {
            requests: 60,
            successes: 58,
            failures: 2,
            timeouts: 1,
            tokens: 30000,
            totalLatencyMs: 90000,
            avgLatencyMs: 1500,
          },
          backend2: {
            requests: 40,
            successes: 39,
            failures: 1,
            timeouts: 0,
            tokens: 20000,
            totalLatencyMs: 40000,
            avgLatencyMs: 1000,
          },
        },
        circuitBreakerStates: {
          backend1: {
            state: 'closed',
            failures: [],
          },
          backend2: {
            state: 'closed',
            failures: [],
          },
        },
        currentTPM: {
          backend1: 6000,
          backend2: 4000,
        },
      };

      expect(stats.profileName).toBe('test-lb');
      expect(stats.totalRequests).toBe(100);
      expect(stats.backendMetrics.backend1.requests).toBe(60);
      expect(stats.circuitBreakerStates.backend1.state).toBe('closed');
      expect(stats.currentTPM.backend1).toBe(6000);
    });

    it('should handle empty backend metrics', () => {
      const stats: ExtendedLoadBalancerStats = {
        profileName: 'empty-lb',
        totalRequests: 0,
        lastSelected: null,
        profileCounts: {},
        backendMetrics: {},
        circuitBreakerStates: {},
        currentTPM: {},
      };

      expect(stats.backendMetrics).toEqual({});
      expect(stats.circuitBreakerStates).toEqual({});
      expect(stats.currentTPM).toEqual({});
    });

    it('should handle multiple backends with different states', () => {
      const stats: ExtendedLoadBalancerStats = {
        profileName: 'multi-lb',
        totalRequests: 50,
        lastSelected: 'backend3',
        profileCounts: {
          backend1: 20,
          backend2: 15,
          backend3: 15,
        },
        backendMetrics: {
          backend1: {
            requests: 20,
            successes: 20,
            failures: 0,
            timeouts: 0,
            tokens: 10000,
            totalLatencyMs: 20000,
            avgLatencyMs: 1000,
          },
          backend2: {
            requests: 15,
            successes: 12,
            failures: 3,
            timeouts: 1,
            tokens: 6000,
            totalLatencyMs: 18000,
            avgLatencyMs: 1200,
          },
          backend3: {
            requests: 15,
            successes: 15,
            failures: 0,
            timeouts: 0,
            tokens: 7500,
            totalLatencyMs: 15000,
            avgLatencyMs: 1000,
          },
        },
        circuitBreakerStates: {
          backend1: {
            state: 'closed',
            failures: [],
          },
          backend2: {
            state: 'open',
            failures: [
              { timestamp: Date.now() - 5000, error: new Error('Failed') },
              { timestamp: Date.now() - 3000, error: new Error('Failed') },
              { timestamp: Date.now() - 1000, error: new Error('Failed') },
            ],
            openedAt: Date.now() - 1000,
          },
          backend3: {
            state: 'closed',
            failures: [],
          },
        },
        currentTPM: {
          backend1: 2000,
          backend2: 1200,
          backend3: 1500,
        },
      };

      expect(stats.circuitBreakerStates.backend2.state).toBe('open');
      expect(stats.circuitBreakerStates.backend2.failures).toHaveLength(3);
    });
  });

  describe('Type validation', () => {
    it('should enforce number types for metrics', () => {
      const metrics: BackendMetrics = {
        requests: 5,
        successes: 4,
        failures: 1,
        timeouts: 0,
        tokens: 2500,
        totalLatencyMs: 7500,
        avgLatencyMs: 1500,
      };

      expect(typeof metrics.requests).toBe('number');
      expect(typeof metrics.tokens).toBe('number');
      expect(typeof metrics.avgLatencyMs).toBe('number');
    });

    it('should enforce string literal types for circuit breaker state', () => {
      const states: Array<CircuitBreakerState['state']> = [
        'closed',
        'open',
        'half-open',
      ];

      expect(states).toContain('closed');
      expect(states).toContain('open');
      expect(states).toContain('half-open');
    });

    it('should enforce Record types for stat collections', () => {
      const backendMetrics: Record<string, BackendMetrics> = {
        backend1: {
          requests: 10,
          successes: 9,
          failures: 1,
          timeouts: 0,
          tokens: 5000,
          totalLatencyMs: 15000,
          avgLatencyMs: 1500,
        },
      };

      const tpmRecord: Record<string, number> = {
        backend1: 1000,
        backend2: 2000,
      };

      expect(Object.keys(backendMetrics)).toContain('backend1');
      expect(Object.keys(tpmRecord)).toContain('backend1');
    });
  });
});
