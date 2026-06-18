/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan PLAN-20251212issue489 - Phase 2
 * Circuit breaker state management for load-balancer backends.
 * Extracted from LoadBalancingProvider to keep each unit under the lint budget.
 */

import type { DebugLogger } from '@vybestack/llxprt-code-core/debug/DebugLogger.js';
import type { CircuitBreakerState } from '../LoadBalancingProvider.js';
import type { FailoverSettings } from '../LoadBalancingProvider.js';

export class CircuitBreakerManager {
  constructor(
    private readonly states: Map<string, CircuitBreakerState>,
    private readonly logger: DebugLogger,
    private readonly getFailoverSettings: () => FailoverSettings,
  ) {}

  static createInitialState(): CircuitBreakerState {
    return {
      state: 'closed',
      failures: [],
    };
  }

  isBackendHealthy(profileName: string): boolean {
    const settings = this.getFailoverSettings();
    if (!settings.circuitBreakerEnabled) {
      return true;
    }

    const state = this.states.get(profileName);
    if (!state || state.state === 'closed') {
      return true;
    }

    if (state.state === 'open') {
      return this.maybeEnterHalfOpen(state, profileName, settings);
    }

    // half-open: allow one attempt
    return true;
  }

  recordBackendSuccess(profileName: string): void {
    const state = this.states.get(profileName);
    if (state && state.state === 'half-open') {
      state.state = 'closed';
      state.failures = [];
      this.logger.debug(() => `[circuit-breaker] ${profileName}: Recovered`);
    }
  }

  recordBackendFailure(profileName: string, error: Error): void {
    const settings = this.getFailoverSettings();
    if (settings.circuitBreakerEnabled !== true) {
      return;
    }

    let state = this.states.get(profileName);
    if (state === undefined) {
      state = CircuitBreakerManager.createInitialState();
      this.states.set(profileName, state);
    }

    const now = Date.now();
    state.failures.push({ timestamp: now, error });

    // Prune old failures outside window
    state.failures = state.failures.filter(
      (f) => now - f.timestamp < settings.circuitBreakerFailureWindowMs,
    );

    // Check if threshold exceeded
    if (state.failures.length >= settings.circuitBreakerFailureThreshold) {
      state.state = 'open';
      state.openedAt = now;
      this.logger.debug(
        () =>
          `[circuit-breaker] ${profileName}: Marked unhealthy (${state.failures.length} failures in window)`,
      );
    }
  }

  private maybeEnterHalfOpen(
    state: CircuitBreakerState,
    profileName: string,
    settings: FailoverSettings,
  ): boolean {
    const now = Date.now();
    const recoveryTimeout = settings.circuitBreakerRecoveryTimeoutMs;
    // Use explicit undefined check to avoid different-types-comparison
    const openedAtRuntime: unknown = state.openedAt;
    if (
      typeof openedAtRuntime === 'number' &&
      now - openedAtRuntime >= recoveryTimeout
    ) {
      state.state = 'half-open';
      state.lastAttempt = now;
      this.logger.debug(
        () => `[circuit-breaker] ${profileName}: Testing recovery`,
      );
      return true;
    }
    return false;
  }
}
