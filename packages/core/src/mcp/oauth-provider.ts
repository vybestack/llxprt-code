/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/* eslint-disable complexity, sonarjs/cognitive-complexity -- Phase 5: legacy core boundary retained while larger decomposition continues. */

import * as http from 'node:http';
import * as crypto from 'node:crypto';
import type * as net from 'node:net';
import { URL } from 'node:url';
import type { EventEmitter } from 'node:events';
import { openBrowserSecurely } from '../utils/secure-browser-launcher.js';
import {
  type MCPOAuthToken,
  MCPOAuthTokenStorage,
} from './oauth-token-storage.js';
import { getErrorMessage } from '../utils/errors.js';
import { OAuthUtils, ResourceMismatchError } from './oauth-utils.js';
import { DebugLogger } from '../debug/DebugLogger.js';

const debugLogger = new DebugLogger('llxprt:mcp:oauth');

export const OAUTH_DISPLAY_MESSAGE_EVENT = 'oauth-display-message' as const;

/**
 * OAuth configuration for an MCP server.
 */
export interface MCPOAuthConfig {
  enabled?: boolean; // Whether OAuth is enabled for this server
  clientId?: string;
  clientSecret?: string;
  authorizationUrl?: string;
  tokenUrl?: string;
  scopes?: string[];
  audiences?: string[];
  redirectUri?: string;
  tokenParamName?: string; // For SSE connections, specifies the query parameter name for the token
  registrationUrl?: string;
}

/**
 * OAuth authorization response.
 */
export interface OAuthAuthorizationResponse {
  code: string;
  state: string;
}

/**
 * OAuth token response from the authorization server.
 */
export interface OAuthTokenResponse {
  access_token: string;
  token_type: string;
  expires_in?: number;
  refresh_token?: string;
  scope?: string;
}

/**
 * Dynamic client registration request (RFC 7591).
 */
export interface OAuthClientRegistrationRequest {
  client_name: string;
  redirect_uris: string[];
  grant_types: string[];
  response_types: string[];
  token_endpoint_auth_method: string;
  scope?: string;
}

/**
 * Dynamic client registration response (RFC 7591).
 */
export interface OAuthClientRegistrationResponse {
  client_id: string;
  client_secret?: string;
  client_id_issued_at?: number;
  client_secret_expires_at?: number;
  redirect_uris: string[];
  grant_types: string[];
  response_types: string[];
  token_endpoint_auth_method: string;
  scope?: string;
}

/**
 * PKCE (Proof Key for Code Exchange) parameters.
 */
interface PKCEParams {
  codeVerifier: string;
  codeChallenge: string;
  state: string;
}

const REDIRECT_PATH = '/oauth/callback';
const HTTP_OK = 200;

async function applyWWWAuthenticateDiscovery(
  wwwAuthenticate: string,
  mcpServerUrl: string,
  config: MCPOAuthConfig,
): Promise<MCPOAuthConfig> {
  const discoveredConfig = await OAuthUtils.discoverOAuthFromWWWAuthenticate(
    wwwAuthenticate,
    mcpServerUrl,
  );
  if (!discoveredConfig) {
    return config;
  }
  return {
    ...config,
    authorizationUrl: discoveredConfig.authorizationUrl,
    tokenUrl: discoveredConfig.tokenUrl,
    scopes: config.scopes ?? discoveredConfig.scopes ?? [],
    clientId: config.clientId,
    clientSecret: config.clientSecret,
  };
}

async function applyAuthenticateHeaderDiscovery(
  response: Response,
  mcpServerUrl: string,
  config: MCPOAuthConfig,
): Promise<MCPOAuthConfig> {
  const wwwAuthenticate = response.headers.get('www-authenticate');
  if (wwwAuthenticate === null || wwwAuthenticate === '') {
    return config;
  }
  return applyWWWAuthenticateDiscovery(wwwAuthenticate, mcpServerUrl, config);
}

/**
 * Parse an error message from a form-urlencoded token response body.
 * Returns null if no error can be extracted.
 */
function parseTokenErrorResponse(
  responseText: string,
  action: string,
): string | null {
  try {
    const errorParams = new URLSearchParams(responseText);
    const error = errorParams.get('error');
    const errorDescription = errorParams.get('error_description');
    if (error) {
      // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- intentional falsy coalescing: empty string errorDescription should fall back to 'No description'
      return `${action}: ${error} - ${errorDescription || 'No description'}`;
    }
  } catch {
    // Fall back to raw error
  }
  return null;
}

/**
 * Parse a token response that may be JSON or form-urlencoded.
 * Throws on missing access_token.
 */
function parseTokenResponse(
  responseText: string,
  contentType: string,
  action: string,
  unexpectedContentTypeLabel = 'Token endpoint',
  missingTokenError = 'no_access_token',
): OAuthTokenResponse {
  // Log unexpected content types for debugging
  if (
    !contentType.includes('application/json') &&
    !contentType.includes('application/x-www-form-urlencoded')
  ) {
    debugLogger.warn(
      `${unexpectedContentTypeLabel} returned unexpected content-type: ${contentType}. ` +
        `Expected application/json or application/x-www-form-urlencoded. ` +
        `Will attempt to parse response.`,
    );
  }

  try {
    return JSON.parse(responseText) as OAuthTokenResponse;
  } catch {
    // Parse form-urlencoded response
    const tokenParams = new URLSearchParams(responseText);
    const accessToken = tokenParams.get('access_token');
    // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- intentional falsy coalescing: empty string token_type is invalid, default to Bearer
    const tokenType = tokenParams.get('token_type') || 'Bearer';
    const expiresIn = tokenParams.get('expires_in');
    const refreshToken = tokenParams.get('refresh_token');
    const scope = tokenParams.get('scope');

    if (!accessToken) {
      const error = tokenParams.get('error');
      const errorDescription = tokenParams.get('error_description');
      throw new Error(
        // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- intentional falsy coalescing: empty string error uses action-specific fallback
        `${action}: ${error || missingTokenError} - ${errorDescription || responseText}`,
      );
    }

    return {
      access_token: accessToken,
      token_type: tokenType,
      expires_in: expiresIn ? parseInt(expiresIn, 10) : undefined,
      // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- intentional falsy coalescing: empty string refresh_token means "not provided"
      refresh_token: refreshToken || undefined,
      // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- intentional falsy coalescing: empty string scope means "not provided"
      scope: scope || undefined,
    } as OAuthTokenResponse;
  }
}

/**
 * Resolve the listen port from env var, explicit argument, or OS-assigned default.
 * Returns the port number or throws if the env var value is invalid.
 */
function resolveListenPort(
  port: number | undefined,
  portReject: (error: Error) => void,
  reject: (error: Error) => void,
): number {
  let listenPort = 0;
  const portStr = process.env['OAUTH_CALLBACK_PORT'];
  if (portStr) {
    const envPort = parseInt(portStr, 10);
    if (isNaN(envPort) || envPort <= 0 || envPort > 65535) {
      const error = new Error(
        `Invalid value for OAUTH_CALLBACK_PORT: "${portStr}"`,
      );
      portReject(error);
      reject(error);
      throw error;
    }
    listenPort = envPort;
  } else if (port !== undefined) {
    listenPort = port;
  }
  return listenPort;
}

/**
 * Handle an incoming OAuth callback request.
 * Validates the state, extracts the auth code, and sends a response to the browser.
 */
async function handleOAuthCallback(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  serverPort: number,
  expectedState: string,
  server: http.Server,
  resolve: (value: OAuthAuthorizationResponse) => void,
  reject: (reason: unknown) => void,
): Promise<void> {
  try {
    const url = new URL(req.url!, `http://localhost:${serverPort}`);

    if (url.pathname !== REDIRECT_PATH) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }

    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');
    const error = url.searchParams.get('error');

    if (error) {
      res.writeHead(HTTP_OK, { 'Content-Type': 'text/html' });
      res.end(`
              <html>
                <body>
                  <h1>Authentication Failed</h1>
                  <p>Error: ${error.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</p>
                  <p>${(url.searchParams.get('error_description') ?? '').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</p>
                  <p>You can close this window.</p>
                </body>
              </html>
            `);
      server.close();
      reject(new Error(`OAuth error: ${error}`));
      return;
    }

    if (!code || !state) {
      res.writeHead(400);
      res.end('Missing code or state parameter');
      return;
    }

    if (state !== expectedState) {
      res.writeHead(400);
      res.end('Invalid state parameter');
      server.close();
      reject(new Error('State mismatch - possible CSRF attack'));
      return;
    }

    res.writeHead(HTTP_OK, { 'Content-Type': 'text/html' });
    res.end(`
            <html>
              <body>
                <h1>Authentication Successful!</h1>
                <p>You can close this window and return to LLxprt Code.</p>
                <script>window.close();</script>
              </body>
            </html>
          `);

    server.close();
    resolve({ code, state });
  } catch (error) {
    server.close();
    reject(error);
  }
}

/**
 * Provider for handling OAuth authentication for MCP servers.
 */
export class MCPOAuthProvider {
  /**
   * Register a client dynamically with the OAuth server.
   */
  private static async registerClient(
    registrationUrl: string,
    config: MCPOAuthConfig,
    redirectPort: number,
  ): Promise<OAuthClientRegistrationResponse> {
    const redirectUri =
      config.redirectUri ?? `http://localhost:${redirectPort}${REDIRECT_PATH}`;

    const registrationRequest: OAuthClientRegistrationRequest = {
      client_name: 'LLxprt Code MCP Client',
      redirect_uris: [redirectUri],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none', // Public client
      scope: config.scopes?.join(' ') ?? '',
    };

    const response = await fetch(registrationUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(registrationRequest),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `Client registration failed: ${response.status} ${response.statusText} - ${errorText}`,
      );
    }

    return (await response.json()) as OAuthClientRegistrationResponse;
  }

  /**
   * Discover OAuth configuration from an MCP server URL.
   */
  private static async discoverOAuthFromMCPServer(
    mcpServerUrl: string,
  ): Promise<MCPOAuthConfig | null> {
    return OAuthUtils.discoverOAuthConfig(mcpServerUrl);
  }

  private static async discoverAuthServerMetadataForRegistration(
    authorizationUrl: string,
  ): Promise<{
    issuerUrl: string;
    metadata: NonNullable<
      Awaited<ReturnType<typeof OAuthUtils.discoverAuthorizationServerMetadata>>
    >;
  }> {
    const authUrl = new URL(authorizationUrl);

    const oidcPatterns = [
      '/protocol/openid-connect/auth',
      '/protocol/openid-connect/authorize',
      '/oauth2/authorize',
      '/oauth/authorize',
      '/authorize',
    ];

    let pathname = authUrl.pathname.replace(/\/$/, '');
    for (const pattern of oidcPatterns) {
      if (pathname.endsWith(pattern)) {
        pathname = pathname.slice(0, -pattern.length);
        break;
      }
    }

    const issuerCandidates = new Set<string>();
    issuerCandidates.add(authUrl.origin);

    if (pathname) {
      issuerCandidates.add(`${authUrl.origin}${pathname}`);

      // eslint-disable-next-line sonarjs/regular-expr -- Static regex reviewed for lint hardening; behavior preserved.
      const versionSegmentPattern = /^v\d+(\.\d+)?$/i;
      const segments = pathname.split('/').filter(Boolean);
      const lastSegment = segments[segments.length - 1];
      if (lastSegment && versionSegmentPattern.test(lastSegment)) {
        const withoutVersionPath = segments.slice(0, -1);
        if (withoutVersionPath.length > 0) {
          issuerCandidates.add(
            `${authUrl.origin}/${withoutVersionPath.join('/')}`,
          );
        }
      }
    }

    const attemptedIssuers = Array.from(issuerCandidates);
    let selectedIssuer = attemptedIssuers[0];
    let discoveredMetadata: NonNullable<
      Awaited<ReturnType<typeof OAuthUtils.discoverAuthorizationServerMetadata>>
    > | null = null;

    for (const issuer of attemptedIssuers) {
      debugLogger.debug(`   Trying issuer URL: ${issuer}`);
      const metadata =
        await OAuthUtils.discoverAuthorizationServerMetadata(issuer);
      if (metadata) {
        selectedIssuer = issuer;
        discoveredMetadata = metadata;
        break;
      }
    }

    if (!discoveredMetadata) {
      throw new Error(
        `Failed to fetch authorization server metadata for client registration (attempted issuers: ${attemptedIssuers.join(', ')})`,
      );
    }

    debugLogger.debug(`   Selected issuer URL: ${selectedIssuer}`);
    return {
      issuerUrl: selectedIssuer,
      metadata: discoveredMetadata,
    };
  }

  /**
   * Generate PKCE parameters for OAuth flow.
   */
  private static generatePKCEParams(): PKCEParams {
    // Generate code verifier (43-128 characters)
    // using 64 bytes results in ~86 characters, safely above the minimum of 43
    const codeVerifier = crypto.randomBytes(64).toString('base64url');

    // Generate code challenge using SHA256
    const codeChallenge = crypto
      .createHash('sha256')
      .update(codeVerifier)
      .digest('base64url');

    // Generate state for CSRF protection
    const state = crypto.randomBytes(16).toString('base64url');

    return { codeVerifier, codeChallenge, state };
  }

  /**
   * Start a local HTTP server to handle OAuth callback.
   */
  private static startCallbackServer(
    expectedState: string,
    port?: number,
  ): {
    port: Promise<number>;
    response: Promise<OAuthAuthorizationResponse>;
  } {
    let portResolve: (port: number) => void;
    let portReject: (error: Error) => void;
    const portPromise = new Promise<number>((resolve, reject) => {
      portResolve = resolve;
      portReject = reject;
    });

    const responsePromise = new Promise<OAuthAuthorizationResponse>(
      (resolve, reject) => {
        let serverPort: number;

        const server = http.createServer(
          (req: http.IncomingMessage, res: http.ServerResponse) => {
            void handleOAuthCallback(
              req,
              res,
              serverPort,
              expectedState,
              server,
              resolve,
              reject,
            );
          },
        );

        server.on('error', (error) => {
          portReject(error);
          reject(error);
        });

        let listenPort: number;
        try {
          listenPort = resolveListenPort(port, portReject, reject);
        } catch {
          return;
        }

        server.listen(listenPort, () => {
          const address = server.address() as net.AddressInfo;
          serverPort = address.port;
          debugLogger.log(
            `OAuth callback server listening on port ${serverPort}`,
          );
          portResolve(serverPort);
        });

        // Timeout after 5 minutes
        setTimeout(
          () => {
            server.close();
            reject(new Error('OAuth callback timeout'));
          },
          5 * 60 * 1000,
        );
      },
    );

    return { port: portPromise, response: responsePromise };
  }

  /**
   * Extract the port number from a URL string if available and valid.
   */
  private static getPortFromUrl(urlString?: string): number | undefined {
    if (!urlString) {
      return undefined;
    }

    try {
      const url = new URL(urlString);
      if (url.port) {
        const parsedPort = parseInt(url.port, 10);
        if (!isNaN(parsedPort) && parsedPort > 0 && parsedPort <= 65535) {
          return parsedPort;
        }
      }
    } catch {
      // Ignore invalid URL
    }

    return undefined;
  }

  /**
   * Build the authorization URL for the OAuth flow.
   */
  private static buildAuthorizationUrl(
    config: MCPOAuthConfig,
    pkceParams: PKCEParams,
    redirectPort: number,
    mcpServerUrl?: string,
  ): string {
    const redirectUri =
      config.redirectUri ?? `http://localhost:${redirectPort}${REDIRECT_PATH}`;

    const params = new URLSearchParams({
      client_id: config.clientId!,
      response_type: 'code',
      redirect_uri: redirectUri,
      state: pkceParams.state,
      code_challenge: pkceParams.codeChallenge,
      code_challenge_method: 'S256',
    });

    if (config.scopes && config.scopes.length > 0) {
      params.append('scope', config.scopes.join(' '));
    }

    if (config.audiences && config.audiences.length > 0) {
      params.append('audience', config.audiences.join(' '));
    }

    // Add resource parameter for MCP OAuth spec compliance
    if (mcpServerUrl) {
      try {
        params.append(
          'resource',
          OAuthUtils.buildResourceParameter(mcpServerUrl),
        );
      } catch (error) {
        debugLogger.warn(
          `Could not add resource parameter: ${getErrorMessage(error)}`,
        );
      }
    }

    const url = new URL(config.authorizationUrl!);
    params.forEach((value, key) => {
      url.searchParams.append(key, value);
    });
    return url.toString();
  }

  /**
   * Exchange authorization code for tokens.
   */
  private static async exchangeCodeForToken(
    config: MCPOAuthConfig,
    code: string,
    codeVerifier: string,
    redirectPort: number,
    mcpServerUrl?: string,
  ): Promise<OAuthTokenResponse> {
    const redirectUri =
      config.redirectUri ?? `http://localhost:${redirectPort}${REDIRECT_PATH}`;

    const params = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      code_verifier: codeVerifier,
      client_id: config.clientId!,
    });

    if (config.clientSecret) {
      params.append('client_secret', config.clientSecret);
    }

    if (config.audiences && config.audiences.length > 0) {
      params.append('audience', config.audiences.join(' '));
    }

    // Add resource parameter for MCP OAuth spec compliance
    if (mcpServerUrl) {
      try {
        params.append(
          'resource',
          OAuthUtils.buildResourceParameter(mcpServerUrl),
        );
      } catch (error) {
        debugLogger.warn(
          `Could not add resource parameter: ${getErrorMessage(error)}`,
        );
      }
    }

    const response = await fetch(config.tokenUrl!, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json, application/x-www-form-urlencoded',
      },
      body: params.toString(),
    });

    const responseText = await response.text();
    const contentType = response.headers.get('content-type') ?? '';

    if (!response.ok) {
      const errorMessage = parseTokenErrorResponse(
        responseText,
        'Token exchange failed',
      );
      throw new Error(
        errorMessage ??
          `Token exchange failed: ${response.status} - ${responseText}`,
      );
    }

    return parseTokenResponse(
      responseText,
      contentType,
      'Token exchange failed',
    );
  }

  /**
   * Refresh an access token using a refresh token.
   */
  static async refreshAccessToken(
    config: MCPOAuthConfig,
    refreshToken: string,
    tokenUrl: string,
    mcpServerUrl?: string,
  ): Promise<OAuthTokenResponse> {
    const params = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: config.clientId!,
    });

    if (config.clientSecret) {
      params.append('client_secret', config.clientSecret);
    }

    if (config.scopes && config.scopes.length > 0) {
      params.append('scope', config.scopes.join(' '));
    }

    if (config.audiences && config.audiences.length > 0) {
      params.append('audience', config.audiences.join(' '));
    }

    // Add resource parameter for MCP OAuth spec compliance
    if (mcpServerUrl) {
      try {
        params.append(
          'resource',
          OAuthUtils.buildResourceParameter(mcpServerUrl),
        );
      } catch (error) {
        debugLogger.warn(
          `Could not add resource parameter: ${getErrorMessage(error)}`,
        );
      }
    }

    const response = await fetch(tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json, application/x-www-form-urlencoded',
      },
      body: params.toString(),
    });

    const responseText = await response.text();
    const contentType = response.headers.get('content-type') ?? '';

    if (!response.ok) {
      const errorMessage = parseTokenErrorResponse(
        responseText,
        'Token refresh failed',
      );
      throw new Error(
        errorMessage ??
          `Token refresh failed: ${response.status} - ${responseText}`,
      );
    }

    return parseTokenResponse(
      responseText,
      contentType,
      'Token refresh failed',
      'Token refresh endpoint',
      'unknown_error',
    );
  }

  /**
   * Discover and apply OAuth configuration when no authorization URL is provided.
   */
  private static async discoverOAuthConfigIfNeeded(
    serverName: string,
    config: MCPOAuthConfig,
    mcpServerUrl?: string,
  ): Promise<MCPOAuthConfig> {
    if (config.authorizationUrl || !mcpServerUrl) {
      return config;
    }

    debugLogger.debug(`Starting OAuth for MCP server "${serverName}"…
[OK] No authorization URL; using OAuth discovery`);

    // Check if the server requires authentication via WWW-Authenticate header
    try {
      const headers: HeadersInit = OAuthUtils.isSSEEndpoint(mcpServerUrl)
        ? { Accept: 'text/event-stream' }
        : { Accept: 'application/json' };

      const response = await fetch(mcpServerUrl, {
        method: 'HEAD',
        headers,
      });

      if (response.status === 401 || response.status === 307) {
        config = await applyAuthenticateHeaderDiscovery(
          response,
          mcpServerUrl,
          config,
        );
      }
    } catch (error) {
      if (error instanceof ResourceMismatchError) {
        throw error;
      }

      debugLogger.debug(
        `Failed to check endpoint for authentication requirements: ${getErrorMessage(error)}`,
      );
    }

    // If we still don't have OAuth config, try the standard discovery
    if (!config.authorizationUrl) {
      const discoveredConfig =
        await this.discoverOAuthFromMCPServer(mcpServerUrl);
      if (discoveredConfig) {
        config = {
          ...config,
          authorizationUrl: discoveredConfig.authorizationUrl,
          tokenUrl: discoveredConfig.tokenUrl,
          scopes: config.scopes ?? discoveredConfig.scopes ?? [],
          registrationUrl: discoveredConfig.registrationUrl,
          clientId: config.clientId,
          clientSecret: config.clientSecret,
        };
      } else {
        throw new Error(
          'Failed to discover OAuth configuration from MCP server',
        );
      }
    }

    return config;
  }

  /**
   * Perform dynamic client registration if no clientId is configured.
   */
  private static async ensureClientRegistration(
    config: MCPOAuthConfig,
    redirectPort: number,
  ): Promise<MCPOAuthConfig> {
    if (config.clientId) {
      return config;
    }

    let registrationUrl = config.registrationUrl;

    if (!registrationUrl) {
      if (!config.authorizationUrl) {
        throw new Error(
          'Cannot perform dynamic registration without authorization URL',
        );
      }

      debugLogger.debug('→ Attempting dynamic client registration...');
      const { metadata: authServerMetadata } =
        await MCPOAuthProvider.discoverAuthServerMetadataForRegistration(
          config.authorizationUrl,
        );
      registrationUrl = authServerMetadata.registration_endpoint;
    }

    if (registrationUrl) {
      const clientRegistration = await this.registerClient(
        registrationUrl,
        config,
        redirectPort,
      );

      config.clientId = clientRegistration.client_id;
      if (clientRegistration.client_secret) {
        config.clientSecret = clientRegistration.client_secret;
      }

      debugLogger.debug('[OK] Dynamic client registration successful');
    } else {
      throw new Error(
        'No client ID provided and dynamic registration not supported',
      );
    }

    return config;
  }

  /**
   * Save the OAuth token and verify it was persisted correctly.
   */
  private static async saveAndVerifyToken(
    serverName: string,
    token: MCPOAuthToken,
    config: MCPOAuthConfig,
    mcpServerUrl?: string,
  ): Promise<void> {
    const tokenStorage = new MCPOAuthTokenStorage();

    try {
      await tokenStorage.saveToken(
        serverName,
        token,
        config.clientId,
        config.tokenUrl,
        mcpServerUrl,
      );
      debugLogger.debug('[OK] Authentication successful! Token saved.');

      const savedToken = await tokenStorage.getCredentials(serverName);
      if (savedToken?.token.accessToken) {
        debugLogger.debug('[OK] Token verification successful');
      } else {
        debugLogger.error(
          'Token verification failed: token not found or invalid after save',
        );
      }
    } catch (saveError) {
      debugLogger.error(`Failed to save token: ${getErrorMessage(saveError)}`);
      throw saveError;
    }
  }

  /**
   * Open the browser for OAuth authorization and wait for the callback code.
   */
  private static async waitForAuthorizationCode(
    config: MCPOAuthConfig,
    pkceParams: PKCEParams,
    redirectPort: number,
    mcpServerUrl: string | undefined,
    callbackServer: {
      port: Promise<number>;
      response: Promise<OAuthAuthorizationResponse>;
    },
    events?: EventEmitter,
  ): Promise<string> {
    const displayMessage = (message: string) => {
      if (events) {
        events.emit(OAUTH_DISPLAY_MESSAGE_EVENT, message);
      } else {
        debugLogger.log(message);
      }
    };

    const authUrl = this.buildAuthorizationUrl(
      config,
      pkceParams,
      redirectPort,
      mcpServerUrl,
    );

    displayMessage(`→ Opening your browser for OAuth sign-in...

If the browser does not open, copy and paste this URL into your browser:
${authUrl}

TIP: Triple-click to select the entire URL, then copy and paste it into your browser.
WARNING: Make sure to copy the COMPLETE URL - it may wrap across multiple lines.`);

    try {
      await openBrowserSecurely(authUrl);
    } catch (error) {
      debugLogger.warn(
        'Failed to open browser automatically:',
        getErrorMessage(error),
      );
    }

    const { code } = await callbackServer.response;
    debugLogger.debug(
      '[OK] Authorization code received, exchanging for tokens...',
    );
    return code;
  }

  /**
   * Convert an OAuthTokenResponse to an MCPOAuthToken, setting expiresAt if applicable.
   */
  private static buildMCPOAuthToken(
    tokenResponse: OAuthTokenResponse,
  ): MCPOAuthToken {
    if (!tokenResponse.access_token) {
      throw new Error('No access token received from token endpoint');
    }

    const token: MCPOAuthToken = {
      accessToken: tokenResponse.access_token,
      tokenType: tokenResponse.token_type || 'Bearer',
      refreshToken: tokenResponse.refresh_token,
      scope: tokenResponse.scope,
    };

    if (
      tokenResponse.expires_in !== undefined &&
      tokenResponse.expires_in > 0
    ) {
      token.expiresAt = Date.now() + tokenResponse.expires_in * 1000;
    }

    return token;
  }

  /**
   * Perform the full OAuth authorization code flow with PKCE.
   */
  static async authenticate(
    serverName: string,
    config: MCPOAuthConfig,
    mcpServerUrl?: string,
    events?: EventEmitter,
  ): Promise<MCPOAuthToken> {
    config = await this.discoverOAuthConfigIfNeeded(
      serverName,
      config,
      mcpServerUrl,
    );

    const pkceParams = this.generatePKCEParams();
    const preferredPort = this.getPortFromUrl(config.redirectUri);

    const callbackServer = this.startCallbackServer(
      pkceParams.state,
      preferredPort,
    );

    const redirectPort = await callbackServer.port;
    debugLogger.debug(`Callback server listening on port ${redirectPort}`);

    config = await this.ensureClientRegistration(config, redirectPort);

    if (!config.clientId || !config.authorizationUrl || !config.tokenUrl) {
      throw new Error(
        'Missing required OAuth configuration after discovery and registration',
      );
    }

    const code = await this.waitForAuthorizationCode(
      config,
      pkceParams,
      redirectPort,
      mcpServerUrl,
      callbackServer,
      events,
    );

    const tokenResponse = await this.exchangeCodeForToken(
      config,
      code,
      pkceParams.codeVerifier,
      redirectPort,
      mcpServerUrl,
    );

    const token = this.buildMCPOAuthToken(tokenResponse);
    await this.saveAndVerifyToken(serverName, token, config, mcpServerUrl);

    return token;
  }

  /**
   * Get a valid access token for an MCP server, refreshing if necessary.
   */
  static async getValidToken(
    serverName: string,
    config: MCPOAuthConfig,
  ): Promise<string | null> {
    debugLogger.debug(`Getting valid token for server: ${serverName}`);
    const tokenStorage = new MCPOAuthTokenStorage();
    const credentials = await tokenStorage.getCredentials(serverName);

    if (!credentials) {
      debugLogger.debug(`No credentials found for server: ${serverName}`);
      return null;
    }

    const { token } = credentials;
    debugLogger.debug(
      `Found token for server: ${serverName}, expired: ${MCPOAuthTokenStorage.isTokenExpired(token)}`,
    );

    // Check if token is expired
    if (!MCPOAuthTokenStorage.isTokenExpired(token)) {
      debugLogger.debug(`Returning valid token for server: ${serverName}`);
      return token.accessToken;
    }

    // Try to refresh if we have a refresh token
    if (token.refreshToken && config.clientId && credentials.tokenUrl) {
      try {
        debugLogger.log(
          `Refreshing expired token for MCP server: ${serverName}`,
        );

        const newTokenResponse = await this.refreshAccessToken(
          config,
          token.refreshToken,
          credentials.tokenUrl,
          credentials.mcpServerUrl,
        );

        // Update stored token
        const newToken: MCPOAuthToken = {
          accessToken: newTokenResponse.access_token,
          tokenType: newTokenResponse.token_type,
          // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- intentional falsy coalescing: empty string refresh_token means "not provided", keep existing
          refreshToken: newTokenResponse.refresh_token || token.refreshToken,
          // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- intentional falsy coalescing: empty string scope means "not provided", keep existing
          scope: newTokenResponse.scope || token.scope,
        };

        if (
          newTokenResponse.expires_in !== undefined &&
          newTokenResponse.expires_in > 0
        ) {
          newToken.expiresAt = Date.now() + newTokenResponse.expires_in * 1000;
        }

        await tokenStorage.saveToken(
          serverName,
          newToken,
          config.clientId,
          credentials.tokenUrl,
          credentials.mcpServerUrl,
        );

        return newToken.accessToken;
      } catch (error) {
        debugLogger.error(`Failed to refresh token: ${getErrorMessage(error)}`);
        // Remove invalid token
        await tokenStorage.deleteCredentials(serverName);
      }
    }

    return null;
  }
}
