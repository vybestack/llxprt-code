/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { DebugLogger } from '@vybestack/llxprt-code-telemetry/debug/DebugLogger.js';
import { getErrorMessage } from '@vybestack/llxprt-code-tools/utils/errors.js';
import type { MCPOAuthConfig, MCPOAuthProvider } from './oauth-provider.js';
import {
  MCPOAuthTokenStorage,
  type MCPOAuthToken,
} from './oauth-token-storage.js';
import type { OAuthTokenResponse } from './oauth-provider-utils.js';
import { awaitOAuthOperation } from './oauth-request.js';

const logger = new DebugLogger('llxprt:mcp:oauth');
type TokenStore = Pick<
  MCPOAuthTokenStorage,
  'getCredentials' | 'saveToken' | 'deleteCredentials'
>;

export function buildMCPOAuthToken(
  response: OAuthTokenResponse,
): MCPOAuthToken {
  if (!response.access_token)
    throw new Error('No access token received from token endpoint');
  return {
    accessToken: response.access_token,
    tokenType: response.token_type || 'Bearer',
    refreshToken: response.refresh_token,
    scope: response.scope,
    ...(response.expires_in !== undefined && response.expires_in > 0
      ? { expiresAt: Date.now() + response.expires_in * 1000 }
      : {}),
  };
}

export async function finalizeOAuthToken(
  response: Promise<OAuthTokenResponse>,
  serverName: string,
  config: MCPOAuthConfig,
  mcpServerUrl: string | undefined,
  signal: AbortSignal | undefined,
  tokenStorage: MCPOAuthTokenStorage,
): Promise<MCPOAuthToken> {
  const token = buildMCPOAuthToken(await response);
  await saveAndVerifyToken(
    serverName,
    token,
    config,
    mcpServerUrl,
    signal,
    tokenStorage,
  );
  signal?.throwIfAborted();
  return token;
}

export async function saveAndVerifyToken(
  serverName: string,
  token: MCPOAuthToken,
  config: MCPOAuthConfig,
  mcpServerUrl: string | undefined,
  signal: AbortSignal | undefined,
  tokenStorage: MCPOAuthTokenStorage,
): Promise<void> {
  try {
    await awaitOAuthOperation(signal, () =>
      tokenStorage.saveToken(
        serverName,
        token,
        config.clientId,
        config.tokenUrl,
        mcpServerUrl,
      ),
    );
    logger.debug('[OK] Authentication successful! Token saved.');
    const savedToken = await awaitOAuthOperation(signal, () =>
      tokenStorage.getCredentials(serverName),
    );
    if (savedToken?.token.accessToken) {
      logger.debug('[OK] Token verification successful');
    } else {
      logger.error(
        'Token verification failed: token not found or invalid after save',
      );
    }
  } catch (error) {
    logger.error(`Failed to save token: ${getErrorMessage(error)}`);
    throw error;
  }
}

export async function getValidOAuthToken(
  tokenStorage: TokenStore,
  serverName: string,
  config: MCPOAuthConfig,
  signal: AbortSignal | undefined,
  refresh: typeof MCPOAuthProvider.refreshAccessToken,
): Promise<string | null> {
  signal?.throwIfAborted();
  const credentials = await awaitOAuthOperation(signal, () =>
    tokenStorage.getCredentials(serverName),
  );
  if (!credentials) return null;
  const { token } = credentials;
  if (!MCPOAuthTokenStorage.isTokenExpired(token)) return token.accessToken;
  if (!token.refreshToken || !config.clientId || !credentials.tokenUrl)
    return null;
  try {
    logger.log(`Refreshing expired token for MCP server: ${serverName}`);
    const response = await refresh(
      config,
      token.refreshToken,
      credentials.tokenUrl,
      credentials.mcpServerUrl,
      signal,
    );
    const newToken: MCPOAuthToken = {
      ...buildMCPOAuthToken(response),
      tokenType: response.token_type,
      refreshToken: response.refresh_token ?? token.refreshToken,
      scope: response.scope ?? token.scope,
    };
    await awaitOAuthOperation(signal, () =>
      tokenStorage.saveToken(
        serverName,
        newToken,
        config.clientId,
        credentials.tokenUrl,
        credentials.mcpServerUrl,
      ),
    );
    return newToken.accessToken;
  } catch (error) {
    signal?.throwIfAborted();
    logger.error(`Failed to refresh token: ${getErrorMessage(error)}`);
    await awaitOAuthOperation(signal, () =>
      tokenStorage.deleteCredentials(serverName),
    );
    return null;
  }
}
