/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan:PLAN-20260603-ISSUE1584.P12
 * @requirement:REQ-API-001
 * @pseudocode consumer-migration.md lines 10-15
 */

/**
 * Provider usage and auth-priority query functions.
 * These are pure functions that receive dependencies as parameters,
 * with no coupling to OAuthManager internals.
 */

import { DebugLogger, type Config } from '@vybestack/llxprt-code-core';
import { getRuntimeSettingsService } from '@vybestack/llxprt-code-core/runtime/settingsRuntimeAdapter.js';
import type { IOAuthSettingsProvider } from '@vybestack/llxprt-code-auth';
import type { TokenStore } from './types.js';
import { isAuthOnlyEnabled } from './auth-utils.js';

const logger = new DebugLogger('llxprt:oauth:provider-usage');

/**
 * Get Anthropic usage information from OAuth endpoint for a specific bucket.
 * Returns full usage data for Claude Code/Max plans.
 * Only works with OAuth tokens (sk-ant-oat01-...), not API keys.
 *
 * @param tokenStore - Token store to read from
 * @param bucket - Bucket to fetch usage for (required; caller resolves default)
 */
export type FetchAnthropicUsage = (
  token: string,
) => Promise<Record<string, unknown> | null>;
export type FetchCodexUsage = (
  token: string,
  accountId: string,
  baseUrl?: string,
) => Promise<Record<string, unknown> | null>;

async function defaultFetchAnthropicUsage(
  token: string,
): Promise<Record<string, unknown> | null> {
  const { fetchAnthropicUsage } = await import(
    '@vybestack/llxprt-code-providers'
  );
  return fetchAnthropicUsage(token);
}

export async function getAnthropicUsageInfo(
  tokenStore: TokenStore,
  bucket?: string,
  fetchUsage: FetchAnthropicUsage = defaultFetchAnthropicUsage,
): Promise<Record<string, unknown> | null> {
  const bucketToUse = bucket ?? 'default';
  const token = await tokenStore.getToken('anthropic', bucketToUse);

  if (!token) {
    return null;
  }

  try {
    return await fetchUsage(token.access_token);
  } catch (error) {
    logger.debug(
      `Error fetching Anthropic usage info for bucket ${bucketToUse}:`,
      error,
    );
    return null;
  }
}

async function fetchAndStoreAnthropicUsage(
  bucket: string,
  accessToken: string,
  fetchFn: (
    token: string,
  ) => Promise<Record<string, unknown> | null | undefined>,
  result: Map<string, Record<string, unknown>>,
  logger: DebugLogger,
): Promise<void> {
  try {
    const usageInfo = await fetchFn(accessToken);
    if (usageInfo) {
      result.set(bucket, usageInfo);
    }
  } catch (error) {
    logger.debug(
      `Error fetching Anthropic usage info for bucket ${bucket}:`,
      error,
    );
  }
}

async function fetchAndStoreCodexUsage(
  bucket: string,
  accessToken: string,
  accountId: string,
  codexBaseUrl: string | undefined,
  fetchFn: (
    token: string,
    accountId: string,
    baseUrl?: string,
  ) => Promise<Record<string, unknown> | null | undefined>,
  result: Map<string, Record<string, unknown>>,
  logger: DebugLogger,
): Promise<void> {
  try {
    const usageInfo = await fetchFn(accessToken, accountId, codexBaseUrl);
    if (usageInfo) {
      result.set(bucket, usageInfo);
    }
  } catch (error) {
    logger.debug(
      `Error fetching Codex usage info for bucket ${bucket}:`,
      error,
    );
  }
}

/**
 * Get Anthropic usage information for all authenticated buckets.
 * Returns a map of bucket name to usage info for all buckets that have
 * valid, non-expired OAuth tokens.
 *
 * @param tokenStore - Token store to read from
 */
export async function getAllAnthropicUsageInfo(
  tokenStore: TokenStore,
  fetchUsage: FetchAnthropicUsage = defaultFetchAnthropicUsage,
): Promise<Map<string, Record<string, unknown>>> {
  const result = new Map<string, Record<string, unknown>>();

  const buckets = await tokenStore.listBuckets('anthropic');
  const bucketsToCheck = buckets.length > 0 ? buckets : ['default'];

  for (const bucket of bucketsToCheck) {
    const token = await tokenStore.getToken('anthropic', bucket);
    if (!token) {
      continue;
    }

    const nowInSeconds = Math.floor(Date.now() / 1000);
    if (
      token.expiry > nowInSeconds &&
      token.access_token.startsWith('sk-ant-oat01-')
    ) {
      await fetchAndStoreAnthropicUsage(
        bucket,
        token.access_token,
        fetchUsage,
        result,
        logger,
      );
    }
  }

  return result;
}

/**
 * Get Codex usage information for all authenticated buckets.
 * Returns a map of bucket name to usage info for all buckets that have
 * valid, non-expired OAuth tokens with an account_id field.
 *
 * @param tokenStore - Token store to read from
 * @param config - Optional Config for base-url resolution
 */
export async function getAllCodexUsageInfo(
  tokenStore: TokenStore,
  config?: Config,
  fetchUsage: FetchCodexUsage = async (token, accountId, baseUrl) => {
    const { fetchCodexUsage } = await import(
      '@vybestack/llxprt-code-providers'
    );
    return fetchCodexUsage(token, accountId, baseUrl);
  },
): Promise<Map<string, Record<string, unknown>>> {
  const result = new Map<string, Record<string, unknown>>();

  const buckets = await tokenStore.listBuckets('codex');
  const bucketsToCheck = buckets.length > 0 ? buckets : ['default'];

  for (const bucket of bucketsToCheck) {
    const token = await tokenStore.getToken('codex', bucket);
    if (!token) {
      continue;
    }

    const nowInSeconds = Math.floor(Date.now() / 1000);
    const tokenObj = token as Record<string, unknown>;
    const accountId =
      typeof tokenObj['account_id'] === 'string'
        ? tokenObj['account_id']
        : undefined;

    if (token.expiry > nowInSeconds && accountId) {
      const runtimeBaseUrl = config?.getEphemeralSetting('base-url');
      const codexBaseUrl =
        typeof runtimeBaseUrl === 'string' && runtimeBaseUrl.trim() !== ''
          ? runtimeBaseUrl
          : undefined;
      await fetchAndStoreCodexUsage(
        bucket,
        token.access_token,
        accountId,
        codexBaseUrl,
        fetchUsage,
        result,
        logger,
      );
    }
  }

  return result;
}

/**
 * Check for higher priority authentication methods for a provider.
 * Returns a string describing the higher-priority auth if one exists,
 * null if OAuth is the appropriate auth method to use.
 *
 * @param providerName - Name of the provider to check
 * @param settings - Loaded settings to inspect for API keys / keyfiles / base URLs
 */
export async function getHigherPriorityAuth(
  providerName: string,
  settings: IOAuthSettingsProvider | undefined,
  getAuthOnly: () => unknown = () =>
    getRuntimeSettingsService().get('authOnly'),
): Promise<string | null> {
  if (!settings) {
    return null;
  }

  try {
    const authOnly = isAuthOnlyEnabled(getAuthOnly());
    if (authOnly) {
      return null;
    }
  } catch {
    // SettingsService not registered (subagent/test context) — skip authOnly check
  }

  if (settings.getProviderApiKey(providerName)) {
    return 'API Key';
  }

  if (settings.getProviderKeyfile(providerName)) {
    return 'Keyfile';
  }

  const envKeyName = `${providerName.toUpperCase()}_API_KEY`;
  if (process.env[envKeyName]) {
    return 'Environment Variable';
  }

  return null;
}
