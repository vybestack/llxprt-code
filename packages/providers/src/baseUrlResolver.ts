/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

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

function getReportedBaseUrl(provider: IProvider): string | undefined {
  const maybeHasBaseUrl = provider as {
    getBaseURL?: () => string | undefined;
  };
  if (typeof maybeHasBaseUrl.getBaseURL !== 'function') {
    return undefined;
  }

  try {
    const reported = maybeHasBaseUrl.getBaseURL();
    return reported && reported.trim() !== '' ? reported.trim() : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Walk the provider chain (including wrappers) to find a configured base URL.
 * Checks baseProviderConfig, providerConfig, and getBaseURL() in order.
 */
export function getBaseUrlFromProvider(
  provider: IProvider | undefined,
): string | undefined {
  if (!provider) {
    return undefined;
  }

  const visited = new Set<IProvider>();
  let current: IProvider | undefined = provider;

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
