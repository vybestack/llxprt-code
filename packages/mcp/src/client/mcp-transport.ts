/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { SSEClientTransportOptions } from '@modelcontextprotocol/sdk/client/sse.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import type { StreamableHTTPClientTransportOptions } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { AuthProviderType } from '@vybestack/llxprt-code-core/config/configTypes.js';
import type { MCPServerConfig } from '@vybestack/llxprt-code-core/config/configTypes.js';
import { GoogleCredentialProvider } from '../auth/google-auth-provider.js';
import { ServiceAccountImpersonationProvider } from '../auth/sa-impersonation-provider.js';
import type { McpAuthProvider } from '../auth/auth-provider.js';
import { MCPOAuthProvider } from '../auth/oauth-provider.js';
import { MCPOAuthTokenStorage } from '../auth/oauth-token-storage.js';
import { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';

const debugLogger = DebugLogger.getLogger('llxprt:core:tools:mcp-client');

export const MCP_DEFAULT_TIMEOUT_MSEC = 10 * 60 * 1000; // default to 10 minutes

/**
 * Create RequestInit for TransportOptions.
 */
function createTransportRequestInit(
  mcpServerConfig: MCPServerConfig,
  headers: Record<string, string>,
): RequestInit {
  return {
    headers: {
      ...mcpServerConfig.headers,
      ...headers,
    },
  };
}

/**
 * Create an AuthProvider for the MCP Transport.
 */
function createAuthProvider(
  mcpServerConfig: MCPServerConfig,
): McpAuthProvider | undefined {
  if (
    mcpServerConfig.authProviderType ===
    AuthProviderType.SERVICE_ACCOUNT_IMPERSONATION
  ) {
    return new ServiceAccountImpersonationProvider(mcpServerConfig);
  }
  if (
    mcpServerConfig.authProviderType === AuthProviderType.GOOGLE_CREDENTIALS
  ) {
    return new GoogleCredentialProvider(mcpServerConfig);
  }
  return undefined;
}

/**
 * Create a transport for URL based servers (remote servers).
 */
function createUrlTransport(
  mcpServerName: string,
  mcpServerConfig: MCPServerConfig,
  transportOptions:
    | StreamableHTTPClientTransportOptions
    | SSEClientTransportOptions,
): StreamableHTTPClientTransport | SSEClientTransport {
  // Priority 1: httpUrl (deprecated)
  if (mcpServerConfig.httpUrl) {
    if (mcpServerConfig.url) {
      debugLogger.warn(
        `MCP server '${mcpServerName}': Both 'httpUrl' and 'url' are configured. ` +
          `Using deprecated 'httpUrl'. Please migrate to 'url' with 'type: "http"'.`,
      );
    }
    return new StreamableHTTPClientTransport(
      new URL(mcpServerConfig.httpUrl),
      transportOptions,
    );
  }

  // Priority 2 & 3: url with explicit type
  if (mcpServerConfig.url && mcpServerConfig.type) {
    if (mcpServerConfig.type === 'sse') {
      return new SSEClientTransport(
        new URL(mcpServerConfig.url),
        transportOptions,
      );
    }
    return new StreamableHTTPClientTransport(
      new URL(mcpServerConfig.url),
      transportOptions,
    );
  }

  // Priority 4: url without type (default to HTTP)
  if (mcpServerConfig.url) {
    return new StreamableHTTPClientTransport(
      new URL(mcpServerConfig.url),
      transportOptions,
    );
  }

  throw new Error(`No URL configured for MCP server '${mcpServerName}'`);
}

/**
 * Create a transport with OAuth token for the given server configuration.
 */
export async function createTransportWithOAuth(
  mcpServerName: string,
  mcpServerConfig: MCPServerConfig,
  accessToken: string,
): Promise<StreamableHTTPClientTransport | SSEClientTransport | null> {
  try {
    const headers: Record<string, string> = {
      ...mcpServerConfig.headers,
      Authorization: `Bearer ${accessToken}`,
    };

    const transportOptions:
      | StreamableHTTPClientTransportOptions
      | SSEClientTransportOptions = {
      requestInit: { headers },
    };

    if (mcpServerConfig.httpUrl) {
      return new StreamableHTTPClientTransport(
        new URL(mcpServerConfig.httpUrl),
        transportOptions,
      );
    }

    if (mcpServerConfig.url && mcpServerConfig.type) {
      if (mcpServerConfig.type === 'sse') {
        return new SSEClientTransport(
          new URL(mcpServerConfig.url),
          transportOptions,
        );
      }
      return new StreamableHTTPClientTransport(
        new URL(mcpServerConfig.url),
        transportOptions,
      );
    }

    if (mcpServerConfig.url) {
      return new StreamableHTTPClientTransport(
        new URL(mcpServerConfig.url),
        transportOptions,
      );
    }

    throw new Error(`No URL configured for MCP server '${mcpServerName}'`);
  } catch (error) {
    debugLogger.error(
      `Failed to create OAuth transport for server '${mcpServerName}': ${error instanceof Error ? error.message : String(error)}`,
    );
    return null;
  }
}

/**
 * Get stored OAuth token for a server.
 */
export async function getStoredOAuthToken(
  serverName: string,
): Promise<string | null> {
  const tokenStorage = new MCPOAuthTokenStorage();
  const credentials = await tokenStorage.getCredentials(serverName);
  if (!credentials) return null;
  return MCPOAuthProvider.getValidToken(serverName, {
    clientId: credentials.clientId,
  });
}

/**
 * Create an SSE transport with optional OAuth Bearer token in headers.
 */
export function createSSETransportWithAuth(
  config: MCPServerConfig,
  accessToken?: string | null,
): SSEClientTransport {
  const headers: Record<string, string> = {
    ...config.headers,
  };
  if (accessToken) {
    headers['Authorization'] = `Bearer ${accessToken}`;
  }
  const url = config.httpUrl ?? config.url!;
  return new SSEClientTransport(new URL(url), {
    requestInit: { headers },
  });
}

function validateNoUrlAuthProvider(mcpServerConfig: MCPServerConfig): void {
  if (
    mcpServerConfig.authProviderType === AuthProviderType.GOOGLE_CREDENTIALS
  ) {
    throw new Error(
      `URL must be provided in the config for Google Credentials provider`,
    );
  }
  if (
    mcpServerConfig.authProviderType ===
    AuthProviderType.SERVICE_ACCOUNT_IMPERSONATION
  ) {
    throw new Error(
      `No URL configured for ServiceAccountImpersonation MCP Server`,
    );
  }
}

async function resolveOAuthHeaders(
  mcpServerName: string,
  mcpServerConfig: MCPServerConfig,
): Promise<{
  headers: Record<string, string>;
  authProvider: McpAuthProvider | undefined;
}> {
  const authProvider = createAuthProvider(mcpServerConfig);
  const headers: Record<string, string> =
    (await authProvider?.getRequestHeaders?.()) ?? {};

  if (authProvider !== undefined) {
    return { headers, authProvider };
  }

  const oauthResult = await resolveAccessToken(mcpServerName, mcpServerConfig);
  if (oauthResult.hasOAuthConfig && oauthResult.accessToken) {
    headers['Authorization'] = `Bearer ${oauthResult.accessToken}`;
  }

  return { headers, authProvider: undefined };
}

async function resolveAccessToken(
  mcpServerName: string,
  mcpServerConfig: MCPServerConfig,
): Promise<{ accessToken: string | null; hasOAuthConfig: boolean }> {
  let accessToken: string | null = null;
  let hasOAuthConfig: boolean = mcpServerConfig.oauth?.enabled === true;

  if (hasOAuthConfig && mcpServerConfig.oauth) {
    accessToken = await MCPOAuthProvider.getValidToken(
      mcpServerName,
      mcpServerConfig.oauth,
    );

    if (
      accessToken === null ||
      (accessToken as string | undefined) === undefined ||
      accessToken === ''
    ) {
      throw new Error(
        `MCP server '${mcpServerName}' requires OAuth authentication. ` +
          `Please authenticate using the /mcp auth command.`,
      );
    }
  } else {
    const tokenStorage = new MCPOAuthTokenStorage();
    const credentials = await tokenStorage.getCredentials(mcpServerName);

    if (credentials) {
      accessToken = await MCPOAuthProvider.getValidToken(mcpServerName, {
        clientId: credentials.clientId,
      });

      if (
        accessToken !== null &&
        (accessToken as string | undefined) !== undefined &&
        accessToken !== ''
      ) {
        hasOAuthConfig = true;
        debugLogger.log(
          `Found stored OAuth token for server '${mcpServerName}'`,
        );
      }
    }
  }

  return { accessToken, hasOAuthConfig };
}

async function createUrlBasedTransport(
  mcpServerName: string,
  mcpServerConfig: MCPServerConfig,
): Promise<Transport> {
  const { headers, authProvider } = await resolveOAuthHeaders(
    mcpServerName,
    mcpServerConfig,
  );

  const transportOptions:
    | StreamableHTTPClientTransportOptions
    | SSEClientTransportOptions = {
    authProvider,
    requestInit: createTransportRequestInit(mcpServerConfig, headers),
  };

  return createUrlTransport(mcpServerName, mcpServerConfig, transportOptions);
}

/**
 * Creates an MCP transport (Stdio, SSE, or Streamable HTTP) from server config.
 * Visible for Testing.
 */
export async function createTransport(
  mcpServerName: string,
  mcpServerConfig: MCPServerConfig,
  debugMode: boolean,
): Promise<Transport> {
  const noUrl = !mcpServerConfig.url && !mcpServerConfig.httpUrl;
  if (noUrl) {
    validateNoUrlAuthProvider(mcpServerConfig);
  }

  if (mcpServerConfig.httpUrl || mcpServerConfig.url) {
    return createUrlBasedTransport(mcpServerName, mcpServerConfig);
  }

  if (mcpServerConfig.command) {
    const transport = new StdioClientTransport({
      command: mcpServerConfig.command,
      args: mcpServerConfig.args ?? [],
      env: {
        ...process.env,
        ...mcpServerConfig.env,
      } as Record<string, string>,
      cwd: mcpServerConfig.cwd,
      stderr: 'pipe',
    });
    if (debugMode) {
      transport.stderr!.on('data', (data) => {
        const stderrStr = data.toString().trim();
        debugLogger.debug(
          `[DEBUG] [MCP STDERR (${mcpServerName})]: `,
          stderrStr,
        );
      });
    }
    return transport;
  }

  throw new Error(
    `Invalid configuration: missing httpUrl (for Streamable HTTP), url (for SSE), and command (for stdio).`,
  );
}
