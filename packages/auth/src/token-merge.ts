/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Token merge utility for credential refresh operations.
 * Extracted from OAuthManager for shared use by proxy server.
 *
 * @plan PLAN-20250214-CREDPROXY.P06
 * @requirement R12.1, R12.2, R12.3, R12.4, R12.5
 * @pseudocode analysis/pseudocode/002-token-sanitization-merge.md
 */

import { type OAuthToken } from './types.js';

export type OAuthTokenWithExtras = OAuthToken & Record<string, unknown>;

export function mergeRefreshedToken(
  current: OAuthTokenWithExtras,
  next: Partial<OAuthTokenWithExtras>,
): OAuthTokenWithExtras {
  const merged = { ...current, ...next };
  if (next.refresh_token === undefined || next.refresh_token === '') {
    merged.refresh_token = current.refresh_token;
  }
  return merged;
}
