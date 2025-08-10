/**
 * Qwen OAuth Provider Implementation
 */

import { OAuthProvider } from './oauth-manager.js';
import {
  OAuthToken,
  QwenDeviceFlow,
  DeviceFlowConfig,
} from '@vybestack/llxprt-code-core';

export class QwenOAuthProvider implements OAuthProvider {
  name = 'qwen';
  private deviceFlow: QwenDeviceFlow;
  private currentToken: OAuthToken | null = null;

  constructor() {
    const config: DeviceFlowConfig = {
      clientId: 'f0304373b74a44d2b584a3fb70ca9e56',
      authorizationEndpoint: 'https://chat.qwen.ai/api/v1/oauth2/device/code',
      tokenEndpoint: 'https://chat.qwen.ai/api/v1/oauth2/token',
      scopes: ['openid', 'profile', 'email', 'model.completion'],
    };
    this.deviceFlow = new QwenDeviceFlow(config);
  }

  async initiateAuth(): Promise<void> {
    // Start device flow
    const deviceCodeResponse = await this.deviceFlow.initiateDeviceFlow();

    // Display user instructions
    console.log('\n🔐 Qwen OAuth Authentication');
    console.log('─'.repeat(40));

    // If we have a complete URL with the code, show that
    if (deviceCodeResponse.verification_uri_complete) {
      console.log(`Visit this URL to authorize:`);
      console.log(`${deviceCodeResponse.verification_uri_complete}`);
    } else {
      // Fallback to showing URL and code separately
      console.log(`1. Visit: ${deviceCodeResponse.verification_uri}`);
      console.log(`2. Enter code: ${deviceCodeResponse.user_code}`);
    }

    console.log('─'.repeat(40));
    console.log('Waiting for authorization...\n');

    // Poll for token
    this.currentToken = await this.deviceFlow.pollForToken(
      deviceCodeResponse.device_code,
    );
  }

  async getToken(): Promise<OAuthToken | null> {
    return this.currentToken;
  }

  async refreshIfNeeded(): Promise<OAuthToken | null> {
    if (!this.currentToken) {
      return null;
    }

    // Check if token needs refresh (30 second buffer)
    const now = Date.now() / 1000;
    const expiresAt = this.currentToken.expiry;

    if (expiresAt && expiresAt - now < 30) {
      // Token expires soon, refresh it
      if (this.currentToken.refresh_token) {
        try {
          this.currentToken = await this.deviceFlow.refreshToken(
            this.currentToken.refresh_token,
          );
        } catch (error) {
          console.error('Failed to refresh Qwen token:', error);
          return null;
        }
      }
    }

    return this.currentToken;
  }
}
