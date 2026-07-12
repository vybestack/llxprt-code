/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';
import { fetchZaiUsage, formatZaiUsage } from './zai/usageInfo.js';
import {
  fetchSyntheticUsage,
  formatSyntheticUsage,
} from './synthetic/usageInfo.js';
import { fetchChutesUsage, formatChutesUsage } from './chutes/usageInfo.js';
import {
  fetchKimiUsage,
  formatKimiUsage,
  fetchKimiCodeUsage,
  formatKimiCodeUsage,
} from './kimi/usageInfo.js';

const logger = new DebugLogger('llxprt:quota:apikey');

/**
 * Shared type for API-key-based quota providers.
 */
export type ApiKeyQuotaProvider = 'zai' | 'synthetic' | 'chutes' | 'kimi';

/**
 * Map of provider names to their canonical quota provider type.
 * Includes primary names and aliases.
 */
export const API_KEY_PROVIDER_NAME_MAP: Readonly<
  Record<string, ApiKeyQuotaProvider>
> = {
  kimi: 'kimi',
  synthetic: 'synthetic',
  chutes: 'chutes',
  'chutes-ai': 'chutes',
  zai: 'zai',
};

/**
 * Safely match a hostname against a known domain.
 * Returns true if the hostname is exactly the domain or a subdomain of it.
 */
function hostnameMatches(hostname: string, domain: string): boolean {
  return hostname === domain || hostname.endsWith(`.${domain}`);
}

/**
 * Identifies the API-key-based provider from a provider name.
 * Returns null if the name doesn't match a known provider.
 */
export function detectApiKeyProviderFromName(
  providerName: string | undefined,
): ApiKeyQuotaProvider | null {
  if (!providerName || typeof providerName !== 'string') {
    return null;
  }

  const normalized = providerName.trim().toLowerCase();
  if (normalized === '') {
    return null;
  }

  return API_KEY_PROVIDER_NAME_MAP[normalized] ?? null;
}

/**
 * Identifies the API-key-based provider from a base URL string.
 * Uses safe hostname parsing to prevent misclassification.
 * Returns null if the URL doesn't match a known provider.
 */
export function detectApiKeyProvider(
  baseUrl: string | undefined,
): ApiKeyQuotaProvider | null {
  if (!baseUrl || typeof baseUrl !== 'string') {
    return null;
  }

  let hostname: string;
  try {
    hostname = new URL(baseUrl).hostname.toLowerCase();
  } catch {
    return null;
  }

  if (hostnameMatches(hostname, 'z.ai')) {
    return 'zai';
  }
  if (hostnameMatches(hostname, 'synthetic.new')) {
    return 'synthetic';
  }
  if (hostnameMatches(hostname, 'chutes.ai')) {
    return 'chutes';
  }
  if (
    hostnameMatches(hostname, 'kimi.com') ||
    hostnameMatches(hostname, 'moonshot.ai') ||
    hostnameMatches(hostname, 'moonshot.cn')
  ) {
    return 'kimi';
  }

  return null;
}

/**
 * Result from fetching API key provider quota
 */
export interface ApiKeyQuotaResult {
  provider: string;
  lines: string[];
}

export interface ApiKeyQuotaDependencies {
  fetchZaiUsage: typeof fetchZaiUsage;
  formatZaiUsage: typeof formatZaiUsage;
  fetchSyntheticUsage: typeof fetchSyntheticUsage;
  formatSyntheticUsage: typeof formatSyntheticUsage;
  fetchChutesUsage: typeof fetchChutesUsage;
  formatChutesUsage: typeof formatChutesUsage;
  fetchKimiUsage: typeof fetchKimiUsage;
  formatKimiUsage: typeof formatKimiUsage;
  fetchKimiCodeUsage: typeof fetchKimiCodeUsage;
  formatKimiCodeUsage: typeof formatKimiCodeUsage;
}

const defaultDependencies: ApiKeyQuotaDependencies = {
  fetchZaiUsage,
  formatZaiUsage,
  fetchSyntheticUsage,
  formatSyntheticUsage,
  fetchChutesUsage,
  formatChutesUsage,
  fetchKimiUsage,
  formatKimiUsage,
  fetchKimiCodeUsage,
  formatKimiCodeUsage,
};

/**
 * Fetch and format quota information for an API-key-based provider.
 *
 * @param provider - The detected provider name
 * @param apiKey - The API key to use for the request
 * @param baseUrl - The base URL (used by some providers to derive endpoint)
 * @returns Formatted lines, or null if the fetch failed
 */
export async function fetchApiKeyQuota(
  provider: ApiKeyQuotaProvider,
  apiKey: string,
  baseUrl?: string,
  dependencies: ApiKeyQuotaDependencies = defaultDependencies,
): Promise<ApiKeyQuotaResult | null> {
  if (!apiKey || typeof apiKey !== 'string') {
    logger.debug(() => `No API key available for ${provider}`);
    return null;
  }

  try {
    switch (provider) {
      case 'zai': {
        const usage = await dependencies.fetchZaiUsage(apiKey, baseUrl);
        if (!usage) return null;
        return { provider: 'Z.ai', lines: dependencies.formatZaiUsage(usage) };
      }

      case 'synthetic': {
        const usage = await dependencies.fetchSyntheticUsage(apiKey);
        if (!usage) return null;
        return {
          provider: 'Synthetic',
          lines: dependencies.formatSyntheticUsage(usage),
        };
      }

      case 'chutes': {
        const usage = await dependencies.fetchChutesUsage(apiKey);
        if (!usage) return null;
        return {
          provider: 'Chutes',
          lines: dependencies.formatChutesUsage(usage),
        };
      }

      case 'kimi':
        return await fetchKimiQuota(apiKey, baseUrl, dependencies);

      default:
        logger.debug(() => `Unknown API key provider: ${provider}`);
        return null;
    }
  } catch (error) {
    logger.debug(
      () =>
        `Error fetching quota for ${provider}: ${
          error instanceof Error ? error.message : String(error)
        }`,
    );
    return null;
  }
}

/**
 * Helper function to fetch Kimi quota information.
 * Handles the distinction between Kimi Code and regular Kimi API keys.
 */
async function fetchKimiQuota(
  apiKey: string,
  baseUrl?: string,
  dependencies: ApiKeyQuotaDependencies = defaultDependencies,
): Promise<ApiKeyQuotaResult | null> {
  if (apiKey.startsWith('sk-kimi-')) {
    const usage = await dependencies.fetchKimiCodeUsage(apiKey, baseUrl);
    if (!usage) return null;
    return {
      provider: 'Kimi Code',
      lines: dependencies.formatKimiCodeUsage(usage),
    };
  }

  const usage = await dependencies.fetchKimiUsage(apiKey, baseUrl);
  if (!usage) return null;
  return { provider: 'Kimi', lines: dependencies.formatKimiUsage(usage) };
}
