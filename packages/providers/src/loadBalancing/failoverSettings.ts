/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan PLAN-20251212issue488
 * @plan PLAN-20251212issue489
 * Failover settings extraction and error classification for load-balancer
 * backends. Extracted from LoadBalancingProvider.
 */

import {
  isNetworkTransientError,
  getErrorStatus,
} from '@vybestack/llxprt-code-core/utils/retry.js';
import type { FailoverSettings } from '../LoadBalancingProvider.js';

/**
 * Extract failover settings from ephemeral settings, applying defaults.
 */
export function extractFailoverSettings(
  ephemeral: Record<string, unknown> | undefined,
): FailoverSettings {
  const settings = ephemeral ?? {};
  return {
    retryCount: Math.min(
      typeof settings.failover_retry_count === 'number'
        ? settings.failover_retry_count
        : 1,
      100,
    ),
    retryDelayMs:
      typeof settings.failover_retry_delay_ms === 'number'
        ? settings.failover_retry_delay_ms
        : 0,
    failoverOnNetworkErrors: settings.failover_on_network_errors !== false,
    failoverStatusCodes: Array.isArray(settings.failover_status_codes)
      ? settings.failover_status_codes.filter(
          (n): n is number => typeof n === 'number',
        )
      : undefined,
    // Advanced failover settings (Phase 3, Issue #489)
    tpmThreshold:
      typeof settings.tpm_threshold === 'number'
        ? settings.tpm_threshold
        : undefined,
    timeoutMs:
      typeof settings.timeout_ms === 'number' ? settings.timeout_ms : undefined,
    circuitBreakerEnabled: settings.circuit_breaker_enabled === true,
    circuitBreakerFailureThreshold:
      typeof settings.circuit_breaker_failure_threshold === 'number'
        ? settings.circuit_breaker_failure_threshold
        : 3,
    circuitBreakerFailureWindowMs:
      typeof settings.circuit_breaker_failure_window_ms === 'number'
        ? settings.circuit_breaker_failure_window_ms
        : 60000,
    circuitBreakerRecoveryTimeoutMs:
      typeof settings.circuit_breaker_recovery_timeout_ms === 'number'
        ? settings.circuit_breaker_recovery_timeout_ms
        : 30000,
  };
}

/**
 * Determine if an error should trigger failover to the next backend.
 */
export function shouldFailover(
  error: unknown,
  settings: FailoverSettings,
): boolean {
  if (!(error instanceof Error)) {
    return true;
  }

  if (settings.failoverOnNetworkErrors && isNetworkTransientError(error)) {
    return true;
  }

  const status = getErrorStatus(error);
  if (status !== undefined) {
    if (settings.failoverStatusCodes) {
      return settings.failoverStatusCodes.includes(status);
    }
    return status === 429 || (status >= 500 && status < 600);
  }

  return true;
}

/**
 * Check if an error should trigger immediate failover (no retry).
 *
 * These status codes indicate the backend cannot serve requests
 * and retrying would be futile:
 * - 429: Rate limited
 * - 401: Unauthorized (per Issue #902 spec; OAuth bucket failover has
 *        separate auto-renew logic that doesn't apply to load balancer)
 * - 402: Payment required
 * - 403: Forbidden
 */
export function isImmediateFailoverError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  const status = getErrorStatus(error);
  if (status === undefined) {
    return false;
  }
  return status === 429 || status === 401 || status === 402 || status === 403;
}
