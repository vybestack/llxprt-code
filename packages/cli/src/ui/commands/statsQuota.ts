/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { getRuntimeApi } from '../contexts/RuntimeContext.js';
import { DebugLogger } from '@vybestack/llxprt-code-core';
import {
  CodexUsageInfoSchema,
  detectApiKeyProvider,
  detectApiKeyProviderFromName,
  fetchApiKeyQuota,
  formatAllUsagePeriods,
  formatCodexUsage,
} from '@vybestack/llxprt-code-providers';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

const logger = new DebugLogger('llxprt:cli:stats');

export type UsageMap = Map<string, Record<string, unknown>>;

type RuntimeApi = ReturnType<typeof getRuntimeApi>;
type OAuthManager = NonNullable<ReturnType<RuntimeApi['getCliOAuthManager']>>;

/** Sort bucket names with 'default' first, then lexicographic. */
export function defaultFirstSort(a: string, b: string): number {
  if (a === 'default') {
    return -1;
  }
  if (b === 'default') {
    return 1;
  }
  return a.localeCompare(b);
}

/**
 * Returns the trimmed URL if it is a non-empty string, otherwise undefined.
 * Empty/whitespace base-url values must fall through so detection continues.
 */
function resolveBaseUrlOrNull(value: string | undefined): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
}

/**
 * Read API key from a keyfile path, handling tilde expansion
 */
async function readKeyFile(filePath: string): Promise<string | null> {
  try {
    const expandedPath = filePath.startsWith('~')
      ? path.join(os.homedir(), filePath.slice(1))
      : filePath;

    const resolvedPath = path.isAbsolute(expandedPath)
      ? expandedPath
      : path.resolve(process.cwd(), expandedPath);

    const content = await fs.readFile(resolvedPath, 'utf-8');
    const key = content.trim();
    return key === '' ? null : key;
  } catch {
    return null;
  }
}

/**
 * Resolve the API key for the current profile.
 * Checks ephemeral settings for auth-keyfile first, then falls back to auth-key.
 */
async function resolveApiKey(runtimeApi: RuntimeApi): Promise<string | null> {
  const keyfilePath = runtimeApi.getEphemeralSetting('auth-keyfile');
  if (typeof keyfilePath === 'string' && keyfilePath.trim() !== '') {
    const key = await readKeyFile(keyfilePath.trim());
    if (key) {
      return key;
    }
  }

  const authKey = runtimeApi.getEphemeralSetting('auth-key');
  if (typeof authKey === 'string' && authKey.trim() !== '') {
    return authKey.trim();
  }

  return null;
}

interface ProviderConfigCandidate {
  readonly providerConfig?: { readonly 'base-url'?: string };
  readonly baseProviderConfig?: { readonly 'base-url'?: string };
}

function detectFromProviderConfig(providerInstance: unknown): {
  provider: string | null;
  baseUrl: string | undefined;
} {
  const candidate = providerInstance as ProviderConfigCandidate;

  const providerConfigUrl = resolveBaseUrlOrNull(
    candidate.providerConfig?.['base-url'],
  );
  if (providerConfigUrl) {
    const detected = detectApiKeyProvider(providerConfigUrl);
    if (detected) {
      logger.debug(() => `Detected ${detected} from provider config base-url`);
      return { provider: detected, baseUrl: providerConfigUrl };
    }
  }

  const baseConfigUrl = resolveBaseUrlOrNull(
    candidate.baseProviderConfig?.['base-url'],
  );
  if (baseConfigUrl) {
    const detected = detectApiKeyProvider(baseConfigUrl);
    if (detected) {
      logger.debug(
        () => `Detected ${detected} from base provider config base-url`,
      );
      return { provider: detected, baseUrl: baseConfigUrl };
    }
  }

  return { provider: null, baseUrl: undefined };
}

/**
 * Attempt to fetch quota for the current profile's API-key-based provider.
 * Returns null if the profile doesn't use a supported API-key provider.
 */
async function fetchApiKeyProviderQuota(
  runtimeApi: RuntimeApi,
): Promise<{ provider: string; lines: string[] } | null> {
  let provider: 'zai' | 'synthetic' | 'chutes' | 'kimi' | null = null;
  let baseUrlForFetch: string | undefined;
  const activeProviderName = runtimeApi.getActiveProviderName();

  // Strategy 1: Check ephemeral base-url setting (highest priority)
  const ephemeralBaseUrl = runtimeApi.getEphemeralSetting('base-url');
  if (typeof ephemeralBaseUrl === 'string') {
    provider = detectApiKeyProvider(ephemeralBaseUrl);
    if (provider) {
      baseUrlForFetch = ephemeralBaseUrl;
      logger.debug(() => `Detected ${provider} from ephemeral base-url`);
    }
  }

  // Strategy 2 & 3: If not found, try provider config base URLs
  if (!provider && activeProviderName) {
    const providerManager = runtimeApi.getCliProviderManager();
    const providerInstance =
      providerManager.getProviderByName(activeProviderName);
    if (providerInstance) {
      const result = detectFromProviderConfig(providerInstance);
      provider = result.provider as
        | 'zai'
        | 'synthetic'
        | 'chutes'
        | 'kimi'
        | null;
      baseUrlForFetch = result.baseUrl;
    }
  }

  // Strategy 4: If still not found, try active provider name (fallback only)
  if (!provider && activeProviderName) {
    provider = detectApiKeyProviderFromName(activeProviderName);
    if (provider) {
      logger.debug(() => `Detected ${provider} from active provider name`);
    }
  }

  if (!provider) {
    return null;
  }

  const apiKey = await resolveApiKey(runtimeApi);
  if (!apiKey) {
    logger.debug(
      () => `Detected ${provider} provider but no API key available`,
    );
    return null;
  }

  return fetchApiKeyQuota(provider, apiKey, baseUrlForFetch);
}

function formatQuotaResetTime(resetTime: string): string {
  try {
    const reset = new Date(resetTime);
    if (Number.isNaN(reset.getTime())) {
      return resetTime;
    }
    const now = new Date();
    const diffMs = reset.getTime() - now.getTime();
    if (diffMs <= 0) {
      return 'now';
    }
    const diffMin = Math.ceil(diffMs / 60000);
    if (diffMin < 60) {
      return `${diffMin}m`;
    }
    const diffHr = Math.floor(diffMin / 60);
    const remainMin = diffMin % 60;
    return remainMin > 0 ? `${diffHr}h ${remainMin}m` : `${diffHr}h`;
  } catch {
    return resetTime;
  }
}

function formatGeminiQuotaLines(quotaData: Record<string, unknown>): string[] {
  const buckets = quotaData.buckets;
  if (!Array.isArray(buckets) || buckets.length === 0) {
    return [];
  }

  const lines: string[] = [];
  for (const bucket of buckets) {
    const b = bucket as Record<string, unknown>;
    const model = typeof b.modelId === 'string' ? b.modelId : 'unknown';
    const tokenType = typeof b.tokenType === 'string' ? b.tokenType : 'tokens';
    const remaining =
      typeof b.remainingAmount === 'string' ? b.remainingAmount : '?';
    const fraction =
      typeof b.remainingFraction === 'number'
        ? ` (${Math.round(b.remainingFraction * 100)}%)`
        : '';
    const resetStr =
      typeof b.resetTime === 'string'
        ? ` · resets in ${formatQuotaResetTime(b.resetTime)}`
        : '';
    lines.push(`  ${model} ${tokenType}: ${remaining}${fraction}${resetStr}`);
  }
  return lines;
}

function appendBucketLines(
  bucket: string,
  lines: string[],
  usageMap: UsageMap,
  target: string[],
): void {
  if (lines.length === 0) {
    return;
  }
  if (usageMap.size > 1) {
    target.push(`### Bucket: ${bucket}\n`);
  }
  target.push(...lines);
  target.push('');
}

function formatAnthropicLines(anthropicUsageInfo: UsageMap): string[] {
  if (anthropicUsageInfo.size === 0) {
    return [];
  }
  const anthropicLines: string[] = [];
  const sortedBuckets = Array.from(anthropicUsageInfo.keys()).sort(
    defaultFirstSort,
  );
  for (const bucket of sortedBuckets) {
    const usageInfo = anthropicUsageInfo.get(bucket);
    if (usageInfo === undefined) {
      continue;
    }
    const lines = formatAllUsagePeriods(usageInfo);
    appendBucketLines(bucket, lines, anthropicUsageInfo, anthropicLines);
  }
  if (anthropicLines[anthropicLines.length - 1] === '') {
    anthropicLines.pop();
  }
  return anthropicLines;
}

function formatCodexBucketLines(
  bucket: string,
  usageInfo: Record<string, unknown> | undefined,
  codexUsageInfo: UsageMap,
): string[] | null {
  if (usageInfo === undefined) {
    return null;
  }
  const parsed = CodexUsageInfoSchema.safeParse(usageInfo);
  if (!parsed.success) {
    logger.warn(`Invalid Codex usage info for bucket ${bucket}:`, parsed.error);
    return null;
  }
  const lines = formatCodexUsage(parsed.data);
  if (lines.length === 0) {
    return null;
  }
  const target: string[] = [];
  appendBucketLines(bucket, lines, codexUsageInfo, target);
  return target;
}

function formatCodexLines(codexUsageInfo: UsageMap): string[] {
  if (codexUsageInfo.size === 0) {
    return [];
  }
  const codexLines: string[] = [];
  const sortedBuckets = Array.from(codexUsageInfo.keys()).sort(
    defaultFirstSort,
  );
  for (const bucket of sortedBuckets) {
    const usageInfo = codexUsageInfo.get(bucket);
    const bucketLines = formatCodexBucketLines(
      bucket,
      usageInfo,
      codexUsageInfo,
    );
    if (bucketLines) {
      codexLines.push(...bucketLines);
    }
  }
  if (codexLines[codexLines.length - 1] === '') {
    codexLines.pop();
  }
  return codexLines;
}

function formatGeminiLines(geminiUsageInfo: UsageMap): string[] {
  if (geminiUsageInfo.size === 0) {
    return [];
  }
  const geminiLines: string[] = [];
  const sortedBuckets = Array.from(geminiUsageInfo.keys()).sort(
    defaultFirstSort,
  );
  for (const bucket of sortedBuckets) {
    const quotaData = geminiUsageInfo.get(bucket);
    if (quotaData === undefined) {
      continue;
    }
    const lines = formatGeminiQuotaLines(quotaData);
    appendBucketLines(bucket, lines, geminiUsageInfo, geminiLines);
  }
  if (geminiLines[geminiLines.length - 1] === '') {
    geminiLines.pop();
  }
  return geminiLines;
}

async function fetchOAuthQuotaLines(
  oauthManager: OAuthManager,
): Promise<string[]> {
  const output: string[] = [];

  const [anthropicResult, codexResult, geminiResult] = await Promise.allSettled(
    [
      oauthManager.getAllAnthropicUsageInfo(),
      oauthManager.getAllCodexUsageInfo(),
      oauthManager.getAllGeminiUsageInfo(),
    ],
  );

  if (anthropicResult.status === 'rejected') {
    logger.warn(
      'Failed to fetch Anthropic usage info:',
      anthropicResult.reason,
    );
  }
  if (codexResult.status === 'rejected') {
    logger.warn('Failed to fetch Codex usage info:', codexResult.reason);
  }

  const anthropicUsageInfo: UsageMap =
    anthropicResult.status === 'fulfilled'
      ? anthropicResult.value
      : new Map<string, Record<string, unknown>>();
  const codexUsageInfo: UsageMap =
    codexResult.status === 'fulfilled'
      ? codexResult.value
      : new Map<string, Record<string, unknown>>();
  const geminiUsageInfo: UsageMap =
    geminiResult.status === 'fulfilled'
      ? geminiResult.value
      : new Map<string, Record<string, unknown>>();

  const anthropicLines = formatAnthropicLines(anthropicUsageInfo);
  if (anthropicLines.length > 0) {
    output.push('## Anthropic Quota Information\n');
    output.push(...anthropicLines);
  }

  const codexLines = formatCodexLines(codexUsageInfo);
  if (codexLines.length > 0) {
    if (output.length > 0) {
      output.push('');
    }
    output.push('## Codex Quota Information\n');
    output.push(...codexLines);
  }

  const geminiLines = formatGeminiLines(geminiUsageInfo);
  if (geminiLines.length > 0) {
    if (output.length > 0) {
      output.push('');
    }
    output.push('## Gemini Quota Information\n');
    output.push(...geminiLines);
  }

  return output;
}

/**
 * Fetch all available quota information for the default stats view.
 * Returns formatted lines ready for display, or empty array if no quota available.
 */
export async function fetchAllQuotaInfo(
  runtimeApi: RuntimeApi,
): Promise<string[]> {
  const output: string[] = [];
  const oauthManager = runtimeApi.getCliOAuthManager();

  try {
    if (oauthManager) {
      const oauthLines = await fetchOAuthQuotaLines(oauthManager);
      output.push(...oauthLines);
    }

    const apiKeyQuotaResult = await fetchApiKeyProviderQuota(runtimeApi);
    if (apiKeyQuotaResult) {
      if (output.length > 0) {
        output.push('');
      }
      output.push(`## ${apiKeyQuotaResult.provider} Quota Information\n`);
      output.push(...apiKeyQuotaResult.lines);
    }
  } catch (error) {
    logger.warn(
      'Error fetching quota info for default stats view:',
      error instanceof Error ? error.message : String(error),
    );
  }

  return output;
}
