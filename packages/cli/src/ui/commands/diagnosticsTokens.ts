/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { DebugLogger } from '@vybestack/llxprt-code-core';
import { MCPOAuthTokenStorage } from '@vybestack/llxprt-code-mcp';
import { getRuntimeApi } from '../contexts/RuntimeContext.js';

interface McpServerToken {
  readonly expiresAt?: number;
  readonly refreshToken?: string;
  readonly tokenType: string;
  readonly scope?: string;
}

interface ProviderToken {
  readonly expiry?: number;
  readonly refresh_token?: string;
}

async function appendProviderTokens(
  diagnostics: string[],
  logger: DebugLogger,
): Promise<void> {
  const runtimeApi = getRuntimeApi();
  const oauthManager = runtimeApi.getCliOAuthManager();
  if (!oauthManager) {
    return;
  }

  const supportedProviders = oauthManager.getSupportedProviders();
  if (supportedProviders.length === 0) {
    return;
  }

  const tokenStore = oauthManager.getTokenStore();

  for (const provider of supportedProviders) {
    let buckets: string[] = [];

    try {
      buckets = await tokenStore.listBuckets(provider);
    } catch (error) {
      logger.debug(
        () => `[diagnostics] Failed to list buckets for ${provider}: ${error}`,
      );
    }

    if (buckets.length === 0) {
      continue;
    }

    diagnostics.push('### Provider Tokens');
    diagnostics.push(`- ${provider}:`);
    diagnostics.push(`  - Buckets: ${buckets.length}`);

    for (const bucket of buckets) {
      const token = (await tokenStore.getToken(
        provider,
        bucket,
      )) as ProviderToken | null;

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
    `    - Refresh Token: ${token.refresh_token ? 'Available' : 'None'}`,
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
  diagnostics: string[],
  logger: DebugLogger,
): Promise<boolean> {
  try {
    const mcpTokenStorage = new MCPOAuthTokenStorage();
    const mcpTokens = await mcpTokenStorage.getAllCredentials();

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
  diagnostics: string[],
  logger: DebugLogger,
): Promise<void> {
  diagnostics.push('\n## OAuth Tokens');

  try {
    const runtimeApi = getRuntimeApi();
    const oauthManager = runtimeApi.getCliOAuthManager();

    if (!oauthManager) {
      diagnostics.push('- No OAuth tokens configured');
      return;
    }

    // Capture diagnostics length before provider tokens are added
    const beforeLength = diagnostics.length;
    await appendProviderTokens(diagnostics, logger);
    const hasProviderTokens = diagnostics.length > beforeLength;

    const hasMCPTokens = await appendMcpTokens(diagnostics, logger);

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
