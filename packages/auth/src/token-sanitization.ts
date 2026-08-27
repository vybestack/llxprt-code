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

import type { z } from 'zod';
import { OAuthTokenSchema, type OAuthToken } from './types.js';

/**
 * Sanitized OAuth token schema: validates the supported OAuth fields while
 * preserving provider-specific extension fields before the refresh_token is stripped.
 */
export const SanitizedOAuthTokenSchema =
  OAuthTokenSchema.passthrough().transform((token) => {
    const { refresh_token: _refresh_token, ...rest } = token;
    return rest;
  });

export type SanitizedOAuthToken = z.infer<typeof SanitizedOAuthTokenSchema>;

export function sanitizeTokenForProxy(token: OAuthToken): SanitizedOAuthToken {
  return SanitizedOAuthTokenSchema.parse(token);
}
