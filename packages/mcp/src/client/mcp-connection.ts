/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { ListRootsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { MCPServerConfig } from '../config/mcpServerConfig.js';
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
  detectDeprecatedSSEEndpoint,
  extractWWWAuthenticateHeader,
  fetchWwwAuthenticateHeader,
  handleAutomaticOAuth,
  retryWithOAuth,
  showAuthRequiredMessage,
} from './mcp-oauth-helpers.js';
import { hasNetworkTransport } from './mcp-discovery-helpers.js';

const debugLogger = DebugLogger.getLogger('llxprt:core:tools:mcp-client');

function abortError(cause?: unknown): DOMException {
  const error = new DOMException('MCP connection was cancelled', 'AbortError');
  if (cause !== undefined) {
    Object.defineProperty(error, 'cause', {
      configurable: true,
      enumerable: false,
      value: cause,
      writable: true,
    });
  }
  return error;
}

function isAbortError(error: unknown): error is DOMException {
  return error instanceof DOMException && error.name === 'AbortError';
}

function closeTransport(transport?: Transport): Promise<void> {
  return typeof transport?.close === 'function'
    ? transport.close()
    : Promise.resolve();
}

/**
 * Races an operation against cancellation while ensuring its cleanup path runs
 * at most once, including when abort and promise settlement happen together.
 */
function abortable<T>(
  promise: Promise<T>,
  signal: AbortSignal,
  cleanup: (value: T) => void | Promise<void>,
  cleanupOnAbort?: () => void | Promise<void>,
): Promise<T> {
  let cleanupPromise: Promise<void> | undefined;
  let cancellationCause: unknown;
  const runCleanup = (
    cleanupOperation: () => void | Promise<void>,
  ): Promise<void> => {
    cleanupPromise ??= Promise.resolve()
      .then(cleanupOperation)
      .catch((error: unknown) => {
        debugLogger.warn('MCP cancellation cleanup failed:', error);
      });
    return cleanupPromise;
  };
  const cleanupResolvedValue = (value: T): Promise<void> =>
    runCleanup(() => cleanup(value));
  const cleanupAfterAbort = (): Promise<void> => {
    if (cleanupOnAbort !== undefined) {
      return runCleanup(cleanupOnAbort);
    }
    void promise.then(cleanupResolvedValue, () => {});
    return Promise.resolve();
  };
  if (signal.aborted) {
    return cleanupAfterAbort().then(() => Promise.reject(abortError()));
  }

  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      void cleanupAfterAbort().then(() =>
        reject(abortError(cancellationCause)),
      );
    };
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        if (signal.aborted) {
          void cleanupResolvedValue(value).then(() => reject(abortError()));
        } else {
          resolve(value);
        }
      },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort);
        if (signal.aborted) {
          cancellationCause = error;
          void cleanupAfterAbort().then(() => reject(abortError(error)));
        } else {
          reject(error);
        }
      },
    );
  });
}

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
    const oauthSuccess = await handleAutomaticOAuth(
      mcpServerName,
      mcpServerConfig,
      '',
    );
    if (oauthSuccess) {
      return connectWithOAuthToken(mcpClient, mcpServerName, mcpServerConfig);
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

  return throwConnectionError(mcpServerName, mcpServerConfig, error);
}

async function closeAfterConnectionFailure(
  close: () => Promise<void>,
): Promise<void> {
  try {
    await close();
  } catch (cleanupError) {
    debugLogger.warn('MCP transport cleanup failed:', cleanupError);
  }
}

async function connectClient(
  mcpClient: Client,
  transport: Transport,
  timeout: number,
  signal?: AbortSignal,
): Promise<void> {
  let transportClosed = false;
  const closeConnectedTransport = async (): Promise<void> => {
    if (transportClosed) {
      return;
    }
    transportClosed = true;
    await closeTransport(transport);
  };
  try {
    const connection = Promise.resolve(
      mcpClient.connect(transport, { timeout }),
    );
    if (signal === undefined) {
      await connection;
    } else {
      await abortable(
        connection,
        signal,
        closeConnectedTransport,
        closeConnectedTransport,
      );
    }
  } catch (error) {
    await closeAfterConnectionFailure(closeConnectedTransport);
    throw error;
  }
}

/**
 * Creates and connects an MCP client to a server based on the provided configuration.
 */
export async function connectToMcpServer(
  clientVersion: string,
  mcpServerName: string,
  mcpServerConfig: MCPServerConfig,
  debugMode: boolean,
  workspaceContext: McpWorkspaceContext,
  signal?: AbortSignal,
): Promise<Client> {
  const mcpClient = initializeMcpClient(clientVersion, workspaceContext);

  let httpReturned404 = false;

  try {
    const transportPromise = createTransport(
      mcpServerName,
      mcpServerConfig,
      debugMode,
    );
    const transport =
      signal !== undefined
        ? await abortable(transportPromise, signal, closeTransport)
        : await transportPromise;
    try {
      await connectClient(
        mcpClient,
        transport,
        mcpServerConfig.timeout ?? MCP_DEFAULT_TIMEOUT_MSEC,
        signal,
      );
      updateMCPServerStatus(mcpServerName, MCPServerStatus.CONNECTED);
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
      if (isAbortError(error)) {
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
    );
    return signal !== undefined
      ? abortable(
          recoveryPromise,
          signal,
          () => mcpClient.close(),
          () => mcpClient.close(),
        )
      : recoveryPromise;
  }
}
