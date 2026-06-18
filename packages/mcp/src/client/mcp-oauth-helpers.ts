/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import type { MCPServerConfig } from '@vybestack/llxprt-code-core/config/configTypes.js';
import {
  getErrorMessage,
  is404Error,
  UnauthorizedError,
} from '@vybestack/llxprt-code-core/utils/errors.js';
import { MCPOAuthProvider } from '../auth/oauth-provider.js';
import { MCPOAuthTokenStorage } from '../auth/oauth-token-storage.js';
import { OAuthUtils } from '../auth/oauth-utils.js';
import { coreEvents } from '@vybestack/llxprt-code-core/utils/events.js';
import { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';
import {
  createSSETransportWithAuth,
  createTransportWithOAuth,
  getStoredOAuthToken,
  MCP_DEFAULT_TIMEOUT_MSEC,
} from './mcp-transport.js';
import { hasNetworkTransport } from './mcp-discovery-helpers.js';

const debugLogger = DebugLogger.getLogger('llxprt:core:tools:mcp-client');

/**
 * Returns a non-empty array of scopes, treating empty/missing as no scopes.
 */
function resolveScopes(scopes: string[] | undefined): string[] {
  if (scopes !== undefined && scopes.length > 0) return scopes;
  return [];
}

/**
 * Extract WWW-Authenticate header from error message string.
 * Uses string-based parsing instead of regex to avoid ReDoS concerns.
 */
export function extractWWWAuthenticateHeader(
  errorString: string,
): string | null {
  const lower = errorString.toLowerCase();
  const key = 'www-authenticate';

  // Pattern 1 & 2: "www-authenticate:<value>" or "WWW-Authenticate:<value>"
  const colonIdx = lower.indexOf(key + ':');
  if (colonIdx !== -1) {
    const valueStart = colonIdx + key.length + 1;
    const value = errorString.slice(valueStart);
    const nlIdx = value.search(/[\n\r]/);
    const extracted = nlIdx === -1 ? value : value.slice(0, nlIdx);
    const trimmed = extracted.trim();
    if (trimmed !== '') return trimmed;
  }

  // Pattern 3: JSON-style "www-authenticate":"<value>"
  const jsonIdx = lower.indexOf(key + '":');
  if (jsonIdx !== -1) {
    const valueStart = jsonIdx + key.length + 3;
    const value = errorString.slice(valueStart);
    const endQuote = value.indexOf('"');
    if (endQuote > 0) return value.slice(0, endQuote).trim();
  }

  // Pattern 4: JSON-style 'www-authenticate':'<value>'
  const singleIdx = lower.indexOf(key + "':");
  if (singleIdx !== -1) {
    const valueStart = singleIdx + key.length + 3;
    const value = errorString.slice(valueStart);
    const endQuote = value.indexOf("'");
    if (endQuote > 0) return value.slice(0, endQuote).trim();
  }

  return null;
}

/**
 * Handle automatic OAuth discovery and authentication for a server.
 */
export async function handleAutomaticOAuth(
  mcpServerName: string,
  mcpServerConfig: MCPServerConfig,
  wwwAuthenticate: string,
): Promise<boolean> {
  try {
    debugLogger.log(`🔐 '${mcpServerName}' requires OAuth authentication`);

    let oauthConfig;
    const resourceMetadataUri =
      OAuthUtils.parseWWWAuthenticateHeader(wwwAuthenticate);
    if (resourceMetadataUri) {
      oauthConfig = await OAuthUtils.discoverOAuthConfig(resourceMetadataUri);
    } else if (hasNetworkTransport(mcpServerConfig)) {
      const serverUrl = new URL(
        mcpServerConfig.httpUrl ?? mcpServerConfig.url!,
      );
      const baseUrl = `${serverUrl.protocol}//${serverUrl.host}`;
      oauthConfig = await OAuthUtils.discoverOAuthConfig(baseUrl);
    }

    if (!oauthConfig) {
      debugLogger.error(
        `[ERROR] Could not configure OAuth for '${mcpServerName}' - please authenticate manually with /mcp auth ${mcpServerName}`,
      );
      return false;
    }

    const oauthAuthConfig = {
      enabled: true,
      authorizationUrl: oauthConfig.authorizationUrl,
      tokenUrl: oauthConfig.tokenUrl,
      scopes: resolveScopes(oauthConfig.scopes),
    };

    const serverUrl = mcpServerConfig.httpUrl ?? mcpServerConfig.url;
    debugLogger.log(
      `Starting OAuth authentication for server '${mcpServerName}'...`,
    );
    await MCPOAuthProvider.authenticate(
      mcpServerName,
      oauthAuthConfig,
      serverUrl,
    );

    debugLogger.log(
      `OAuth authentication successful for server '${mcpServerName}'`,
    );
    return true;
  } catch (error) {
    debugLogger.error(
      `Failed to handle automatic OAuth for server '${mcpServerName}': ${getErrorMessage(error)}`,
    );
    return false;
  }
}

/**
 * Creates SSE transport and connects client with proper timeout.
 */
export async function connectWithSSETransport(
  client: Client,
  config: MCPServerConfig,
  accessToken?: string | null,
): Promise<void> {
  const transport = createSSETransportWithAuth(config, accessToken);
  try {
    await client.connect(transport, {
      timeout: config.timeout ?? MCP_DEFAULT_TIMEOUT_MSEC,
    });
  } catch (error) {
    await transport.close();
    throw error;
  }
}

/**
 * Checks for rejected stored token, emits feedback message, throws UnauthorizedError.
 */
export async function showAuthRequiredMessage(
  serverName: string,
): Promise<never> {
  const storedToken = await getStoredOAuthToken(serverName);
  let message: string;
  if (storedToken) {
    message = `Stored OAuth token for server '${serverName}' was rejected. Please re-authenticate using: /mcp auth ${serverName}`;
  } else {
    message = `Server '${serverName}' requires OAuth authentication. Please authenticate using: /mcp auth ${serverName}`;
  }
  coreEvents.emitFeedback('error', message);
  throw new UnauthorizedError(message);
}

/**
 * Retries connection with OAuth token. If httpReturned404 is true, only tries SSE.
 * Otherwise tries HTTP first, falls back to SSE on 404.
 */
export async function retryWithOAuth(
  client: Client,
  serverName: string,
  config: MCPServerConfig,
  accessToken: string,
  httpReturned404: boolean,
): Promise<void> {
  if (httpReturned404) {
    await connectWithSSETransport(client, config, accessToken);
    return;
  }

  const headers: Record<string, string> = {
    ...config.headers,
    Authorization: `Bearer ${accessToken}`,
  };

  if (config.type === 'sse') {
    await connectWithSSETransport(client, config, accessToken);
    return;
  }

  try {
    const { StreamableHTTPClientTransport } = await import(
      '@modelcontextprotocol/sdk/client/streamableHttp.js'
    );
    const httpTransport = new StreamableHTTPClientTransport(
      new URL(config.httpUrl ?? config.url!),
      {
        requestInit: { headers },
      },
    );
    await client.connect(httpTransport, {
      timeout: config.timeout ?? MCP_DEFAULT_TIMEOUT_MSEC,
    });
  } catch (httpError) {
    const is404 = is404Error(httpError);
    const shouldFallback: boolean =
      is404 && !config.type && Boolean(config.url && !config.httpUrl);

    if (shouldFallback) {
      debugLogger.log(
        `HTTP connection failed with 404 for '${serverName}', falling back to SSE with OAuth`,
      );
      await connectWithSSETransport(client, config, accessToken);
    } else {
      throw httpError;
    }
  }
}

/**
 * Fetches www-authenticate header from server via HEAD request.
 */
export async function fetchWwwAuthenticateHeader(
  mcpServerConfig: MCPServerConfig,
): Promise<string | null> {
  try {
    const urlToFetch = mcpServerConfig.httpUrl ?? mcpServerConfig.url!;
    const response = await fetch(urlToFetch, {
      method: 'HEAD',
      headers: {
        Accept: mcpServerConfig.httpUrl
          ? 'application/json'
          : 'text/event-stream',
      },
      signal: AbortSignal.timeout(5000),
    });

    if (response.status === 401) {
      const header = response.headers.get('www-authenticate');
      if (header) {
        debugLogger.log(`Found www-authenticate header from server: ${header}`);
      }
      return header;
    }
  } catch (fetchError) {
    debugLogger.debug(
      `Failed to fetch www-authenticate header: ${getErrorMessage(fetchError)}`,
    );
  }
  return null;
}

/**
 * Connects to MCP server with a discovered OAuth token.
 */
export async function connectWithOAuthToken(
  mcpClient: Client,
  mcpServerName: string,
  mcpServerConfig: MCPServerConfig,
): Promise<Client> {
  debugLogger.log(
    `Retrying connection to '${mcpServerName}' with OAuth token...`,
  );

  const tokenStorage = new MCPOAuthTokenStorage();
  const credentials = await tokenStorage.getCredentials(mcpServerName);
  if (!credentials) {
    debugLogger.error(
      `Failed to get credentials for server '${mcpServerName}' after successful OAuth authentication`,
    );
    throw new Error(
      `Failed to get credentials for server '${mcpServerName}' after successful OAuth authentication`,
    );
  }

  const accessToken = await MCPOAuthProvider.getValidToken(mcpServerName, {
    clientId: credentials.clientId,
  });
  if (!accessToken) {
    debugLogger.error(
      `Failed to get OAuth token for server '${mcpServerName}'`,
    );
    throw new Error(`Failed to get OAuth token for server '${mcpServerName}'`);
  }

  const oauthTransport = await createTransportWithOAuth(
    mcpServerName,
    mcpServerConfig,
    accessToken,
  );
  if (!oauthTransport) {
    debugLogger.error(
      `Failed to create OAuth transport for server '${mcpServerName}'`,
    );
    throw new Error(
      `Failed to create OAuth transport for server '${mcpServerName}'`,
    );
  }

  try {
    await mcpClient.connect(oauthTransport, {
      timeout: mcpServerConfig.timeout ?? MCP_DEFAULT_TIMEOUT_MSEC,
    });
    return mcpClient;
  } catch (retryError) {
    debugLogger.error(
      `Failed to connect with OAuth token: ${getErrorMessage(retryError)}`,
    );
    throw retryError;
  }
}
