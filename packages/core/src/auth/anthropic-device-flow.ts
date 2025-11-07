/**
 * Anthropic OAuth 2.0 Device Flow Implementation
 *
 * Implements OAuth 2.0 device authorization grant flow for Anthropic Claude API.
 * Based on the OAuth 2.0 Device Authorization Grant specification (RFC 8628).
 */

import { DeviceCodeResponse, OAuthToken } from './types.js';
import { createHash, randomBytes } from 'crypto';
import { URL } from 'node:url';

/**
 * Configuration for Anthropic device flow authentication
 */
interface AnthropicFlowConfig {
  clientId: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  scopes: string[];
}

/**
 * Anthropic-specific OAuth 2.0 device flow implementation.
 * Handles authentication for Claude API access.
 */
export class AnthropicDeviceFlow {
  private config: AnthropicFlowConfig;
  private codeVerifier?: string;
  private _codeChallenge?: string;
  private state?: string;
  private redirectUri: string;

  constructor(config?: Partial<AnthropicFlowConfig>) {
    const defaultConfig: AnthropicFlowConfig = {
      clientId: '9d1c250a-e61b-44d9-88ed-5944d1962f5e', // Anthropic's public OAuth client ID
      authorizationEndpoint: 'https://claude.ai/oauth/authorize', // Use claude.ai like OpenCode's "max" mode
      tokenEndpoint: 'https://console.anthropic.com/v1/oauth/token',
      scopes: ['org:create_api_key', 'user:profile', 'user:inference'],
    };

    this.config = { ...defaultConfig, ...config };
    this.redirectUri = 'https://console.anthropic.com/oauth/code/callback';
  }

  /**
   * Generates PKCE code verifier and challenge using S256 method
   */
  private generatePKCE(): { verifier: string; challenge: string } {
    // Generate a random code verifier (43-128 characters)
    const _verifier = randomBytes(32).toString('base64url');
    this.codeVerifier = _verifier;

    // Generate code challenge using S256 (SHA256 hash)
    const challenge = createHash('sha256')
      .update(_verifier)
      .digest('base64url');
    this._codeChallenge = challenge;

    // Store challenge for potential future use
    void this._codeChallenge;

    return { verifier: _verifier, challenge };
  }

  /**
   * Initiates the OAuth flow by constructing the authorization URL.
   * Since Anthropic doesn't have a device flow, we simulate it with authorization code flow.
   */
  async initiateDeviceFlow(redirectUri?: string): Promise<DeviceCodeResponse> {
    // Generate PKCE parameters
    const { verifier, challenge } = this.generatePKCE();

    // Use verifier as state like OpenCode does
    this.state = verifier; // Store for later use in token exchange
    this.redirectUri =
      redirectUri ?? 'https://console.anthropic.com/oauth/code/callback';

    // Build authorization URL with PKCE parameters
    const params = new URLSearchParams({
      code: 'true',
      client_id: this.config.clientId,
      response_type: 'code',
      redirect_uri: this.redirectUri,
      scope: this.config.scopes.join(' '),
      code_challenge: challenge,
      code_challenge_method: 'S256',
      state: verifier, // Use verifier as state like OpenCode
    });

    const authUrl = `${this.config.authorizationEndpoint}?${params.toString()}`;

    // Return a simulated device code response with the authorization URL
    // The user will need to manually visit this URL and authorize
    return {
      device_code: verifier, // Use verifier as a tracking ID
      user_code: 'ANTHROPIC', // Display code for user
      verification_uri: 'https://console.anthropic.com/oauth/authorize',
      verification_uri_complete: authUrl,
      expires_in: 1800, // 30 minutes
      interval: 5, // 5 seconds polling interval
    };
  }

  /**
   * Exchange authorization code for access token (PKCE flow)
   */
  async exchangeCodeForToken(authCodeWithState: string): Promise<OAuthToken> {
    if (!this.codeVerifier) {
      throw new Error(
        'No PKCE code verifier found - OAuth flow not initialized',
      );
    }

    // OpenCode splits the code and state - format: code#state
    const splits = authCodeWithState.split('#');
    const authCode = splits[0];
    const stateFromResponse = splits[1] || this.state; // Use state from response if available

    // OpenCode sends JSON, not form-encoded!
    const requestBody = {
      grant_type: 'authorization_code',
      code: authCode,
      state: stateFromResponse, // Include state in the request
      client_id: this.config.clientId,
      redirect_uri: this.redirectUri,
      code_verifier: this.codeVerifier,
    };

    const response = await fetch(this.config.tokenEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json', // JSON, not form-encoded!
      },
      body: JSON.stringify(requestBody), // Send as JSON
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to exchange authorization code: ${error}`);
    }

    const data = await response.json();
    return this.mapTokenResponse(data);
  }

  getState(): string {
    if (!this.state) {
      throw new Error('OAuth flow not initialized');
    }
    return this.state;
  }

  buildAuthorizationUrl(redirectUri: string): string {
    if (!this._codeChallenge || !this.state) {
      throw new Error('OAuth flow not initialized');
    }

    const redirect = new URL(redirectUri);
    if (
      redirect.hostname !== '127.0.0.1' &&
      redirect.hostname !== 'localhost'
    ) {
      throw new Error(
        'Only localhost redirect URIs are supported for Anthropic OAuth',
      );
    }

    this.redirectUri = redirectUri;
    const params = new URLSearchParams({
      code: 'true',
      client_id: this.config.clientId,
      response_type: 'code',
      redirect_uri: redirectUri,
      scope: this.config.scopes.join(' '),
      code_challenge: this._codeChallenge,
      code_challenge_method: 'S256',
      state: this.state,
    });
    return `${this.config.authorizationEndpoint}?${params.toString()}`;
  }

  /**
   * Polls for the access token after user authorization.
   */
  async pollForToken(deviceCode: string): Promise<OAuthToken> {
    const startTime = Date.now();
    const expiresIn = 1800 * 1000; // 30 minutes in milliseconds
    const interval = 5000; // 5 seconds default polling interval

    while (Date.now() - startTime < expiresIn) {
      try {
        const response = await fetch(this.config.tokenEndpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: new URLSearchParams({
            grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
            device_code: deviceCode,
            client_id: this.config.clientId,
          }),
        });

        if (response.ok) {
          const data = await response.json();
          return this.mapTokenResponse(data);
        }

        const error = await response.json();

        // Check for pending authorization
        if (error.error === 'authorization_pending') {
          await new Promise((resolve) => setTimeout(resolve, interval));
          continue;
        }

        // Check for slow down request
        if (error.error === 'slow_down') {
          await new Promise((resolve) => setTimeout(resolve, interval * 2));
          continue;
        }

        // Handle other errors
        throw new Error(
          `Token polling failed: ${error.error_description || error.error}`,
        );
      } catch (error) {
        if (
          error instanceof Error &&
          error.message.includes('Token polling failed')
        ) {
          throw error;
        }
        // Network errors - continue polling
        await new Promise((resolve) => setTimeout(resolve, interval));
      }
    }

    throw new Error(
      'Authorization timeout - user did not complete authentication',
    );
  }

  /**
   * Refreshes an expired access token using a refresh token.
   */
  async refreshToken(refreshToken: string): Promise<OAuthToken> {
    const response = await fetch(this.config.tokenEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: this.config.clientId,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to refresh Anthropic token: ${error}`);
    }

    const data = await response.json();
    return this.mapTokenResponse(data);
  }

  /**
   * Maps Anthropic's token response to our standard OAuthToken format.
   */
  private mapTokenResponse(data: Record<string, unknown>): OAuthToken {
    return {
      access_token: data.access_token as string,
      expiry:
        Math.floor(Date.now() / 1000) + ((data.expires_in as number) || 3600),
      refresh_token: data.refresh_token as string | undefined,
      scope: data.scope as string | undefined,
      token_type: 'Bearer',
    };
  }
}
