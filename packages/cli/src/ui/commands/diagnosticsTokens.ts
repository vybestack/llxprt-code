/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { DebugLogger } from '@vybestack/llxprt-code-telemetry';
import {
  MCPOAuthTokenStorage,
  type TokenStorage,
} from '@vybestack/llxprt-code-mcp';
import type { OAuthControl } from '../contexts/OAuthControlContext.js';

interface McpServerToken {
  readonly expiresAt?: number;
  readonly refreshToken?: string;
  readonly tokenType: string;
  readonly scope?: string;
}

interface ProviderToken {
  readonly expiry?: number;
  readonly hasRefreshToken: boolean;
}

async function appendProviderTokens(
  diagnostics: string[],
  logger: DebugLogger,
  oauthManager: OAuthControl,
): Promise<void> {
  const discovered = await oauthManager.discoverBuckets(logger);
  if (discovered.length === 0) {
    return;
  }

  for (const { provider, buckets } of discovered) {
    diagnostics.push('### Provider Tokens');
    diagnostics.push(`- ${provider}:`);
    diagnostics.push(`  - Buckets: ${buckets.length}`);

    for (const { bucket } of buckets) {
      let token: ProviderToken | null;
      try {
        const summary = await oauthManager.readStoredTokenSummary(
          provider,
          bucket,
        );
        token = summary;
      } catch (error) {
        logger.debug(
          () =>
            `[diagnostics] Failed to read token for ${provider}/${bucket}: ${error}`,
        );
        continue;
      }

      if (token && typeof token.expiry === 'number') {
        appendProviderBucketToken(diagnostics, bucket, token);
      }
    }
  }
}

function appendProviderBucketToken(
  diagnostics: string[],
  bucket: string,
  token: ProviderToken,
): void {
  const expirySeconds = token.expiry as number;
  const expiryDate = new Date(expirySeconds * 1000);
  const timeUntilExpiry = Math.max(0, expirySeconds - Date.now() / 1000);
  const hours = Math.floor(timeUntilExpiry / 3600);
  const minutes = Math.floor((timeUntilExpiry % 3600) / 60);
  const isExpired = expirySeconds < Date.now() / 1000;

  diagnostics.push(`  - ${bucket}:`);
  diagnostics.push(`    - Status: ${isExpired ? 'Expired' : 'Authenticated'}`);
  diagnostics.push(`    - Expires: ${expiryDate.toISOString()}`);
  diagnostics.push(`    - Time Remaining: ${hours}h ${minutes}m`);
  diagnostics.push(
    `    - Refresh Token: ${token.hasRefreshToken ? 'Available' : 'None'}`,
  );
}

function appendMcpServerTokenExpiry(
  diagnostics: string[],
  expiresAt: number,
): void {
  if (expiresAt === 0 || Number.isNaN(expiresAt)) {
    return;
  }
  const expiryDate = new Date(expiresAt);
  const timeUntilExpiry = Math.max(0, (expiresAt - Date.now()) / 1000);
  const hours = Math.floor(timeUntilExpiry / 3600);
  const minutes = Math.floor((timeUntilExpiry % 3600) / 60);

  diagnostics.push(`  - Expires: ${expiryDate.toISOString()}`);
  diagnostics.push(`  - Time Remaining: ${hours}h ${minutes}m`);
}

function formatMcpServerToken(
  diagnostics: string[],
  serverName: string,
  token: McpServerToken,
): void {
  const isExpired = MCPOAuthTokenStorage.isTokenExpired(token as never);

  diagnostics.push(`- ${serverName}:`);
  diagnostics.push(`  - Status: ${isExpired ? 'Expired' : 'Valid'}`);

  if (
    token.expiresAt != null &&
    token.expiresAt !== 0 &&
    !Number.isNaN(token.expiresAt)
  ) {
    appendMcpServerTokenExpiry(diagnostics, token.expiresAt);
  }

  diagnostics.push(
    `  - Refresh Token: ${token.refreshToken ? 'Available' : 'None'}`,
  );

  if (token.tokenType) {
    diagnostics.push(`  - Token Type: ${token.tokenType}`);
  }

  if (token.scope) {
    diagnostics.push(`  - Scopes: ${token.scope}`);
  }
}

async function appendMcpTokens(
  readCredentials: TokenStorage['getAllCredentials'],
  diagnostics: string[],
  logger: DebugLogger,
): Promise<boolean> {
  try {
    const mcpTokens = await readCredentials();

    if (mcpTokens.size > 0) {
      diagnostics.push('\n### MCP Server Tokens');

      for (const [serverName, credentials] of mcpTokens) {
        formatMcpServerToken(diagnostics, serverName, credentials.token);
      }
      return true;
    }
  } catch (error) {
    logger.debug(() => `[diagnostics] Failed to retrieve MCP tokens: ${error}`);
  }
  return false;
}

/**
 * Appends OAuth provider and MCP server token diagnostics to the output array.
 * Extracted from diagnosticsCommand.ts so the token iteration/formatting logic
 * is independently testable.
 */
export async function appendOAuthTokens(
  readCredentials: TokenStorage['getAllCredentials'],
  diagnostics: string[],
  logger: DebugLogger,
  oauthManager: OAuthControl,
): Promise<void> {
  diagnostics.push('\n## OAuth Tokens');

  try {
    if (!oauthManager.isAvailable()) {
      diagnostics.push('- No OAuth tokens configured');
      return;
    }

    // Capture diagnostics length before provider tokens are added
    const beforeLength = diagnostics.length;
    await appendProviderTokens(diagnostics, logger, oauthManager);
    const hasProviderTokens = diagnostics.length > beforeLength;

    const hasMCPTokens = await appendMcpTokens(
      readCredentials,
      diagnostics,
      logger,
    );

    if (!hasProviderTokens && !hasMCPTokens) {
      diagnostics.push('- No OAuth tokens configured');
    }
  } catch (error) {
    logger.debug(
      () => `[diagnostics] Failed to retrieve OAuth tokens: ${error}`,
    );
    diagnostics.push('- Unable to retrieve OAuth token information');
  }
}
