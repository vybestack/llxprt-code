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
export async function getAnthropicUsageInfo(
  tokenStore: TokenStore,
  bucket?: string,
): Promise<Record<string, unknown> | null> {
  const bucketToUse = bucket ?? 'default';
  const token = await tokenStore.getToken('anthropic', bucketToUse);

  if (!token) {
    return null;
  }

  try {
    const { fetchAnthropicUsage } = await import(
      '@vybestack/llxprt-code-providers'
    );
    return await fetchAnthropicUsage(token.access_token);
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

function isUsageRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

async function fetchAndStoreGeminiQuota(
  bucket: string,
  accessToken: string,
  fetchFn: (token: string) => Promise<unknown>,
  result: Map<string, Record<string, unknown>>,
  logger: DebugLogger,
): Promise<void> {
  try {
    const quotaInfo = await fetchFn(accessToken);
    if (isUsageRecord(quotaInfo)) {
      result.set(bucket, quotaInfo);
    }
  } catch (error) {
    logger.debug(`Error fetching Gemini quota for bucket ${bucket}:`, error);
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
): Promise<Map<string, Record<string, unknown>>> {
  const result = new Map<string, Record<string, unknown>>();

  const buckets = await tokenStore.listBuckets('anthropic');
  const bucketsToCheck = buckets.length > 0 ? buckets : ['default'];

  const { fetchAnthropicUsage } = await import(
    '@vybestack/llxprt-code-providers'
  );

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
        fetchAnthropicUsage,
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
): Promise<Map<string, Record<string, unknown>>> {
  const result = new Map<string, Record<string, unknown>>();

  const buckets = await tokenStore.listBuckets('codex');
  const bucketsToCheck = buckets.length > 0 ? buckets : ['default'];

  const { fetchCodexUsage } = await import('@vybestack/llxprt-code-providers');

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
        fetchCodexUsage,
        result,
        logger,
      );
    }
  }

  return result;
}

/**
 * Get Gemini quota information for all authenticated buckets.
 * Uses the CodeAssist retrieveUserQuota API via direct HTTP calls.
 * Returns a map of bucket name to quota response.
 *
 * @param tokenStore - Token store to read from
 */
export async function getAllGeminiUsageInfo(
  tokenStore: TokenStore,
): Promise<Map<string, Record<string, unknown>>> {
  const result = new Map<string, Record<string, unknown>>();

  const buckets = await tokenStore.listBuckets('gemini');
  const bucketsToCheck = buckets.length > 0 ? buckets : ['default'];

  const { fetchGeminiQuota } = await import('@vybestack/llxprt-code-providers');

  for (const bucket of bucketsToCheck) {
    const token = await tokenStore.getToken('gemini', bucket);
    if (!token) {
      continue;
    }

    const nowInSeconds = Math.floor(Date.now() / 1000);
    if (token.expiry > nowInSeconds) {
      await fetchAndStoreGeminiQuota(
        bucket,
        token.access_token,
        fetchGeminiQuota,
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
): Promise<string | null> {
  if (!settings) {
    return null;
  }

  try {
    const settingsService = getRuntimeSettingsService();
    const authOnly = isAuthOnlyEnabled(settingsService.get('authOnly'));
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

  if (providerName === 'qwen') {
    const openaiBaseUrl = settings.getProviderBaseUrl('openai');
    if (openaiBaseUrl && !isQwenCompatibleUrl(openaiBaseUrl)) {
      return 'OpenAI BaseURL Mismatch';
    }
  }

  return null;
}

/**
 * Check if a URL is compatible with Qwen OAuth.
 * Returns true if the URL is a known Qwen/Aliyun domain or if no URL is provided.
 *
 * @param url - The base URL to check
 */
export function isQwenCompatibleUrl(url: string): boolean {
  if (!url) return true;

  const qwenDomains = ['dashscope.aliyuncs.com', 'qwen.com'];

  try {
    const urlObj = new URL(url);
    return qwenDomains.some(
      (domain) =>
        urlObj.hostname === domain || urlObj.hostname.endsWith(`.${domain}`),
    );
  } catch {
    return false;
  }
}
