/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Token sanitization for credential proxy security boundary.
 * Strips refresh_token from all data crossing the Unix socket.
 *
 * @plan PLAN-20250214-CREDPROXY.P06
 * @requirement R10.1, R10.2, R10.3
 * @pseudocode analysis/pseudocode/002-token-sanitization-merge.md
 */

import { type OAuthToken } from './types.js';

export type SanitizedOAuthToken = Omit<OAuthToken, 'refresh_token'> &
  Record<string, unknown>;

export function sanitizeTokenForProxy(token: OAuthToken): SanitizedOAuthToken {
  const { refresh_token: _refresh_token, ...sanitized } = token;
  return sanitized;
}
