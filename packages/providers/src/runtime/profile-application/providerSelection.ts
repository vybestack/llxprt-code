/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
export interface ProviderSelectionResult {
  providerName: string;
  warnings: string[];
  /**
   * Always false since issue #2479: a named-but-unavailable provider now
   * throws instead of silently falling back, so no success path sets this to
   * true anymore. Retained for API stability (threaded through
   * ProfileApplicationResult and profileSnapshot consumers).
   */
  didFallback: boolean;

  requestedProvider: string | null;
}

/**
 * @plan PLAN-20251020-STATELESSPROVIDER3.P09
 * @requirement REQ-SP3-002
 * @pseudocode profile-application.md lines 1-22
 */
export function selectAvailableProvider(
  requestedProvider: string | null | undefined,
  availableProviders: readonly string[],
): ProviderSelectionResult {
  const trimmedRequested =
    typeof requestedProvider === 'string' ? requestedProvider.trim() : '';

  const warnings: string[] = [];

  if (trimmedRequested && availableProviders.includes(trimmedRequested)) {
    return {
      providerName: trimmedRequested,
      warnings,
      didFallback: false,
      requestedProvider: trimmedRequested,
    };
  }

  if (availableProviders.length === 0) {
    throw new Error(
      'No registered providers are available to apply the requested profile.',
    );
  }

  if (trimmedRequested) {
    // A profile that explicitly names a provider must never be silently
    // rerouted to a different provider (issue #2479: a corrupt profile
    // naming an unregistered provider landed the session on gemini with
    // no error, swallowing all subsequent input). Fail loudly instead.
    throw new Error(
      `Provider '${trimmedRequested}' is not available (registered providers: ${availableProviders.join(
        ', ',
      )}). Profile not applied.`,
    );
  }

  const fallbackProvider = availableProviders[0];
  return {
    providerName: fallbackProvider,
    warnings,
    didFallback: false,
    requestedProvider: null,
  };
}
