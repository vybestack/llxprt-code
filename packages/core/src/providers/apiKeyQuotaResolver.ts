/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { DebugLogger } from '../debug/index.js';
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
 * Safely match a hostname against a known domain.
 * Returns true if the hostname is exactly the domain or a subdomain of it.
 */
function hostnameMatches(hostname: string, domain: string): boolean {
  return hostname === domain || hostname.endsWith(`.${domain}`);
}

/**
 * Identifies the API-key-based provider from a base URL string.
 * Uses safe hostname parsing to prevent misclassification.
 * Returns null if the URL doesn't match a known provider.
 */
export function detectApiKeyProvider(
  baseUrl: string | undefined,
): 'zai' | 'synthetic' | 'chutes' | 'kimi' | null {
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

/**
 * Fetch and format quota information for an API-key-based provider.
 *
 * @param provider - The detected provider name
 * @param apiKey - The API key to use for the request
 * @param baseUrl - The base URL (used by some providers to derive endpoint)
 * @returns Formatted lines, or null if the fetch failed
 */
export async function fetchApiKeyQuota(
  provider: string,
  apiKey: string,
  baseUrl?: string,
): Promise<ApiKeyQuotaResult | null> {
  if (!apiKey || typeof apiKey !== 'string') {
    logger.debug(() => `No API key available for ${provider}`);
    return null;
  }

  try {
    switch (provider) {
      case 'zai': {
        const usage = await fetchZaiUsage(apiKey, baseUrl);
        if (!usage) return null;
        return { provider: 'Z.ai', lines: formatZaiUsage(usage) };
      }

      case 'synthetic': {
        const usage = await fetchSyntheticUsage(apiKey);
        if (!usage) return null;
        return { provider: 'Synthetic', lines: formatSyntheticUsage(usage) };
      }

      case 'chutes': {
        const usage = await fetchChutesUsage(apiKey);
        if (!usage) return null;
        return { provider: 'Chutes', lines: formatChutesUsage(usage) };
      }

      case 'kimi': {
        if (apiKey.startsWith('sk-kimi-')) {
          const usage = await fetchKimiCodeUsage(apiKey, baseUrl);
          if (!usage) return null;
          return { provider: 'Kimi Code', lines: formatKimiCodeUsage(usage) };
        }

        const usage = await fetchKimiUsage(apiKey, baseUrl);
        if (!usage) return null;
        return { provider: 'Kimi', lines: formatKimiUsage(usage) };
      }

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
