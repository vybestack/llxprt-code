/**
 * Anthropic OAuth 2.0 Device Flow Implementation
 *
 * Implements OAuth 2.0 device authorization grant flow for Anthropic Claude API.
 * Based on the OAuth 2.0 Device Authorization Grant specification (RFC 8628).
 */

import { DeviceCodeResponse, OAuthToken } from './types.js';

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

  constructor(config?: Partial<AnthropicFlowConfig>) {
    const defaultConfig: AnthropicFlowConfig = {
      clientId: '9d1c250a-e61b-44d9-88ed-5944d1962f5e', // Anthropic's public OAuth client ID
      authorizationEndpoint: 'https://console.anthropic.com/oauth/device/code',
      tokenEndpoint: 'https://console.anthropic.com/v1/oauth/token',
      scopes: ['org:create_api_key', 'user:profile', 'user:inference'],
    };

    this.config = { ...defaultConfig, ...config };
  }

  /**
   * Initiates the device flow by requesting a device code from Anthropic.
   */
  async initiateDeviceFlow(): Promise<DeviceCodeResponse> {
    const response = await fetch(this.config.authorizationEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        client_id: this.config.clientId,
        scope: this.config.scopes.join(' '),
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to initiate Anthropic device flow: ${error}`);
    }

    const data = await response.json();

    // Map Anthropic's response to our standard format
    return {
      device_code: data.device_code,
      user_code: data.user_code,
      verification_uri:
        data.verification_uri || 'https://console.anthropic.com/oauth/device',
      verification_uri_complete: data.verification_uri_complete,
      expires_in: data.expires_in || 1800, // 30 minutes default
      interval: data.interval || 5, // 5 seconds default polling interval
    };
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
      token_type: (data.token_type as string) || 'Bearer',
    };
  }
}
