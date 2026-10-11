/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { EventEmitter } from 'node:events';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import type { MCPServerConfig } from '../config/index.js';
import {
  getErrorMessage,
  is404Error,
  UnauthorizedError,
} from '@vybestack/llxprt-code-tools/utils/errors.js';
import { awaitOAuthOperation } from '../auth/index.js';
import {
  connectClient,
  createJoiningTransport,
} from './mcp-connection-lifetime.js';
import { MCPOAuthProvider, type McpOAuthBinding } from '../auth/index.js';
import type { MCPOAuthConfig } from '../auth/index.js';
import type { MCPOAuthTokenStorage } from '../auth/index.js';
import { OAuthUtils } from '../auth/index.js';
import {
  captureHostFeedback,
  defaultFeedbackSink,
  type HostFeedbackSink,
} from '../host/hostServices.js';
import { DebugLogger } from '@vybestack/llxprt-code-telemetry/debug/index.js';
import {
  createSSETransportWithAuth,
  createTransportWithOAuth,
  getStoredOAuthToken,
  MCP_DEFAULT_TIMEOUT_MSEC,
} from './mcp-transport.js';
import { hasNetworkTransport } from './mcp-discovery-helpers.js';

const debugLogger = DebugLogger.getLogger('llxprt:core:tools:mcp-client');

/**
 * Server-side message fragments signalling that the SSE transport has been
 * deprecated in favour of Streamable HTTP (e.g. Webflow's `/sse` -> `/mcp`
 * migration). Multiple variants are matched to be robust across different
 * server implementations.
 */
const SSE_DEPRECATION_SIGNALS = [
  'sse is no longer supported',
  'sse endpoint is no longer supported',
  'the sse transport has been deprecated',
  'sse transport is no longer supported',
  'sse is deprecated',
];

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

function extractUrlAt(errorString: string, urlStart: number): string {
  let urlEnd = errorString.length;
  for (let i = urlStart; i < errorString.length; i++) {
    if (errorString.charCodeAt(i) <= 32) {
      urlEnd = i;
      break;
    }
  }

  const url = errorString.slice(urlStart, urlEnd);
  const hasQueryOrFragment = url.includes('?') || url.includes('#');
  let trimmedLength = url.length;
  while (trimmedLength > 0) {
    const lastCharacter = url.charAt(trimmedLength - 1);
    if (
      '.;:!?)]"\''.includes(lastCharacter) ||
      (!hasQueryOrFragment && lastCharacter === ',')
    ) {
      trimmedLength--;
    } else {
      break;
    }
  }
  return url.slice(0, trimmedLength);
}

function findUrlStarts(lower: string, start: number): number[] {
  const starts: number[] = [];
  let cursor = start;
  while (cursor < lower.length) {
    const httpIndex = lower.indexOf('http://', cursor);
    const httpsIndex = lower.indexOf('https://', cursor);
    const candidates = [httpIndex, httpsIndex].filter((index) => index !== -1);
    if (candidates.length === 0) break;
    const urlStart = Math.min(...candidates);
    starts.push(urlStart);
    cursor = urlStart + 1;
  }
  return starts;
}

/**
 * Detect deprecated SSE endpoint rejections (e.g. "SSE is no longer
 * supported, use https://mcp.example.com/mcp") and extract the suggested
 * replacement URL if present.
 *
 * @returns The suggested replacement URL, or an empty string if the
 * deprecation signal was detected but no URL was embedded, or null if no
 * deprecation signal was found.
 */
export function detectDeprecatedSSEEndpoint(
  errorString: string,
): string | null {
  const lower = errorString.toLowerCase();

  let signalEnd = -1;
  for (const signal of SSE_DEPRECATION_SIGNALS) {
    const idx = lower.indexOf(signal);
    if (idx !== -1) {
      signalEnd = Math.max(signalEnd, idx + signal.length);
    }
  }
  if (signalEnd === -1) return null;

  const urls = findUrlStarts(lower, signalEnd)
    .map((urlStart) => extractUrlAt(errorString, urlStart))
    .map((url) => {
      try {
        return { raw: url, parsed: new URL(url) };
      } catch {
        return undefined;
      }
    })
    .filter((url) => url !== undefined);
  if (urls.length === 0) return '';
  return (
    urls.find(({ parsed }) => {
      const pathname = parsed.pathname.endsWith('/')
        ? parsed.pathname.slice(0, -1)
        : parsed.pathname;
      return pathname.endsWith('/mcp');
    })?.raw ?? urls[0].raw
  );
}

export interface McpOAuthCapabilities {
  getAuthProviderFactory?: McpOAuthBinding['getAuthProviderFactory'];
  discover: typeof OAuthUtils.discoverOAuthConfig;
  tokenStorage: MCPOAuthTokenStorage;
  authenticate: (
    server: string,
    config: MCPOAuthConfig,
    url?: string,
    events?: EventEmitter,
    signal?: AbortSignal,
  ) => Promise<unknown>;
}

export class McpOAuthOperations {
  private readonly requests = new Map<
    string,
    {
      controller: AbortController;
      work: Promise<boolean>;
    }
  >();

  constructor(
    private readonly capabilities: McpOAuthCapabilities,
    private readonly timeoutMs = 10 * 60 * 1000,
  ) {}

  get getAuthProviderFactory(): McpOAuthBinding['getAuthProviderFactory'] {
    return this.capabilities.getAuthProviderFactory;
  }

  get tokenStorage(): MCPOAuthTokenStorage {
    return this.capabilities.tokenStorage;
  }

  authenticate(
    serverName: string,
    config: MCPServerConfig,
    challenge: string,
    signal?: AbortSignal,
  ): Promise<boolean> {
    signal?.throwIfAborted();
    const key = JSON.stringify([
      serverName,
      config.httpUrl ?? config.url ?? '',
    ]);
    const existing = this.requests.get(key);
    if (existing) return existing.work;

    const controller = new AbortController();
    const abort = (): void => controller.abort(signal?.reason);
    signal?.addEventListener('abort', abort, { once: true });
    let timedOut = false;
    const timeout = setTimeout(() => {
      if (controller.signal.aborted) return;
      timedOut = true;
      controller.abort(
        new DOMException('MCP OAuth authentication timed out', 'TimeoutError'),
      );
    }, this.timeoutMs);
    const work = doHandleAutomaticOAuth(
      serverName,
      config,
      challenge,
      this.capabilities,
      controller.signal,
    )
      .catch((error: unknown) => {
        if (timedOut) return false;
        throw error;
      })
      .finally(() => {
        clearTimeout(timeout);
        signal?.removeEventListener('abort', abort);
        this.requests.delete(key);
      });
    this.requests.set(key, { controller, work });
    return work;
  }

  async cancelAndJoin(): Promise<void> {
    const requests = [...this.requests.values()];
    for (const request of requests) request.controller.abort();
    await Promise.allSettled(requests.map(({ work }) => work));
  }
}

export async function handleAutomaticOAuth(
  mcpServerName: string,
  mcpServerConfig: MCPServerConfig,
  wwwAuthenticate: string,
  owner: McpOAuthOperations,
  signal?: AbortSignal,
): Promise<boolean> {
  return owner.authenticate(
    mcpServerName,
    mcpServerConfig,
    wwwAuthenticate,
    signal,
  );
}

async function doHandleAutomaticOAuth(
  mcpServerName: string,
  mcpServerConfig: MCPServerConfig,
  wwwAuthenticate: string,
  capabilities: McpOAuthCapabilities,
  signal: AbortSignal,
): Promise<boolean> {
  try {
    debugLogger.log(`🔐 '${mcpServerName}' requires OAuth authentication`);

    let oauthConfig;
    const resourceMetadataUri =
      OAuthUtils.parseWWWAuthenticateHeader(wwwAuthenticate);
    if (resourceMetadataUri) {
      oauthConfig = await capabilities.discover(resourceMetadataUri, signal);
    } else if (hasNetworkTransport(mcpServerConfig)) {
      const serverUrl = new URL(
        mcpServerConfig.httpUrl ?? mcpServerConfig.url!,
      );
      const baseUrl = `${serverUrl.protocol}//${serverUrl.host}`;
      oauthConfig = await capabilities.discover(baseUrl, signal);
    }

    signal.throwIfAborted();
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
    await capabilities.authenticate(
      mcpServerName,
      oauthAuthConfig,
      serverUrl,
      undefined,
      signal,
    );

    signal.throwIfAborted();
    debugLogger.log(
      `OAuth authentication successful for server '${mcpServerName}'`,
    );
    return true;
  } catch (error) {
    signal.throwIfAborted();
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
  signal?: AbortSignal,
): Promise<void> {
  const transport = createSSETransportWithAuth(config, accessToken, signal);
  await connectClient(
    client,
    transport,
    config.timeout ?? MCP_DEFAULT_TIMEOUT_MSEC,
    signal,
  );
}

/**
 * Checks for rejected stored token, emits feedback message, throws UnauthorizedError.
 */
export async function showAuthRequiredMessage(
  tokenStorage: MCPOAuthTokenStorage,
  serverName: string,
  signal?: AbortSignal,
  feedback: HostFeedbackSink = defaultFeedbackSink,
): Promise<never> {
  const storedToken = await getStoredOAuthToken(
    tokenStorage,
    serverName,
    signal,
  );
  let message: string;
  if (storedToken) {
    message = `Stored OAuth token for server '${serverName}' was rejected. Please re-authenticate using: /mcp auth ${serverName}`;
  } else {
    message = `Server '${serverName}' requires OAuth authentication. Please authenticate using: /mcp auth ${serverName}`;
  }
  captureHostFeedback(feedback)('error', message);
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
  signal?: AbortSignal,
): Promise<void> {
  if (httpReturned404) {
    await connectWithSSETransport(client, config, accessToken, signal);
    return;
  }

  const headers: Record<string, string> = {
    ...config.headers,
    Authorization: `Bearer ${accessToken}`,
  };

  if (config.type === 'sse') {
    await connectWithSSETransport(client, config, accessToken, signal);
    return;
  }

  try {
    const { StreamableHTTPClientTransport } = await import(
      '@modelcontextprotocol/sdk/client/streamableHttp.js'
    );
    const httpTransport = createJoiningTransport(
      (fetch) =>
        new StreamableHTTPClientTransport(
          new URL(config.httpUrl ?? config.url!),
          {
            ...{
              requestInit: { headers },
            },
            fetch,
          },
        ),
      signal,
    );
    await connectClient(
      client,
      httpTransport,
      config.timeout ?? MCP_DEFAULT_TIMEOUT_MSEC,
      signal,
    );
  } catch (httpError) {
    signal?.throwIfAborted();
    const is404 = is404Error(httpError);
    const shouldFallback: boolean =
      is404 && !config.type && Boolean(config.url && !config.httpUrl);

    if (shouldFallback) {
      debugLogger.log(
        `HTTP connection failed with 404 for '${serverName}', falling back to SSE with OAuth`,
      );
      await connectWithSSETransport(client, config, accessToken, signal);
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
  signal?: AbortSignal,
): Promise<string | null> {
  try {
    const urlToFetch = mcpServerConfig.httpUrl ?? mcpServerConfig.url!;
    const response = await awaitOAuthOperation(signal, () =>
      fetch(urlToFetch, {
        method: 'HEAD',
        headers: {
          Accept: mcpServerConfig.httpUrl
            ? 'application/json'
            : 'text/event-stream',
        },
        signal: signal
          ? AbortSignal.any([signal, AbortSignal.timeout(5000)])
          : AbortSignal.timeout(5000),
      }),
    );

    if (response.status === 401) {
      const header = response.headers.get('www-authenticate');
      if (header) {
        debugLogger.log(`Found www-authenticate header from server: ${header}`);
      }
      return header;
    }
  } catch (fetchError) {
    signal?.throwIfAborted();
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
  tokenStorage: MCPOAuthTokenStorage,
  mcpClient: Client,
  mcpServerName: string,
  mcpServerConfig: MCPServerConfig,
  signal?: AbortSignal,
): Promise<Client> {
  debugLogger.log(
    `Retrying connection to '${mcpServerName}' with OAuth token...`,
  );

  const credentials = await awaitOAuthOperation(signal, () =>
    tokenStorage.getCredentials(mcpServerName),
  );
  if (!credentials) {
    debugLogger.error(
      `Failed to get credentials for server '${mcpServerName}' after successful OAuth authentication`,
    );
    throw new Error(
      `Failed to get credentials for server '${mcpServerName}' after successful OAuth authentication`,
    );
  }

  const accessToken = await MCPOAuthProvider.getValidToken(
    tokenStorage,
    mcpServerName,
    {
      clientId: credentials.clientId,
    },
    signal,
  );
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
    signal,
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
    await connectClient(
      mcpClient,
      oauthTransport,
      mcpServerConfig.timeout ?? MCP_DEFAULT_TIMEOUT_MSEC,
      signal,
    );
    return mcpClient;
  } catch (retryError) {
    debugLogger.error(
      `Failed to connect with OAuth token: ${getErrorMessage(retryError)}`,
    );
    throw retryError;
  }
}

export function bindMcpOAuthCapabilities(
  binding: McpOAuthBinding,
): McpOAuthCapabilities {
  const { tokenStorage, openBrowser, getAuthProviderFactory } = binding;
  return {
    tokenStorage,
    getAuthProviderFactory,
    discover: OAuthUtils.discoverOAuthConfig.bind(OAuthUtils),
    authenticate: (server, config, url, events, signal) =>
      MCPOAuthProvider.authenticate(
        { tokenStorage, openBrowser },
        server,
        config,
        url,
        events,
        signal,
      ),
  };
}
