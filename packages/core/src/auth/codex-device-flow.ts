/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { randomBytes, createHash } from 'crypto';
import { DebugLogger } from '../debug/index.js';
import {
  CodexOAuthTokenSchema,
  CodexTokenResponseSchema,
  type CodexOAuthToken,
} from './types.js';
import { z } from 'zod';

/**
 * Codex-specific OAuth configuration
 */
const CODEX_CONFIG = {
  clientId: 'app_EMoamEEZ73f0CkXaXp7hrann',
  issuer: 'https://auth.openai.com',
  tokenEndpoint: 'https://auth.openai.com/oauth/token',
  authorizationEndpoint: 'https://auth.openai.com/oauth/authorize',
  scopes: ['openid', 'profile', 'email', 'offline_access'],
  originator: 'codex_cli_rs',
} as const;

/**
 * JWT payload schema for account_id extraction
 * Handles multiple possible locations of account_id in the JWT
 */
const JwtPayloadSchema = z.object({
  'https://api.openai.com/auth': z
    .object({
      chatgpt_account_id: z.string().optional(),
      account_id: z.string().optional(),
    })
    .optional(),
  account_id: z.string().optional(),
});

/**
 * Codex OAuth PKCE flow implementation
 * Implements OAuth 2.0 Authorization Code flow with PKCE for Codex authentication
 */
export class CodexDeviceFlow {
  private logger: DebugLogger;
  private codeVerifier: string | null = null;

  constructor() {
    this.logger = new DebugLogger('llxprt:auth:codex-device-flow');
  }

  /**
   * Build authorization URL for browser-based OAuth flow
   * @param redirectUri Callback URL for OAuth redirect
   * @param state Random state parameter for CSRF protection
   * @returns Authorization URL to open in browser
   */
  buildAuthorizationUrl(redirectUri: string, state: string): string {
    const { challenge } = this.generatePKCE();
    // Manually construct query string to use %20 for spaces (not +)
    // This ensures proper parsing with decodeURIComponent
    // Include all required params per shell-scripts/codex-oauth.sh
    const params = [
      `response_type=code`,
      `client_id=${encodeURIComponent(CODEX_CONFIG.clientId)}`,
      `redirect_uri=${encodeURIComponent(redirectUri)}`,
      `scope=${encodeURIComponent(CODEX_CONFIG.scopes.join(' '))}`,
      `code_challenge=${encodeURIComponent(challenge)}`,
      `code_challenge_method=S256`,
      `id_token_add_organizations=true`,
      `codex_cli_simplified_flow=true`,
      `state=${encodeURIComponent(state)}`,
      `originator=${encodeURIComponent(CODEX_CONFIG.originator)}`,
    ].join('&');
    this.logger.debug(() => 'Built authorization URL with PKCE S256');
    return `${CODEX_CONFIG.authorizationEndpoint}?${params}`;
  }

  /**
   * Exchange authorization code for OAuth tokens
   * @param authCode Authorization code from OAuth callback
   * @param redirectUri Callback URL (must match the one used in authorization request)
   * @returns Validated CodexOAuthToken with account_id
   * @throws Error if code verifier not initialized or token exchange fails
   */
  async exchangeCodeForToken(
    authCode: string,
    redirectUri: string,
  ): Promise<CodexOAuthToken> {
    if (!this.codeVerifier) {
      throw new Error('PKCE code verifier not initialized');
    }

    this.logger.debug(() => 'Exchanging authorization code for tokens');

    const response = await fetch(CODEX_CONFIG.tokenEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: authCode,
        redirect_uri: redirectUri,
        client_id: CODEX_CONFIG.clientId,
        code_verifier: this.codeVerifier,
      }).toString(),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Token exchange failed: ${response.status} ${errorText}`);
    }

    const data: unknown = await response.json();

    // Validate with Zod schema - NO TYPE ASSERTIONS
    const tokenResponse = CodexTokenResponseSchema.parse(data);

    // Extract account_id from id_token JWT
    const accountId = tokenResponse.id_token
      ? this.extractAccountIdFromIdToken(tokenResponse.id_token)
      : this.throwMissingAccountId();

    // Build validated Codex token - use Unix timestamp in SECONDS (not milliseconds)
    const now = Math.floor(Date.now() / 1000);
    const expiresIn = tokenResponse.expires_in || 3600; // Default 1 hour
    const expiry = now + expiresIn;

    const codexToken: CodexOAuthToken = CodexOAuthTokenSchema.parse({
      access_token: tokenResponse.access_token,
      token_type: tokenResponse.token_type,
      expiry,
      refresh_token: tokenResponse.refresh_token,
      account_id: accountId,
      id_token: tokenResponse.id_token,
    });

    this.logger.debug(
      () =>
        `Token exchange successful, account_id: ${accountId.substring(0, 8)}...`,
    );
    return codexToken;
  }

  /**
   * Refresh an expired access token using refresh token
   * @param refreshToken Valid refresh token
   * @returns New CodexOAuthToken with updated expiry
   * @throws Error if refresh fails or id_token missing
   */
  async refreshToken(refreshToken: string): Promise<CodexOAuthToken> {
    this.logger.debug(() => 'Refreshing expired token');

    const response = await fetch(CODEX_CONFIG.tokenEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: CODEX_CONFIG.clientId,
      }).toString(),
    });

    if (!response.ok) {
      throw new Error(`Token refresh failed: ${response.status}`);
    }

    const data: unknown = await response.json();
    const tokenResponse = CodexTokenResponseSchema.parse(data);

    // Extract account_id from new id_token or throw
    const accountId = tokenResponse.id_token
      ? this.extractAccountIdFromIdToken(tokenResponse.id_token)
      : this.throwMissingAccountId();

    // Use Unix timestamp in SECONDS
    const now = Math.floor(Date.now() / 1000);
    const expiresIn = tokenResponse.expires_in || 3600;
    const expiry = now + expiresIn;

    return CodexOAuthTokenSchema.parse({
      access_token: tokenResponse.access_token,
      token_type: tokenResponse.token_type,
      expiry,
      refresh_token: tokenResponse.refresh_token ?? refreshToken,
      account_id: accountId,
      id_token: tokenResponse.id_token,
    });
  }

  /**
   * Extract account_id from id_token JWT without external libraries
   * JWT format: header.payload.signature (base64url encoded)
   * @param idToken JWT id_token from OAuth response
   * @returns account_id extracted from JWT claims
   * @throws Error if JWT format invalid or account_id not found
   */
  private extractAccountIdFromIdToken(idToken: string): string {
    const parts = idToken.split('.');
    if (parts.length !== 3) {
      throw new Error('Invalid JWT format: expected 3 parts');
    }

    // Decode payload (middle part) from base64url
    const payload = parts[1];
    const decoded = Buffer.from(payload, 'base64url').toString('utf-8');

    // Parse and validate with Zod
    const parsedPayload: unknown = JSON.parse(decoded);
    const validated = JwtPayloadSchema.parse(parsedPayload);

    // Extract account_id from OpenAI-specific claim or root
    const accountId =
      validated['https://api.openai.com/auth']?.chatgpt_account_id ||
      validated['https://api.openai.com/auth']?.account_id ||
      validated.account_id;

    if (!accountId) {
      throw new Error('No account_id found in id_token JWT claims');
    }

    return accountId;
  }

  /**
   * Helper to throw error when id_token is missing
   * @throws Error indicating id_token required
   */
  private throwMissingAccountId(): never {
    throw new Error('id_token required to extract account_id');
  }

  /**
   * Generates PKCE code verifier and challenge
   * @returns Object containing verifier and challenge strings
   */
  private generatePKCE(): { verifier: string; challenge: string } {
    // Generate 32 random bytes for verifier
    const verifier = randomBytes(32).toString('base64url');

    // Create SHA-256 hash of verifier for challenge (S256 method)
    const challenge = createHash('sha256').update(verifier).digest('base64url');

    this.codeVerifier = verifier;
    return { verifier, challenge };
  }
}
