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
 * Per-server in-flight OAuth guard. Prevents duplicate concurrent browser
 * OAuth flows for the same server, which would otherwise each open a new
 * browser tab. The guard is scoped to interactive browser authentication only
 * (the `handleAutomaticOAuth` path); silent token read/refresh in
 * `getValidToken()` is unaffected.
 *
 * The key includes the server URL so that concurrent requests for different
 * URLs do not cross-contaminate each other. The www-authenticate header is
 * intentionally excluded because OAuth servers emit dynamic challenge fields
 * (realm, scope, nonce) that vary between requests for the same server,
 * which would prevent dedup if included.
 */
const inFlightAuthentications = new Map<string, Promise<boolean>>();

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

/**
 * Timeout for in-flight OAuth flows. If the user never completes the browser
 * authentication, the guard entry is cleaned up after this period so that
 * subsequent attempts can start a fresh flow rather than awaiting a promise
 * that will never settle.
 */
const OAUTH_FLOW_TIMEOUT_MS = 10 * 60 * 1000;

/**
 * Handle automatic OAuth discovery and authentication for a server.
 * Concurrent calls for the same server name reuse a single in-progress
 * authentication flow to avoid opening multiple browser tabs. If the flow
 * does not settle within {@link OAUTH_FLOW_TIMEOUT_MS}, the guard entry is
 * evicted so subsequent attempts can start a fresh flow.
 *
 * Note: if the timeout wins the race, the underlying browser OAuth flow
 * (`doHandleAutomaticOAuth`) is not cancelled — browser-based flows cannot
 * be reliably aborted from the Node.js side. The timed-out flow may still
 * complete in the background, but the in-flight guard is cleared so a
 * fresh attempt can proceed.
 */
export async function handleAutomaticOAuth(
  mcpServerName: string,
  mcpServerConfig: MCPServerConfig,
  wwwAuthenticate: string,
): Promise<boolean> {
  const guardKey = JSON.stringify([
    mcpServerName,
    mcpServerConfig.httpUrl ?? mcpServerConfig.url ?? '',
  ]);
  const existing = inFlightAuthentications.get(guardKey);
  if (existing) {
    debugLogger.log(
      `'${mcpServerName}' OAuth already in progress, reusing existing flow`,
    );
    return existing;
  }

  const authPromise = doHandleAutomaticOAuth(
    mcpServerName,
    mcpServerConfig,
    wwwAuthenticate,
  );

  // Mutable holder so the timeout closure (defined below) can check
  // promise identity without referencing `raced` before it is declared.
  const promiseRef: { current: Promise<boolean> | undefined } = {
    current: undefined,
  };

  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<boolean>((resolve) => {
    timeoutId = setTimeout(() => {
      debugLogger.warn(
        `OAuth flow for '${mcpServerName}' timed out after ${OAUTH_FLOW_TIMEOUT_MS}ms, clearing in-flight guard`,
      );
      if (inFlightAuthentications.get(guardKey) === promiseRef.current) {
        inFlightAuthentications.delete(guardKey);
      }
      resolve(false);
    }, OAUTH_FLOW_TIMEOUT_MS);
  });

  const raced = Promise.race([authPromise, timeoutPromise]).finally(() => {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
    if (inFlightAuthentications.get(guardKey) === promiseRef.current) {
      inFlightAuthentications.delete(guardKey);
    }
  });

  promiseRef.current = raced;
  inFlightAuthentications.set(guardKey, raced);
  return raced;
}

async function doHandleAutomaticOAuth(
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
