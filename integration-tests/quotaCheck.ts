/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Quota information from the Synthetic API
 */
export interface QuotaInfo {
  usagePercent: number;
  limit: number;
  requests: number;
  renewsAt: string;
}

/**
 * Response format from the Synthetic API /v2/quotas endpoint
 */
interface QuotaResponse {
  subscription: {
    limit: number;
    requests: number;
    renewsAt: string;
  };
  search?: unknown;
  toolCalls?: unknown;
}

/**
 * Check quota usage for a Synthetic API key
 *
 * @param apiKey - The Synthetic API key to check
 * @returns QuotaInfo object with usage details, or null on any error
 */
export async function checkSyntheticQuota(
  apiKey: string,
): Promise<QuotaInfo | null> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);

    const response = await fetch('https://api.synthetic.new/v2/quotas', {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      console.warn(
        `Synthetic quota check failed with status ${response.status}`,
      );
      return null;
    }

    const data = (await response.json()) as QuotaResponse;

    if (
      !data.subscription ||
      typeof data.subscription.limit !== 'number' ||
      typeof data.subscription.requests !== 'number'
    ) {
      console.warn('Synthetic quota response missing required fields');
      return null;
    }

    const usagePercent =
      (data.subscription.requests / data.subscription.limit) * 100;

    return {
      usagePercent,
      limit: data.subscription.limit,
      requests: data.subscription.requests,
      renewsAt: data.subscription.renewsAt,
    };
  } catch (error) {
    if (error instanceof Error) {
      console.warn(`Synthetic quota check error: ${error.message}`);
    } else {
      console.warn('Synthetic quota check error: Unknown error');
    }
    return null;
  }
}

/**
 * Select the optimal Synthetic API key based on quota usage
 *
 * Checks quota for both available keys and selects the one with more remaining capacity.
 * Sets process.env.OPENAI_API_KEY to the selected key.
 * Throws an error if both keys are >90% used.
 */
export async function selectOptimalKey(): Promise<void> {
  const keyVarName = process.env.KEY_VAR_NAME;
  const key1 = process.env.OPENAI_API_KEY;
  const key2 = process.env.OPENAI_API_KEY_2;

  // Only run for Synthetic provider
  if (!keyVarName || !keyVarName.includes('SYNTHETIC')) {
    return;
  }

  // Backward compatibility: if no keys configured, return early
  if (!key1 && !key2) {
    return;
  }

  const shouldLog = process.env.CI === 'true' || process.env.VERBOSE === 'true';

  // Check quotas for available keys
  const quota1 = key1 ? await checkSyntheticQuota(key1) : null;
  const quota2 = key2 ? await checkSyntheticQuota(key2) : null;

  // If both keys are >90% used, fail early
  if (
    quota1 &&
    quota1.usagePercent > 90 &&
    quota2 &&
    quota2.usagePercent > 90
  ) {
    throw new Error(
      `Both Synthetic API keys are over 90% quota: ` +
        `Key 1: ${quota1.usagePercent.toFixed(1)}%, ` +
        `Key 2: ${quota2.usagePercent.toFixed(1)}%`,
    );
  }

  // Determine which key to use
  let selectedKey: string | undefined;
  let reason: string;

  if (!quota1 && !quota2) {
    // Both checks failed, use key1 if available, otherwise key2
    selectedKey = key1 || key2;
    reason = 'quota checks failed for both keys, using first available';
  } else if (!quota1) {
    // Key1 check failed, use key2
    selectedKey = key2;
    reason = `quota check failed for key1, using key2 (${quota2!.usagePercent.toFixed(1)}% used)`;
  } else if (!quota2) {
    // Key2 check failed or not available, use key1
    selectedKey = key1;
    reason = `key2 not available, using key1 (${quota1.usagePercent.toFixed(1)}% used)`;
  } else {
    // Both checks succeeded, pick the one with lower usage
    if (quota1.usagePercent <= quota2.usagePercent) {
      selectedKey = key1;
      reason = `selected key1 with ${quota1.usagePercent.toFixed(1)}% usage (key2: ${quota2.usagePercent.toFixed(1)}%)`;
    } else {
      selectedKey = key2;
      reason = `selected key2 with ${quota2.usagePercent.toFixed(1)}% usage (key1: ${quota1.usagePercent.toFixed(1)}%)`;
    }
  }

  // Set the selected key
  if (selectedKey) {
    process.env.OPENAI_API_KEY = selectedKey;
    if (shouldLog) {
      console.log(`Synthetic API key selection: ${reason}`);
    }
  }
}
