/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { RuntimeProvider } from '@vybestack/llxprt-code-core/runtime/contracts/RuntimeProvider.js';
/**
 * Base URL resolution from provider config objects.
 * Extracted from ProviderManager to keep the main file under the lint
 * line budget.
 */

import type { IProvider } from './IProvider.js';

interface UrlConfig {
  baseURL?: string;
  baseUrl?: string;
}

function resolveUrlCandidate(
  config: UrlConfig | undefined,
): string | undefined {
  if (!config) {
    return undefined;
  }
  if (typeof config.baseURL === 'string' && config.baseURL.trim() !== '') {
    return config.baseURL.trim();
  }
  if (typeof config.baseUrl === 'string' && config.baseUrl.trim() !== '') {
    return config.baseUrl.trim();
  }
  return undefined;
}

function getReportedBaseUrl(
  provider: IProvider | RuntimeProvider,
): string | undefined {
  const maybeHasBaseUrl = provider as {
    getBaseURL?: () => string | undefined;
  };
  if (typeof maybeHasBaseUrl.getBaseURL !== 'function') {
    return undefined;
  }

  const reported = maybeHasBaseUrl.getBaseURL();
  return reported && reported.trim() !== '' ? reported.trim() : undefined;
}

/**
 * Walk the provider chain (including wrappers) to find a configured base URL.
 * Checks baseProviderConfig, providerConfig, and getBaseURL() in order.
 */
export function getBaseUrlFromProvider(
  provider: IProvider | RuntimeProvider | undefined,
): string | undefined {
  if (!provider) {
    return undefined;
  }

  const visited = new Set<IProvider | RuntimeProvider>();
  let current: IProvider | RuntimeProvider | undefined = provider;

  while (current !== undefined) {
    if (visited.has(current)) {
      break;
    }
    visited.add(current);

    const baseConfig = (current as { baseProviderConfig?: UrlConfig })
      .baseProviderConfig;
    const baseCandidate = resolveUrlCandidate(baseConfig);
    if (baseCandidate) {
      return baseCandidate;
    }

    const providerConfig = (current as { providerConfig?: UrlConfig })
      .providerConfig;
    const providerCandidate = resolveUrlCandidate(providerConfig);
    if (providerCandidate) {
      return providerCandidate;
    }

    const reportedBaseUrl = getReportedBaseUrl(current);
    if (reportedBaseUrl) {
      return reportedBaseUrl;
    }

    const maybeWrapped = current as { wrappedProvider?: IProvider };
    current = maybeWrapped.wrappedProvider;
  }

  return undefined;
}

/**
 * Normalize a provider base URL by trimming whitespace and handling 'none' keyword.
 * Returns undefined for empty/none URLs.
 */
export function normalizeProviderBaseUrl(
  baseUrl?: string | null,
): string | undefined {
  if (!baseUrl) {
    return undefined;
  }
  const trimmed = baseUrl.trim();
  if (!trimmed || trimmed.toLowerCase() === 'none') {
    return undefined;
  }
  return trimmed;
}

function isInspectableProvider(
  provider: unknown,
): provider is Record<string, unknown> {
  return (
    (typeof provider === 'object' || typeof provider === 'function') &&
    provider !== null
  );
}

function extractWrappedProviderBaseUrl(
  provider: Record<string, unknown>,
  visited: Set<unknown>,
): string | undefined {
  const wrappedProvider = (provider as { wrappedProvider?: unknown })
    .wrappedProvider;
  if (wrappedProvider == null) {
    return undefined;
  }
  return extractProviderBaseUrl(wrappedProvider, visited);
}

function extractDirectProviderBaseUrl(
  provider: Record<string, unknown>,
): string | undefined {
  return normalizeProviderBaseUrl(
    (provider as { baseURL?: string | null }).baseURL,
  );
}

function extractConfiguredProviderBaseUrl(
  provider: Record<string, unknown>,
): string | undefined {
  const configCandidate = (
    provider as { providerConfig?: { baseURL?: string } }
  ).providerConfig;
  if (!configCandidate) {
    return undefined;
  }
  return normalizeProviderBaseUrl(configCandidate.baseURL);
}

function extractBaseProviderConfigUrl(
  provider: Record<string, unknown>,
): string | undefined {
  const baseProviderConfig = (
    provider as { baseProviderConfig?: { baseURL?: string } }
  ).baseProviderConfig;
  if (!baseProviderConfig) {
    return undefined;
  }
  return normalizeProviderBaseUrl(baseProviderConfig.baseURL);
}

function extractProviderGetBaseUrl(
  provider: Record<string, unknown>,
): string | undefined {
  const getter = (provider as { getBaseURL?: () => string | undefined })
    .getBaseURL;
  if (typeof getter !== 'function') {
    return undefined;
  }
  return normalizeProviderBaseUrl(getter.call(provider));
}

/**
 * Extract base URL from a provider object by checking the canonical baseURL
 * field on the provider, its providerConfig/baseProviderConfig containers,
 * and the getBaseURL() accessor, following wrapped providers. Provider
 * objects are LLxprt-owned IProvider instances; legacy spellings are
 * migrated at settings load and never appear here (issue #2533).
 */
export function extractProviderBaseUrl(
  provider: unknown,
  visited = new Set<unknown>(),
): string | undefined {
  if (!isInspectableProvider(provider) || visited.has(provider)) {
    return undefined;
  }
  visited.add(provider);

  for (const extractor of [
    () => extractWrappedProviderBaseUrl(provider, visited),
    () => extractDirectProviderBaseUrl(provider),
    () => extractConfiguredProviderBaseUrl(provider),
    () => extractBaseProviderConfigUrl(provider),
    () => extractProviderGetBaseUrl(provider),
  ]) {
    const baseUrl = extractor();
    if (baseUrl !== undefined) {
      return baseUrl;
    }
  }

  return undefined;
}
