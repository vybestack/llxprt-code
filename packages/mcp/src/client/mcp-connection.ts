/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  defaultFeedbackSink,
  type HostFeedbackSink,
} from '../host/hostServices.js';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { ListRootsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import {
  abortError,
  closeTransport,
  closeAfterConnectionFailure,
  connectClient,
  joinConnectionOperation,
} from './mcp-connection-lifetime.js';
import type { MCPServerConfig } from '../config/index.js';
import type { McpWorkspaceContext } from '../host/hostInterfaces.js';

type Unsubscribe = () => void;
import {
  is404Error,
  isAuthenticationError,
} from '@vybestack/llxprt-code-tools/utils/errors.js';
import { DebugLogger } from '@vybestack/llxprt-code-telemetry/debug/index.js';
import { basename } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  createTransport,
  getStoredOAuthToken,
  MCP_DEFAULT_TIMEOUT_MSEC,
} from './mcp-transport.js';
import { LenientJsonSchemaValidator } from './mcp-schema-validator.js';
import {
  connectWithOAuthToken,
  connectWithSSETransport,
  detectDeprecatedSSEEndpoint,
  extractWWWAuthenticateHeader,
  fetchWwwAuthenticateHeader,
  handleAutomaticOAuth,
  type McpOAuthOperations,
  retryWithOAuth,
  showAuthRequiredMessage,
} from './mcp-oauth-helpers.js';
import { hasNetworkTransport } from './mcp-discovery-helpers.js';

const debugLogger = DebugLogger.getLogger('llxprt:core:tools:mcp-client');

function initializeMcpClient(
  clientVersion: string,
  workspaceContext: McpWorkspaceContext,
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

function throwConnectionError(
  mcpServerName: string,
  mcpServerConfig: MCPServerConfig,
  error: unknown,
): never {
  const errorMessage = (error as Error).message || String(error);

  const deprecatedUrl = hasNetworkTransport(mcpServerConfig)
    ? detectDeprecatedSSEEndpoint(errorMessage)
    : null;
  if (deprecatedUrl !== null) {
    const suggestedUrl =
      deprecatedUrl !== '' ? deprecatedUrl : '(check your MCP provider docs)';
    throw new Error(
      `MCP server '${mcpServerName}' is configured with an SSE endpoint that is no longer supported by the server.
The server recommends switching to a Streamable HTTP endpoint.
Update your configuration to use:
  "url": "${suggestedUrl}",
  "type": "streamable-http"
(or "type": "http") instead of the SSE endpoint.`,
    );
  }

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
  signal?: AbortSignal,
): Promise<string | null> {
  let wwwAuthenticate = extractWWWAuthenticateHeader(errorString);

  if (!wwwAuthenticate && hasNetworkTransport(mcpServerConfig)) {
    debugLogger.log(
      `No www-authenticate header in error, trying to fetch it from server...`,
    );
    wwwAuthenticate = await fetchWwwAuthenticateHeader(mcpServerConfig, signal);
  }

  return wwwAuthenticate;
}

async function retryWithWwwAuthenticate(
  mcpClient: Client,
  mcpServerName: string,
  mcpServerConfig: MCPServerConfig,
  wwwAuthenticate: string,
  owner: McpOAuthOperations,
  signal?: AbortSignal,
): Promise<Client> {
  debugLogger.log(
    `Received 401 with www-authenticate header: ${wwwAuthenticate}`,
  );

  const oauthSuccess = await handleAutomaticOAuth(
    mcpServerName,
    mcpServerConfig,
    wwwAuthenticate,
    owner,
    signal,
  );

  if (oauthSuccess) {
    return connectWithOAuthToken(
      owner.tokenStorage,
      mcpClient,
      mcpServerName,
      mcpServerConfig,
      signal,
    );
  }

  debugLogger.error(
    `Failed to handle automatic OAuth for server '${mcpServerName}'`,
  );
  throw new Error(
    `Failed to handle automatic OAuth for server '${mcpServerName}'`,
  );
}

async function retryWithOAuthDiscovery(
  mcpClient: Client,
  mcpServerName: string,
  mcpServerConfig: MCPServerConfig,
  owner: McpOAuthOperations,
  signal?: AbortSignal,
  feedback: HostFeedbackSink = defaultFeedbackSink,
): Promise<Client> {
  const shouldTryDiscovery =
    (typeof mcpServerConfig.httpUrl === 'string' &&
      mcpServerConfig.httpUrl !== '') ||
    mcpServerConfig.oauth?.enabled === true;

  if (!shouldTryDiscovery) {
    await showAuthRequiredMessage(
      owner.tokenStorage,
      mcpServerName,
      signal,
      feedback,
    );
  }

  debugLogger.log(`Attempting OAuth discovery for '${mcpServerName}'...`);

  if (hasNetworkTransport(mcpServerConfig)) {
    const oauthSuccess = await handleAutomaticOAuth(
      mcpServerName,
      mcpServerConfig,
      '',
      owner,
      signal,
    );
    if (oauthSuccess) {
      return connectWithOAuthToken(
        owner.tokenStorage,
        mcpClient,
        mcpServerName,
        mcpServerConfig,
        signal,
      );
    }
    throw new Error(
      `OAuth configuration failed for '${mcpServerName}'. Please authenticate manually with /mcp auth ${mcpServerName}`,
    );
  }

  debugLogger.error(
    `[ERROR] '${mcpServerName}' requires authentication but no OAuth configuration found`,
  );
  throw new Error(
    `MCP server '${mcpServerName}' requires authentication. Please configure OAuth or check server settings.`,
  );
}

async function trySSEFallback(
  owner: McpOAuthOperations,
  mcpClient: Client,
  mcpServerName: string,
  mcpServerConfig: MCPServerConfig,
  signal?: AbortSignal,
  feedback: HostFeedbackSink = defaultFeedbackSink,
  onRequiresOAuth?: () => void,
): Promise<Client | undefined> {
  debugLogger.log(
    `Initial connection failed for '${mcpServerName}', attempting SSE fallback`,
  );
  try {
    await connectWithSSETransport(
      mcpClient,
      mcpServerConfig,
      undefined,
      signal,
    );
    return mcpClient;
  } catch (fallbackError) {
    signal?.throwIfAborted();
    if (isAuthenticationError(fallbackError)) {
      onRequiresOAuth?.();
      const storedToken = await getStoredOAuthToken(
        owner.tokenStorage,
        mcpServerName,
        signal,
      );
      if (storedToken) {
        await connectWithSSETransport(
          mcpClient,
          mcpServerConfig,
          storedToken,
          signal,
        );
        return mcpClient;
      }
      await showAuthRequiredMessage(
        owner.tokenStorage,
        mcpServerName,
        signal,
        feedback,
      );
    }
  }
  return undefined;
}

async function handleAuthenticationError(
  mcpClient: Client,
  mcpServerName: string,
  mcpServerConfig: MCPServerConfig,
  errorString: string,
  owner: McpOAuthOperations,
  signal?: AbortSignal,
  feedback: HostFeedbackSink = defaultFeedbackSink,
): Promise<Client> {
  const shouldTriggerOAuth = mcpServerConfig.oauth?.enabled;
  if (shouldTriggerOAuth !== true) {
    await showAuthRequiredMessage(
      owner.tokenStorage,
      mcpServerName,
      signal,
      feedback,
    );
  }

  const wwwAuthenticate = await resolveWwwAuthenticateHeader(
    mcpServerName,
    mcpServerConfig,
    errorString,
    signal,
  );

  if (wwwAuthenticate) {
    return retryWithWwwAuthenticate(
      mcpClient,
      mcpServerName,
      mcpServerConfig,
      wwwAuthenticate,
      owner,
      signal,
    );
  }

  return retryWithOAuthDiscovery(
    mcpClient,
    mcpServerName,
    mcpServerConfig,
    owner,
    signal,
    feedback,
  );
}

async function handleConnectionError(
  mcpClient: Client,
  mcpServerName: string,
  mcpServerConfig: MCPServerConfig,
  error: unknown,
  httpReturned404: boolean,
  owner: McpOAuthOperations,
  signal?: AbortSignal,
  feedback: HostFeedbackSink = defaultFeedbackSink,
  onRequiresOAuth?: () => void,
): Promise<Client> {
  signal?.throwIfAborted();
  if (isAuthenticationError(error)) {
    onRequiresOAuth?.();
    const storedToken = await getStoredOAuthToken(
      owner.tokenStorage,
      mcpServerName,
      signal,
    );
    if (storedToken) {
      await retryWithOAuth(
        mcpClient,
        mcpServerName,
        mcpServerConfig,
        storedToken,
        httpReturned404,
        signal,
      );
      return mcpClient;
    }
    await showAuthRequiredMessage(
      owner.tokenStorage,
      mcpServerName,
      signal,
      feedback,
    );
  }

  if (
    !httpReturned404 &&
    hasNetworkTransport(mcpServerConfig) &&
    !mcpServerConfig.type &&
    mcpServerConfig.url
  ) {
    const sseResult = await trySSEFallback(
      owner,
      mcpClient,
      mcpServerName,
      mcpServerConfig,
      signal,
      feedback,
      onRequiresOAuth,
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
      owner,
      signal,
      feedback,
    );
  }

  return throwConnectionError(mcpServerName, mcpServerConfig, error);
}

/**
 * Creates and connects an MCP client to a server based on the provided configuration.
 */
async function connectToMcpServerOperation(
  clientVersion: string,
  mcpServerName: string,
  mcpServerConfig: MCPServerConfig,
  debugMode: boolean,
  workspaceContext: McpWorkspaceContext,
  owner: McpOAuthOperations,
  signal?: AbortSignal,
  feedback: HostFeedbackSink = defaultFeedbackSink,
  onRequiresOAuth?: () => void,
): Promise<Client> {
  const mcpClient = initializeMcpClient(clientVersion, workspaceContext);

  let httpReturned404 = false;

  try {
    const transportPromise = createTransport(
      owner.tokenStorage,
      mcpServerName,
      mcpServerConfig,
      debugMode,
      signal,
      owner.getAuthProviderFactory,
    );
    const transport =
      signal !== undefined
        ? await joinConnectionOperation(
            transportPromise,
            signal,
            closeTransport,
          )
        : await transportPromise;
    try {
      await connectClient(
        mcpClient,
        transport,
        mcpServerConfig.timeout ?? MCP_DEFAULT_TIMEOUT_MSEC,
        signal,
      );
      return mcpClient;
    } catch (error) {
      if (signal?.aborted !== true && is404Error(error)) {
        httpReturned404 = true;
      }
      throw error;
    }
  } catch (error) {
    if (signal?.aborted === true) {
      await closeAfterConnectionFailure(() => mcpClient.close());
      if (error instanceof DOMException && error.name === 'AbortError') {
        throw error;
      }
      throw abortError(error);
    }
    const recoveryPromise = handleConnectionError(
      mcpClient,
      mcpServerName,
      mcpServerConfig,
      error,
      httpReturned404,
      owner,
      signal,
      feedback,
      onRequiresOAuth,
    );
    return signal !== undefined
      ? joinConnectionOperation(
          recoveryPromise,
          signal,
          () => mcpClient.close(),
          () => mcpClient.close(),
        )
      : recoveryPromise;
  }
}

export async function connectToMcpServer(
  clientVersion: string,
  mcpServerName: string,
  mcpServerConfig: MCPServerConfig,
  debugMode: boolean,
  workspaceContext: McpWorkspaceContext,
  owner: McpOAuthOperations,
  signal?: AbortSignal,
  feedback: HostFeedbackSink = defaultFeedbackSink,
  onRequiresOAuth?: () => void,
): Promise<Client> {
  const controller = new AbortController();
  const timeoutMs = mcpServerConfig.timeout ?? MCP_DEFAULT_TIMEOUT_MSEC;
  const timeoutError = McpError.fromError(
    ErrorCode.RequestTimeout,
    'Request timed out',
    { timeout: timeoutMs },
  );
  const timer = setTimeout(() => controller.abort(timeoutError), timeoutMs);
  const requestSignal = signal
    ? AbortSignal.any([signal, controller.signal])
    : controller.signal;
  try {
    return await connectToMcpServerOperation(
      clientVersion,
      mcpServerName,
      mcpServerConfig,
      debugMode,
      workspaceContext,
      owner,
      requestSignal,
      feedback,
      onRequiresOAuth,
    );
  } catch (error) {
    if (requestSignal.reason === timeoutError) throw timeoutError;
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
