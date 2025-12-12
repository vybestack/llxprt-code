/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { randomBytes, createHash } from 'crypto';
import {
  type DeviceCodeResponse,
  type OAuthToken,
  DeviceCodeResponseSchema,
  TokenResponseSchema,
} from './types.js';

/**
 * Configuration for Qwen device flow authentication
 */
export interface DeviceFlowConfig {
  clientId: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  scopes: string[];
}

/**
 * Qwen OAuth device flow implementation
 */
export class QwenDeviceFlow {
  private config: DeviceFlowConfig;
  private pkceVerifier: string = '';

  constructor(config: DeviceFlowConfig) {
    this.config = config;
  }

  /**
   * Initiates the device authorization flow
   * @returns Promise resolving to device code response
   */
  async initiateDeviceFlow(): Promise<DeviceCodeResponse> {
    // Generate PKCE parameters
    const pkce = this.generatePKCE();
    this.pkceVerifier = pkce.verifier;

    // Prepare request parameters
    const params = new URLSearchParams({
      client_id: this.config.clientId,
      code_challenge: pkce.challenge,
      code_challenge_method: 'S256',
    });

    // Only add scope if it's not empty
    if (this.config.scopes && this.config.scopes.length > 0) {
      params.append('scope', this.config.scopes.join(' '));
    }

    // Make HTTP request
    const response = await fetch(this.config.authorizationEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: params.toString(),
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();

    // Validate response with Zod schema
    const validatedResponse = DeviceCodeResponseSchema.parse(data);
    return validatedResponse;
  }

  /**
   * Polls the authorization server for an access token
   * @param deviceCode Device code from initiation response
   * @returns Promise resolving to OAuth token
   */
  async pollForToken(deviceCode: string): Promise<OAuthToken> {
    const maxDuration = 15 * 60 * 1000; // 15 minutes in milliseconds
    const startTime = Date.now();
    let interval = 5000; // Start with 5 seconds

    while (Date.now() - startTime < maxDuration) {
      const params = new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
        device_code: deviceCode,
        client_id: this.config.clientId,
        code_verifier: this.pkceVerifier,
      });

      try {
        const response = await fetch(this.config.tokenEndpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            Accept: 'application/json',
          },
          body: params.toString(),
        });

        if (response.ok) {
          const data = await response.json();

          // Validate response with Zod schema
          const validatedResponse = TokenResponseSchema.parse(data);

          // Calculate expiry timestamp
          const now = Math.floor(Date.now() / 1000);
          const expiresIn = validatedResponse.expires_in || 3600; // Default to 1 hour if not provided
          const expiry = now + expiresIn;

          return {
            access_token: validatedResponse.access_token,
            token_type: 'Bearer',
            expiry,
            refresh_token: validatedResponse.refresh_token,
            scope: validatedResponse.scope || undefined, // Convert null to undefined
            resource_url: validatedResponse.resource_url, // Include the API endpoint from Qwen
          };
        }

        // Handle error responses
        const errorData = await response.json();

        if (errorData.error === 'authorization_pending') {
          // Continue polling - wait for the interval before next attempt
          await new Promise((resolve) => setTimeout(resolve, interval));
          continue;
        } else if (errorData.error === 'slow_down') {
          // Increase polling interval by 5 seconds and continue
          interval += 5000;
          await new Promise((resolve) => setTimeout(resolve, interval));
          continue;
        } else if (errorData.error === 'access_denied') {
          throw new Error('access_denied');
        } else if (errorData.error === 'expired_token') {
          throw new Error('expired_token');
        }

        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      } catch (error) {
        // For network errors, apply exponential backoff
        if (error instanceof Error && error.message.includes('fetch failed')) {
          interval = Math.min(interval * 1.5, 60000); // Max 60 seconds
          await new Promise((resolve) => setTimeout(resolve, interval));
          continue;
        }

        // Re-throw other errors (like access_denied, expired_token)
        throw error;
      }
    }

    // If we reach here, we've exceeded the maximum polling duration
    throw new Error('Polling timeout exceeded');
  }

  /**
   * Refreshes an expired access token
   * @param refreshToken Valid refresh token
   * @returns Promise resolving to new OAuth token
   */
  async refreshToken(refreshToken: string): Promise<OAuthToken> {
    const params = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: this.config.clientId,
    });

    const response = await fetch(this.config.tokenEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: params.toString(),
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();

    // Validate response with Zod schema
    const validatedResponse = TokenResponseSchema.parse(data);

    // Calculate expiry timestamp with 30-second buffer
    const now = Math.floor(Date.now() / 1000);
    const expiresIn = validatedResponse.expires_in || 3600; // Default to 1 hour if not provided
    const expiry = now + expiresIn - 30; // 30-second buffer

    return {
      access_token: validatedResponse.access_token,
      token_type: 'Bearer',
      expiry,
      refresh_token: validatedResponse.refresh_token || refreshToken, // Use new refresh token if provided, otherwise keep the old one
      scope: validatedResponse.scope || undefined, // Convert null to undefined
      resource_url: validatedResponse.resource_url, // Include the API endpoint from Qwen
    };
  }

  /**
   * Generates PKCE code verifier and challenge
   * @returns Object containing verifier and challenge strings
   */
  private generatePKCE(): { verifier: string; challenge: string } {
    // Generate 32 random bytes for verifier
    const verifier = randomBytes(32).toString('base64url');

    // Create SHA-256 hash of verifier for challenge
    const challenge = createHash('sha256').update(verifier).digest('base64url');

    return { verifier, challenge };
  }
}
