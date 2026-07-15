/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { DebugLogger } from '@vybestack/llxprt-code-core/debug/DebugLogger.js';
import { getErrorStatus } from '@vybestack/llxprt-code-core/utils/retry.js';
import type { GenerateChatOptions } from '../IProvider.js';
import {
  claimProviderErrorObservation,
  classifyProviderError,
  invokeProviderErrorObserver,
  toObservedProviderError,
} from '../providerErrorObservation.js';

export type BackendSkipReason = 'unhealthy' | 'tpm_below_threshold';

export function getBackendSkipReasons(
  profileName: string,
  tpmThreshold: number | undefined,
  isHealthy: (name: string) => boolean,
  shouldSkipOnTPM: (name: string, threshold: number | undefined) => boolean,
): BackendSkipReason[] {
  const unhealthy = !isHealthy(profileName);
  const belowTpmThreshold = shouldSkipOnTPM(profileName, tpmThreshold);
  if (unhealthy && belowTpmThreshold) {
    return ['unhealthy', 'tpm_below_threshold'];
  }
  if (unhealthy) return ['unhealthy'];
  if (belowTpmThreshold) return ['tpm_below_threshold'];
  return [];
}

export function shouldSkipBackend(
  profileName: string,
  tpmThreshold: number | undefined,
  isHealthy: (name: string) => boolean,
  shouldSkipOnTPM: (name: string, threshold: number | undefined) => boolean,
  logger: DebugLogger,
): boolean {
  const reasons = getBackendSkipReasons(
    profileName,
    tpmThreshold,
    isHealthy,
    shouldSkipOnTPM,
  );
  for (const reason of reasons) {
    logger.debug(() =>
      reason === 'unhealthy'
        ? `[LB:failover] Skipping unhealthy backend: ${profileName} (circuit breaker open)`
        : `[LB:failover] Skipping backend: ${profileName} (TPM below threshold)`,
    );
  }
  return reasons.length > 0;
}

export function validateNotAllUnhealthy(
  circuitBreakerEnabled: boolean,
  profileNames: readonly string[],
  canAttemptBackend: (name: string) => boolean,
): void {
  if (
    circuitBreakerEnabled &&
    profileNames.every((name) => !canAttemptBackend(name))
  ) {
    throw new Error(
      'All backends are currently unhealthy (circuit breakers open). Please wait for recovery or check backend configurations.',
    );
  }
}

export function recordBackendFailure(
  errors: Array<{ profile: string; error: Error }>,
  profile: string,
  error: unknown,
): void {
  errors.push({
    profile,
    error: error instanceof Error ? error : new Error(String(error)),
  });
}

export function observeDelegateFailure(
  options: GenerateChatOptions,
  error: unknown,
  logger: DebugLogger,
): void {
  if (!claimProviderErrorObservation(options, error)) return;
  const status = getErrorStatus(error);
  invokeProviderErrorObserver(
    options.onProviderError,
    toObservedProviderError(
      error,
      status,
      classifyProviderError(error, status),
    ),
    (observerError) => {
      logger.debug(
        () => `Provider error observer failed: ${String(observerError)}`,
      );
    },
  );
}
