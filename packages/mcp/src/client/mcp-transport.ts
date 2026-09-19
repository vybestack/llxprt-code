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
import { AuthProviderType } from '@vybestack/llxprt-code-auth/mcp-auth-provider-type.js';
import type { MCPServerConfig } from '../config/mcpServerConfig.js';
import type { McpAuthProvider } from '../auth/auth-provider.js';
import { getRegisteredMcpAuthFactoryRegistry } from '../auth/mcp-auth-factory.js';
import { MCPOAuthProvider } from '../auth/oauth-provider.js';
import { MCPOAuthTokenStorage } from '../auth/oauth-token-storage.js';
import { DebugLogger } from '@vybestack/llxprt-code-telemetry/debug/index.js';

const debugLogger = DebugLogger.getLogger('llxprt:core:tools:mcp-client');

export const MCP_DEFAULT_TIMEOUT_MSEC = 10 * 60 * 1000; // default to 10 minutes

/** Supplies the Google auth provider types; installed as a runtime plugin. */
const GOOGLE_MCP_AUTH_PLUGIN_PACKAGE =
  '@vybestack/llxprt-plugin-google-mcp-auth';

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

function isGoogleAuthProviderType(authProviderType: string): boolean {
  return (
    authProviderType === AuthProviderType.GOOGLE_CREDENTIALS ||
    authProviderType === AuthProviderType.SERVICE_ACCOUNT_IMPERSONATION
  );
}

function unknownAuthProviderMessage(
  mcpServerName: string,
  authProviderType: string,
): string {
  const base =
    `MCP server '${mcpServerName}' selected authProviderType ` +
    `'${authProviderType}', but no auth provider is registered for it.`;
  if (isGoogleAuthProviderType(authProviderType)) {
    return (
      `${base} Install the '${GOOGLE_MCP_AUTH_PLUGIN_PACKAGE}' runtime ` +
      `plugin to provide it.`
    );
  }
  return `${base} Custom auth provider types are contributed by runtime plugins.`;
}

/**
 * Create an AuthProvider for the MCP Transport.
 *
 * Standard OAuth (no `authProviderType`, or `dynamic_discovery`) returns
 * undefined so the caller falls through to the built-in OAuth path. Any other
 * selected type is dispatched through the registered factory registry; an
 * unknown type or a failing factory is terminal — there is never a silent
 * fallback to standard OAuth.
 */
function createAuthProvider(
  mcpServerName: string,
  mcpServerConfig: MCPServerConfig,
): McpAuthProvider | undefined {
  const authProviderType = mcpServerConfig.authProviderType;
  if (
    authProviderType === undefined ||
    authProviderType === AuthProviderType.DYNAMIC_DISCOVERY
  ) {
    return undefined;
  }

  const factory =
    getRegisteredMcpAuthFactoryRegistry().getAuthProviderFactory(
      authProviderType,
    );
  if (factory === undefined) {
    throw new Error(
      unknownAuthProviderMessage(mcpServerName, authProviderType),
    );
  }

  try {
    return factory(mcpServerConfig);
  } catch (cause) {
    throw new Error(
      `MCP server '${mcpServerName}' failed to create its ` +
        `'${authProviderType}' auth provider: ${
          cause instanceof Error ? cause.message : String(cause)
        }`,
      { cause },
    );
  }
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

/**
 * Legacy no-URL error messages for the built-in Google auth provider types.
 * Keyed by string so custom plugin-contributed types fall through to the
 * generic message below.
 */
const LEGACY_NO_URL_MESSAGES: Readonly<Record<string, string | undefined>> = {
  [AuthProviderType.GOOGLE_CREDENTIALS]:
    'URL must be provided in the config for Google Credentials provider',
  [AuthProviderType.SERVICE_ACCOUNT_IMPERSONATION]:
    'No URL configured for ServiceAccountImpersonation MCP Server',
};

function validateNoUrlAuthProvider(mcpServerConfig: MCPServerConfig): void {
  const authProviderType = mcpServerConfig.authProviderType;
  if (
    authProviderType === undefined ||
    authProviderType === AuthProviderType.DYNAMIC_DISCOVERY
  ) {
    return;
  }
  const legacy = LEGACY_NO_URL_MESSAGES[authProviderType];
  if (legacy !== undefined) {
    throw new Error(legacy);
  }
  throw new Error(
    `URL must be provided in the config for authProviderType '${authProviderType}'`,
  );
}

async function resolveOAuthHeaders(
  mcpServerName: string,
  mcpServerConfig: MCPServerConfig,
): Promise<{
  headers: Record<string, string>;
  authProvider: McpAuthProvider | undefined;
}> {
  const authProvider = createAuthProvider(mcpServerName, mcpServerConfig);
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
