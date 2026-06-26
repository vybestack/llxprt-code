/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * @plan PLAN-20260622-MCPOAUTHTRUTH.P04
 * @requirement REQ-001,REQ-INT-001
 */

import { mcpServerRequiresOAuth } from '../client/mcp-status.js';
import { MCPOAuthTokenStorage } from './oauth-token-storage.js';

/**
 * Canonical OAuth status for a single MCP server.
 * - 'not-required'  : the server does not require OAuth (no read performed)
 * - 'none'          : OAuth required but no usable persisted credential
 * - 'expired'       : a persisted credential exists but is expired
 * - 'authenticated' : a persisted, non-expired credential exists
 */
export type McpOAuthStatus =
  | 'authenticated'
  | 'expired'
  | 'none'
  | 'not-required';

/**
 * Single source of truth for an MCP server's persisted OAuth status.
 *
 * Composes the runtime "requires OAuth" map, the persisted-credential read, and the expiry math.
 * Total (never throws): every storage absence/fault maps to 'none'. Masked: returns the enum only.
 *
 * @pseudocode oauth-status-helper.md:01-28
 */
export async function getMcpServerOAuthStatus(
  serverName: string,
  opts?: { requiresOAuth?: boolean },
): Promise<McpOAuthStatus> {
  // @pseudocode 02-08 — required? (OR-combine; R-REQUIRED-OR). Do NOT read storage if not required.
  const hintRequires = opts?.requiresOAuth === true;
  const runtimeRequires = mcpServerRequiresOAuth.get(serverName) === true;
  if (!hintRequires && !runtimeRequires) {
    return 'not-required';
  }

  // @pseudocode 10-19 — persisted credential read (fault-tolerant; R-FAULT-TOLERANT / R-INNER-TOKEN).
  let credentials: Awaited<ReturnType<typeof MCPOAuthTokenStorage.getToken>>;
  try {
    credentials = await MCPOAuthTokenStorage.getToken(serverName);
  } catch {
    return 'none';
  }
  // @pseudocode 17-19 — required but no persisted creds ⇒ 'none'. getToken is typed MCPOAuthCredentials | null; the null check covers every absence case.
  if (credentials === null) {
    return 'none';
  }

  // @pseudocode 21-27 — expiry on the INNER token (R-INNER-TOKEN). Properly typed (no unsafe cast).
  return MCPOAuthTokenStorage.isTokenExpired(credentials.token)
    ? 'expired'
    : 'authenticated';
}
