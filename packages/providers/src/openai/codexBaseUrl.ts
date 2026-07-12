/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Normalize a base URL by trimming and removing trailing slashes.
 * Shared by codexUsageInfo.ts and codexRateLimitReset.ts so that base-url
 * resolution stays consistent across both modules.
 */
export function normalizeBaseUrl(baseUrl?: string): string {
  if (typeof baseUrl !== 'string') {
    return '';
  }

  let normalized = baseUrl.trim();
  while (normalized.endsWith('/')) {
    normalized = normalized.slice(0, -1);
  }
  return normalized;
}
