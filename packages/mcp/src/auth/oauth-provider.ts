import type { McpAuthFactoryRegistry } from './mcp-auth-factory.js';
/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import * as crypto from 'node:crypto';
import { URL } from 'node:url';
import { type HostBrowserLauncher } from '../host/hostServices.js';
import type {
  MCPOAuthToken,
  MCPOAuthTokenStorage,
} from './oauth-token-storage.js';
import { getErrorMessage } from '@vybestack/llxprt-code-tools/utils/errors.js';
import { OAuthUtils, ResourceMismatchError } from './oauth-utils.js';
import { awaitOAuthOperation } from './oauth-request.js';
import { startOAuthCallbackServer, REDIRECT_PATH } from './oauth-callback.js';
export type { OAuthAuthorizationResponse } from './oauth-callback.js';
import { DebugLogger } from '@vybestack/llxprt-code-telemetry/debug/DebugLogger.js';
import {
  type OAuthTokenResponse,
  parseTokenResponse,
  parseTokenErrorResponse,
} from './oauth-provider-utils.js';

const debugLogger = new DebugLogger('llxprt:mcp:oauth');

import {
  waitForAuthorizationCode,
  type OAuthDisplaySink,
} from './oauth-authorization.js';
import {
  finalizeOAuthToken,
  getValidOAuthToken,
} from './oauth-token-lifecycle.js';
export type { OAuthDisplaySink } from './oauth-authorization.js';

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

async function applyWWWAuthenticateDiscovery(
  wwwAuthenticate: string,
  mcpServerUrl: string,
  config: MCPOAuthConfig,
  signal?: AbortSignal,
): Promise<MCPOAuthConfig> {
  const discoveredConfig = await OAuthUtils.discoverOAuthFromWWWAuthenticate(
    wwwAuthenticate,
    mcpServerUrl,
    signal,
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
  signal?: AbortSignal,
): Promise<MCPOAuthConfig> {
  const wwwAuthenticate = response.headers.get('www-authenticate');
  if (wwwAuthenticate === null || wwwAuthenticate === '') {
    return config;
  }
  return applyWWWAuthenticateDiscovery(
    wwwAuthenticate,
    mcpServerUrl,
    config,
    signal,
  );
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
    signal?: AbortSignal,
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

    const response = await awaitOAuthOperation(signal, () =>
      fetch(registrationUrl, {
        signal,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(registrationRequest),
      }),
    );

    if (!response.ok) {
      const errorText = await awaitOAuthOperation(signal, () =>
        response.text(),
      );
      throw new Error(
        `Client registration failed: ${response.status} ${response.statusText} - ${errorText}`,
      );
    }

    return (await awaitOAuthOperation(signal, () =>
      response.json(),
    )) as OAuthClientRegistrationResponse;
  }

  /**
   * Discover OAuth configuration from an MCP server URL.
   */
  private static async discoverOAuthFromMCPServer(
    mcpServerUrl: string,
    signal?: AbortSignal,
  ): Promise<MCPOAuthConfig | null> {
    return OAuthUtils.discoverOAuthConfig(mcpServerUrl, signal);
  }

  private static async discoverAuthServerMetadataForRegistration(
    authorizationUrl: string,
    signal?: AbortSignal,
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
      const metadata = await OAuthUtils.discoverAuthorizationServerMetadata(
        issuer,
        signal,
      );
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
    signal?: AbortSignal,
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

    const response = await awaitOAuthOperation(signal, () =>
      fetch(config.tokenUrl!, {
        signal,
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json, application/x-www-form-urlencoded',
        },
        body: params.toString(),
      }),
    );

    const responseText = await awaitOAuthOperation(signal, () =>
      response.text(),
    );
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
    signal?: AbortSignal,
  ): Promise<OAuthTokenResponse> {
    signal?.throwIfAborted();
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

    const response = await awaitOAuthOperation(signal, () =>
      fetch(tokenUrl, {
        signal,
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json, application/x-www-form-urlencoded',
        },
        body: params.toString(),
      }),
    );

    const responseText = await awaitOAuthOperation(signal, () =>
      response.text(),
    );
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
    signal?: AbortSignal,
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

      const response = await awaitOAuthOperation(signal, () =>
        fetch(mcpServerUrl, {
          signal,
          method: 'HEAD',
          headers,
        }),
      );

      if (response.status === 401 || response.status === 307) {
        config = await applyAuthenticateHeaderDiscovery(
          response,
          mcpServerUrl,
          config,
          signal,
        );
      }
    } catch (error) {
      signal?.throwIfAborted();
      if (error instanceof ResourceMismatchError) {
        throw error;
      }

      debugLogger.debug(
        `Failed to check endpoint for authentication requirements: ${getErrorMessage(error)}`,
      );
    }

    // If we still don't have OAuth config, try the standard discovery
    if (!config.authorizationUrl) {
      const discoveredConfig = await this.discoverOAuthFromMCPServer(
        mcpServerUrl,
        signal,
      );
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
    signal?: AbortSignal,
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
          signal,
        );
      registrationUrl = authServerMetadata.registration_endpoint;
    }

    if (registrationUrl) {
      const clientRegistration = await this.registerClient(
        registrationUrl,
        config,
        redirectPort,
        signal,
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
   * Perform the full OAuth authorization code flow with PKCE.
   * Cancellation joins in-flight work and rejects with the signal's reason.
   * Browser and storage calls cannot be interrupted; a started write may persist,
   * but no subsequent operation or successful return follows cancellation.
   */
  static async authenticate(
    capabilities: McpOAuthBinding,
    serverName: string,
    config: MCPOAuthConfig,
    mcpServerUrl?: string,
    display?: OAuthDisplaySink,
    signal?: AbortSignal,
  ): Promise<MCPOAuthToken> {
    const { openBrowser, tokenStorage } = capabilities;
    signal?.throwIfAborted();
    config = await this.discoverOAuthConfigIfNeeded(
      serverName,
      { ...config },
      mcpServerUrl,
      signal,
    );
    signal?.throwIfAborted();

    const pkceParams = this.generatePKCEParams();
    const preferredPort = this.getPortFromUrl(config.redirectUri);

    const callbackServer = startOAuthCallbackServer(
      pkceParams.state,
      preferredPort,
      signal,
    );

    let redirectPort: number;
    let code: string;
    try {
      redirectPort = await callbackServer.port;
      signal?.throwIfAborted();
      debugLogger.debug(`Callback server listening on port ${redirectPort}`);

      config = await this.ensureClientRegistration(
        config,
        redirectPort,
        signal,
      );
      signal?.throwIfAborted();

      if (!config.clientId || !config.authorizationUrl || !config.tokenUrl) {
        throw new Error(
          'Missing required OAuth configuration after discovery and registration',
        );
      }

      code = await waitForAuthorizationCode(
        this.buildAuthorizationUrl(
          config,
          pkceParams,
          redirectPort,
          mcpServerUrl,
        ),
        callbackServer,
        display,
        signal,
        openBrowser,
      );
    } catch (error) {
      signal?.throwIfAborted();
      throw error;
    } finally {
      await callbackServer.close();
    }

    return finalizeOAuthToken(
      this.exchangeCodeForToken(
        config,
        code,
        pkceParams.codeVerifier,
        redirectPort,
        mcpServerUrl,
        signal,
      ),
      serverName,
      config,
      mcpServerUrl,
      signal,
      tokenStorage,
    );
  }

  /**
   * Get a valid access token for an MCP server, refreshing if necessary.
   */
  static async getValidToken(
    tokenStorage: Pick<
      MCPOAuthTokenStorage,
      'getCredentials' | 'saveToken' | 'deleteCredentials'
    >,
    serverName: string,
    config: MCPOAuthConfig,
    signal?: AbortSignal,
  ): Promise<string | null> {
    return getValidOAuthToken(
      tokenStorage,
      serverName,
      config,
      signal,
      this.refreshAccessToken.bind(this),
    );
  }
}

export interface McpOAuthBinding {
  readonly getAuthProviderFactory?: McpAuthFactoryRegistry['getAuthProviderFactory'];
  readonly tokenStorage: MCPOAuthTokenStorage;
  readonly openBrowser: HostBrowserLauncher;
}
