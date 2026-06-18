/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { ListRootsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import type { MCPServerConfig } from '@vybestack/llxprt-code-core/config/configTypes.js';
import type {
  Unsubscribe,
  WorkspaceContext,
} from '@vybestack/llxprt-code-core/utils/workspaceContext.js';
import {
  is404Error,
  isAuthenticationError,
} from '@vybestack/llxprt-code-core/utils/errors.js';
import { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';
import { basename } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  MCPServerStatus,
  mcpServerRequiresOAuth,
  updateMCPServerStatus,
} from './mcp-status.js';
import {
  createTransport,
  getStoredOAuthToken,
  MCP_DEFAULT_TIMEOUT_MSEC,
} from './mcp-transport.js';
import { LenientJsonSchemaValidator } from './mcp-schema-validator.js';
import {
  connectWithOAuthToken,
  connectWithSSETransport,
  extractWWWAuthenticateHeader,
  fetchWwwAuthenticateHeader,
  handleAutomaticOAuth,
  retryWithOAuth,
  showAuthRequiredMessage,
} from './mcp-oauth-helpers.js';
import { hasNetworkTransport } from './mcp-discovery-helpers.js';
import { OAuthUtils } from '../auth/oauth-utils.js';
import { MCPOAuthProvider } from '../auth/oauth-provider.js';

const debugLogger = DebugLogger.getLogger('llxprt:core:tools:mcp-client');

function initializeMcpClient(
  clientVersion: string,
  workspaceContext: WorkspaceContext,
): Client {
  const mcpClient = new Client(
    {
      name: 'llxprt-code-mcp-client',
      version: clientVersion,
    },
    {
      jsonSchemaValidator: new LenientJsonSchemaValidator(),
    },
  );

  mcpClient.registerCapabilities({
    roots: {
      listChanged: true,
    },
  });

  mcpClient.setRequestHandler(ListRootsRequestSchema, async () => {
    const roots = [];
    for (const dir of workspaceContext.getDirectories()) {
      roots.push({
        uri: pathToFileURL(dir).toString(),
        name: basename(dir),
      });
    }
    return { roots };
  });

  let unlistenDirectories: Unsubscribe | undefined =
    workspaceContext.onDirectoriesChanged(() => {
      void (async () => {
        try {
          await mcpClient.notification({
            method: 'notifications/roots/list_changed',
          });
        } catch {
          unlistenDirectories?.();
          unlistenDirectories = undefined;
        }
      })();
    });

  const oldOnClose = mcpClient.onclose;
  mcpClient.onclose = () => {
    oldOnClose?.();
    unlistenDirectories?.();
    unlistenDirectories = undefined;
  };

  return mcpClient;
}

function throwConnectionError(mcpServerName: string, error: unknown): never {
  const errorMessage = (error as Error).message || String(error);
  const isNetworkError =
    errorMessage.includes('ENOTFOUND') || errorMessage.includes('ECONNREFUSED');

  let conciseError: string;
  if (isNetworkError) {
    conciseError = `Cannot connect to '${mcpServerName}' - server may be down or URL incorrect`;
  } else {
    conciseError = `Connection failed for '${mcpServerName}': ${errorMessage}`;
  }

  if (process.env.SANDBOX) {
    conciseError += ` (check sandbox availability)`;
  }

  throw new Error(conciseError);
}

async function resolveWwwAuthenticateHeader(
  mcpServerName: string,
  mcpServerConfig: MCPServerConfig,
  errorString: string,
): Promise<string | null> {
  let wwwAuthenticate = extractWWWAuthenticateHeader(errorString);

  if (!wwwAuthenticate && hasNetworkTransport(mcpServerConfig)) {
    debugLogger.log(
      `No www-authenticate header in error, trying to fetch it from server...`,
    );
    wwwAuthenticate = await fetchWwwAuthenticateHeader(mcpServerConfig);
  }

  return wwwAuthenticate;
}

async function retryWithWwwAuthenticate(
  mcpClient: Client,
  mcpServerName: string,
  mcpServerConfig: MCPServerConfig,
  wwwAuthenticate: string,
): Promise<Client> {
  debugLogger.log(
    `Received 401 with www-authenticate header: ${wwwAuthenticate}`,
  );

  const oauthSuccess = await handleAutomaticOAuth(
    mcpServerName,
    mcpServerConfig,
    wwwAuthenticate,
  );

  if (oauthSuccess) {
    return connectWithOAuthToken(mcpClient, mcpServerName, mcpServerConfig);
  }

  debugLogger.error(
    `Failed to handle automatic OAuth for server '${mcpServerName}'`,
  );
  throw new Error(
    `Failed to handle automatic OAuth for server '${mcpServerName}'`,
  );
}

function resolveDiscoveryScopes(scopes: string[] | undefined): string[] {
  if (scopes !== undefined && scopes.length > 0) return scopes;
  return [];
}

async function retryWithOAuthDiscovery(
  mcpClient: Client,
  mcpServerName: string,
  mcpServerConfig: MCPServerConfig,
): Promise<Client> {
  const shouldTryDiscovery =
    (typeof mcpServerConfig.httpUrl === 'string' &&
      mcpServerConfig.httpUrl !== '') ||
    mcpServerConfig.oauth?.enabled === true;

  if (!shouldTryDiscovery) {
    await showAuthRequiredMessage(mcpServerName);
  }

  debugLogger.log(`Attempting OAuth discovery for '${mcpServerName}'...`);

  if (hasNetworkTransport(mcpServerConfig)) {
    return connectWithDiscoveredOAuth(
      mcpClient,
      mcpServerName,
      mcpServerConfig,
    );
  }

  debugLogger.error(
    `[ERROR] '${mcpServerName}' requires authentication but no OAuth configuration found`,
  );
  throw new Error(
    `MCP server '${mcpServerName}' requires authentication. Please configure OAuth or check server settings.`,
  );
}

async function connectWithDiscoveredOAuth(
  mcpClient: Client,
  mcpServerName: string,
  mcpServerConfig: MCPServerConfig,
): Promise<Client> {
  const serverUrl = new URL(mcpServerConfig.httpUrl ?? mcpServerConfig.url!);
  const baseUrl = `${serverUrl.protocol}//${serverUrl.host}`;

  try {
    const oauthConfig = await OAuthUtils.discoverOAuthConfig(baseUrl);
    if (oauthConfig) {
      debugLogger.log(
        `Discovered OAuth configuration from base URL for server '${mcpServerName}'`,
      );

      const oauthAuthConfig = {
        enabled: true,
        authorizationUrl: oauthConfig.authorizationUrl,
        tokenUrl: oauthConfig.tokenUrl,
        scopes: resolveDiscoveryScopes(oauthConfig.scopes),
      };

      const authServerUrl = mcpServerConfig.httpUrl ?? mcpServerConfig.url;
      debugLogger.log(
        `Starting OAuth authentication for server '${mcpServerName}'...`,
      );
      await MCPOAuthProvider.authenticate(
        mcpServerName,
        oauthAuthConfig,
        authServerUrl,
      );

      return await connectWithOAuthToken(
        mcpClient,
        mcpServerName,
        mcpServerConfig,
      );
    }

    debugLogger.error(
      `[ERROR] Could not configure OAuth for '${mcpServerName}' - please authenticate manually with /mcp auth ${mcpServerName}`,
    );
    throw new Error(
      `OAuth configuration failed for '${mcpServerName}'. Please authenticate manually with /mcp auth ${mcpServerName}`,
    );
  } catch (discoveryError) {
    debugLogger.error(
      `[ERROR] OAuth discovery failed for '${mcpServerName}' - please authenticate manually with /mcp auth ${mcpServerName}`,
    );
    throw discoveryError;
  }
}

async function trySSEFallback(
  mcpClient: Client,
  mcpServerName: string,
  mcpServerConfig: MCPServerConfig,
): Promise<Client | undefined> {
  debugLogger.log(
    `Initial connection failed for '${mcpServerName}', attempting SSE fallback`,
  );
  try {
    await connectWithSSETransport(mcpClient, mcpServerConfig);
    return mcpClient;
  } catch (fallbackError) {
    if (isAuthenticationError(fallbackError)) {
      mcpServerRequiresOAuth.set(mcpServerName, true);
      const storedToken = await getStoredOAuthToken(mcpServerName);
      if (storedToken) {
        await connectWithSSETransport(mcpClient, mcpServerConfig, storedToken);
        return mcpClient;
      }
      await showAuthRequiredMessage(mcpServerName);
    }
  }
  return undefined;
}

async function handleAuthenticationError(
  mcpClient: Client,
  mcpServerName: string,
  mcpServerConfig: MCPServerConfig,
  errorString: string,
): Promise<Client> {
  const shouldTriggerOAuth = mcpServerConfig.oauth?.enabled;
  if (shouldTriggerOAuth !== true) {
    await showAuthRequiredMessage(mcpServerName);
  }

  const wwwAuthenticate = await resolveWwwAuthenticateHeader(
    mcpServerName,
    mcpServerConfig,
    errorString,
  );

  if (wwwAuthenticate) {
    return retryWithWwwAuthenticate(
      mcpClient,
      mcpServerName,
      mcpServerConfig,
      wwwAuthenticate,
    );
  }

  return retryWithOAuthDiscovery(mcpClient, mcpServerName, mcpServerConfig);
}

async function handleConnectionError(
  mcpClient: Client,
  mcpServerName: string,
  mcpServerConfig: MCPServerConfig,
  error: unknown,
  httpReturned404: boolean,
): Promise<Client> {
  if (isAuthenticationError(error)) {
    mcpServerRequiresOAuth.set(mcpServerName, true);
    const storedToken = await getStoredOAuthToken(mcpServerName);
    if (storedToken) {
      await retryWithOAuth(
        mcpClient,
        mcpServerName,
        mcpServerConfig,
        storedToken,
        httpReturned404,
      );
      return mcpClient;
    }
    await showAuthRequiredMessage(mcpServerName);
  }

  if (
    !httpReturned404 &&
    hasNetworkTransport(mcpServerConfig) &&
    !mcpServerConfig.type &&
    mcpServerConfig.url
  ) {
    const sseResult = await trySSEFallback(
      mcpClient,
      mcpServerName,
      mcpServerConfig,
    );
    if (sseResult) {
      return sseResult;
    }
  }

  const errorString = String(error);
  if (isAuthenticationError(error) && hasNetworkTransport(mcpServerConfig)) {
    return handleAuthenticationError(
      mcpClient,
      mcpServerName,
      mcpServerConfig,
      errorString,
    );
  }

  return throwConnectionError(mcpServerName, error);
}

/**
 * Creates and connects an MCP client to a server based on the provided configuration.
 */
export async function connectToMcpServer(
  clientVersion: string,
  mcpServerName: string,
  mcpServerConfig: MCPServerConfig,
  debugMode: boolean,
  workspaceContext: WorkspaceContext,
): Promise<Client> {
  const mcpClient = initializeMcpClient(clientVersion, workspaceContext);

  let httpReturned404 = false;

  try {
    const transport = await createTransport(
      mcpServerName,
      mcpServerConfig,
      debugMode,
    );
    try {
      await mcpClient.connect(transport, {
        timeout: mcpServerConfig.timeout ?? MCP_DEFAULT_TIMEOUT_MSEC,
      });
      updateMCPServerStatus(mcpServerName, MCPServerStatus.CONNECTED);
      return mcpClient;
    } catch (error) {
      await transport.close();
      if (is404Error(error)) {
        httpReturned404 = true;
      }
      throw error;
    }
  } catch (error) {
    return handleConnectionError(
      mcpClient,
      mcpServerName,
      mcpServerConfig,
      error,
      httpReturned404,
    );
  }
}
