/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { randomBytes, createHash } from 'crypto';
import type { IDebugLogger } from '../interfaces/index.js';
import {
  CodexOAuthTokenSchema,
  CodexTokenResponseSchema,
  type CodexOAuthToken,
} from '../types.js';
import { z } from 'zod';

/**
 * Codex-specific OAuth configuration
 * Exported for reuse by CLI and other consumers to ensure single source of truth
 */
export const CODEX_CONFIG = {
  clientId: 'app_EMoamEEZ73f0CkXaXp7hrann',
  issuer: 'https://auth.openai.com',
  tokenEndpoint: 'https://auth.openai.com/oauth/token',
  authorizationEndpoint: 'https://auth.openai.com/oauth/authorize',
  deviceAuthUserCodeEndpoint:
    'https://auth.openai.com/api/accounts/deviceauth/usercode',
  deviceAuthTokenEndpoint:
    'https://auth.openai.com/api/accounts/deviceauth/token',
  deviceAuthCallbackUri: 'https://auth.openai.com/deviceauth/callback',
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
 * Resolves the account_id from JWT claims, preferring the OpenAI-specific
 * chatgpt_account_id, then the nested account_id, then the root account_id.
 * Empty-string values are treated as absent.
 */
function resolveAccountId(
  chatgptAccountId: string | undefined,
  nestedAccountId: string | undefined,
  rootAccountId: string | undefined,
): string | undefined {
  if (chatgptAccountId !== '' && chatgptAccountId !== undefined) {
    return chatgptAccountId;
  }
  if (nestedAccountId !== '' && nestedAccountId !== undefined) {
    return nestedAccountId;
  }
  return rootAccountId;
}

function abortReason(signal?: AbortSignal): unknown {
  return signal?.reason ?? new Error('Codex OAuth operation aborted');
}

function waitForDelay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted === true) {
      reject(abortReason(signal));
      return;
    }
    const onAbort = (): void => {
      clearTimeout(timeout);
      reject(abortReason(signal));
    };
    const timeout = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

interface ConsumedResponse {
  readonly ok: boolean;
  readonly status: number;
  readonly text: string;
}

/**
 * Codex OAuth PKCE flow implementation
 * Implements OAuth 2.0 Authorization Code flow with PKCE for Codex authentication
 */
export class CodexDeviceFlow {
  private logger: IDebugLogger;
  private codeVerifiers: Map<string, string> = new Map();
  private readonly networkTimeoutMs: number;

  private static readonly NO_OP_LOGGER: IDebugLogger = {
    debug: () => {},
    error: () => {},
    warn: () => {},
    log: () => {},
  };

  constructor(options?: { logger?: IDebugLogger; networkTimeoutMs?: number }) {
    this.logger = options?.logger ?? CodexDeviceFlow.NO_OP_LOGGER;
    this.networkTimeoutMs = options?.networkTimeoutMs ?? 30_000;
  }

  private async readResponseBody(
    response: Response,
    signal: AbortSignal,
  ): Promise<string> {
    if (response.body === null) {
      return '';
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let text = '';
    try {
      let chunk = await this.readChunkWithSignal(reader, signal);
      while (!chunk.done) {
        if (signal.aborted) {
          throw signal.reason;
        }
        text += decoder.decode(chunk.value, { stream: true });
        chunk = await this.readChunkWithSignal(reader, signal);
      }
      if (signal.aborted) {
        throw signal.reason;
      }
      return text + decoder.decode();
    } finally {
      if (signal.aborted) {
        await reader.cancel(signal.reason).catch(() => undefined);
      }
      reader.releaseLock();
    }
  }

  private readChunkWithSignal(
    reader: ReadableStreamDefaultReader<Uint8Array>,
    signal: AbortSignal,
  ): ReturnType<ReadableStreamDefaultReader<Uint8Array>['read']> {
    return new Promise((resolve, reject) => {
      const cleanup = (): void => {
        signal.removeEventListener('abort', onAbort);
      };
      const rejectForAbort = (): void => {
        cleanup();
        reject(abortReason(signal));
      };
      const onAbort = (): void => {
        reader.cancel(abortReason(signal)).then(rejectForAbort, rejectForAbort);
      };
      signal.addEventListener('abort', onAbort, { once: true });
      reader.read().then(
        (result) => {
          cleanup();
          resolve(result);
        },
        (error: unknown) => {
          cleanup();
          reject(error);
        },
      );
      if (signal.aborted) {
        onAbort();
      }
    });
  }

  private async fetchWithDeadline(
    input: string | URL,
    init: RequestInit,
    signal?: AbortSignal,
  ): Promise<ConsumedResponse> {
    const controller = new AbortController();
    const abort = (): void => controller.abort(abortReason(signal));
    if (signal?.aborted === true) {
      throw abortReason(signal);
    } else {
      signal?.addEventListener('abort', abort, { once: true });
    }
    const timeout = setTimeout(
      () =>
        controller.abort(new Error('Codex OAuth network request timed out')),
      this.networkTimeoutMs,
    );
    try {
      const response = await globalThis.fetch(input, {
        ...init,
        signal: controller.signal,
      });
      const text = await this.readResponseBody(response, controller.signal);
      return { ok: response.ok, status: response.status, text };
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener('abort', abort);
    }
  }

  private parseSuccessfulJson(
    response: ConsumedResponse,
    operation: string,
  ): unknown {
    try {
      return JSON.parse(response.text) as unknown;
    } catch (error) {
      this.logger.debug(
        () =>
          `[FLOW] ${operation} response JSON parsing failed: ${String(error)}`,
      );
      throw new Error(
        `${operation} failed: invalid JSON response (status ${response.status})`,
      );
    }
  }
  /**
   * Build authorization URL for browser-based OAuth flow
   * @param redirectUri Callback URL for OAuth redirect
   * @param state Random state parameter for CSRF protection
   * @returns Authorization URL to open in browser
   */
  buildAuthorizationUrl(redirectUri: string, state: string): string {
    this.logger.debug(
      () =>
        `[FLOW] buildAuthorizationUrl() called with redirectUri=${redirectUri}, state=${state.substring(0, 8)}...`,
    );
    const { verifier, challenge } = this.generatePKCE();
    this.logger.debug(
      () =>
        `[FLOW] PKCE generated: verifier length=${verifier.length}, challenge length=${challenge.length}`,
    );
    this.codeVerifiers.set(state, verifier);
    this.logger.debug(
      () =>
        `[FLOW] Stored PKCE verifier for state, codeVerifiers.size=${this.codeVerifiers.size}`,
    );
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
      `theme=dark`,
    ].join('&');
    this.logger.debug('[FLOW] Built authorization URL with PKCE S256');
    return `${CODEX_CONFIG.authorizationEndpoint}?${params}`;
  }

  /**
   * Exchange authorization code for OAuth tokens
   * @param authCode Authorization code from OAuth callback
   * @param redirectUri Callback URL (must match the one used in authorization request)
   * @param state State parameter from OAuth callback
   * @returns Validated CodexOAuthToken with account_id
   * @throws Error if code verifier not found for state or token exchange fails
   */
  async exchangeCodeForToken(
    authCode: string,
    redirectUri: string,
    state: string,
    signal?: AbortSignal,
  ): Promise<CodexOAuthToken> {
    this.logger.debug(
      () =>
        `[FLOW] exchangeCodeForToken() called with code=${authCode.substring(0, 10)}..., redirectUri=${redirectUri}, state=${state.substring(0, 8)}...`,
    );

    const codeVerifier = this.codeVerifiers.get(state);
    if (!codeVerifier) {
      this.logger.debug(
        () =>
          `[FLOW] PKCE verifier NOT FOUND for state! Available states: ${Array.from(
            this.codeVerifiers.keys(),
          )
            .map((k) => k.substring(0, 8))
            .join(', ')}`,
      );
      throw new Error(`PKCE code verifier not found for state: ${state}`);
    }
    this.logger.debug(
      () =>
        `[FLOW] Found PKCE verifier for state, length=${codeVerifier.length}`,
    );

    try {
      const tokenResponse = await this.performTokenExchange(
        authCode,
        redirectUri,
        codeVerifier,
        signal,
      );
      return this.buildCodexToken(tokenResponse);
    } finally {
      this.codeVerifiers.delete(state);
      this.logger.debug(
        () =>
          `[FLOW] Cleaned up PKCE verifier, remaining: ${this.codeVerifiers.size}`,
      );
    }
  }

  /**
   * POST to the token endpoint and return a validated CodexTokenResponse.
   * @throws Error if the HTTP request fails or the response is not OK
   */
  private async performTokenExchange(
    authCode: string,
    redirectUri: string,
    codeVerifier: string,
    signal?: AbortSignal,
  ): Promise<z.infer<typeof CodexTokenResponseSchema>> {
    this.logger.debug(
      () =>
        `[FLOW] Making token exchange request to ${CODEX_CONFIG.tokenEndpoint}`,
    );

    const response = await this.fetchWithDeadline(
      CODEX_CONFIG.tokenEndpoint,
      {
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
          code_verifier: codeVerifier,
        }).toString(),
      },
      signal,
    );

    this.logger.debug(
      () => `[FLOW] Token exchange response status: ${response.status}`,
    );

    if (!response.ok) {
      const errorText = response.text;
      this.logger.debug(`[FLOW] Token exchange FAILED: ${errorText}`);
      throw new Error(`Token exchange failed: ${response.status} ${errorText}`);
    }

    const data = this.parseSuccessfulJson(response, 'Token exchange');
    this.logger.debug(
      () =>
        `[FLOW] Token response received, keys: ${Object.keys(data as object).join(', ')}`,
    );

    const tokenResponse = CodexTokenResponseSchema.parse(data);
    this.logger.debug(
      () =>
        `[FLOW] Token response validated: has_id_token=${!!tokenResponse.id_token}, has_refresh_token=${!!tokenResponse.refresh_token}, expires_in=${tokenResponse.expires_in}`,
    );
    return tokenResponse;
  }

  /**
   * Validate token response, extract account_id, and build a CodexOAuthToken.
   * @throws Error if id_token is missing or account_id cannot be extracted
   */
  private buildCodexToken(
    tokenResponse: z.infer<typeof CodexTokenResponseSchema>,
  ): CodexOAuthToken {
    // Extract account_id from id_token JWT
    this.logger.debug('[FLOW] Extracting account_id from id_token...');
    const accountId = tokenResponse.id_token
      ? this.extractAccountIdFromIdToken(tokenResponse.id_token)
      : this.throwMissingAccountId();
    this.logger.debug(
      () => `[FLOW] Extracted account_id: ${accountId.substring(0, 8)}...`,
    );

    // Build validated Codex token - use Unix timestamp in SECONDS (not milliseconds)
    const now = Math.floor(Date.now() / 1000);
    // expires_in 0 is invalid, treat nullish/NaN/0 as default 1 hour
    const rawExpiresIn = tokenResponse.expires_in;
    const expiresIn =
      typeof rawExpiresIn === 'number' &&
      !Number.isNaN(rawExpiresIn) &&
      rawExpiresIn !== 0
        ? rawExpiresIn
        : 3600;
    const expiry = now + expiresIn;

    this.logger.debug(
      () =>
        `[FLOW] Building CodexOAuthToken with expiry=${expiry} (in ${expiresIn}s)`,
    );

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
        `[FLOW] Token exchange successful! account_id=${accountId.substring(0, 8)}..., token_type=${codexToken.token_type}`,
    );

    return codexToken;
  }

  /**
   * Refresh an expired access token using refresh token
   * @param refreshToken Valid refresh token
   * @returns New CodexOAuthToken with updated expiry
   * @throws Error if refresh fails or id_token missing
   */
  async refreshToken(
    refreshToken: string,
    signal?: AbortSignal,
  ): Promise<CodexOAuthToken> {
    this.logger.debug('Refreshing expired token');

    const response = await this.fetchWithDeadline(
      CODEX_CONFIG.tokenEndpoint,
      {
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
      },
      signal,
    );

    if (!response.ok) {
      throw new Error(`Token refresh failed: ${response.status}`);
    }

    const data = this.parseSuccessfulJson(response, 'Token refresh');
    const tokenResponse = CodexTokenResponseSchema.parse(data);

    // Extract account_id from new id_token if available
    // For refresh flows, OpenAI may not always return a new id_token,
    // so we allow undefined here (caller should preserve original account_id)
    const accountId = tokenResponse.id_token
      ? this.extractAccountIdFromIdToken(tokenResponse.id_token)
      : undefined;

    // Use Unix timestamp in SECONDS
    const now = Math.floor(Date.now() / 1000);
    // expires_in 0 is invalid, treat nullish/NaN/0 as default 1 hour
    const rawExpiresIn = tokenResponse.expires_in;
    const expiresIn =
      typeof rawExpiresIn === 'number' &&
      !Number.isNaN(rawExpiresIn) &&
      rawExpiresIn !== 0
        ? rawExpiresIn
        : 3600;
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

    // Extract account_id from OpenAI-specific claim or root.
    // Empty-string claims should fall through to the next option.
    const openaiAuth = validated['https://api.openai.com/auth'];
    const accountId = resolveAccountId(
      openaiAuth?.chatgpt_account_id,
      openaiAuth?.account_id,
      validated.account_id,
    );

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
    throw new Error(
      'Cannot extract account_id: id_token missing from token response',
    );
  }

  /**
   * Request a user code for device authorization flow (browserless authentication)
   * @returns Device code response with user_code and device_auth_id
   */
  async requestDeviceCode(signal?: AbortSignal): Promise<{
    device_auth_id: string;
    user_code: string;
    interval: number;
  }> {
    this.logger.debug(
      () =>
        `[DEVICE] Requesting user code from ${CODEX_CONFIG.deviceAuthUserCodeEndpoint}`,
    );
    this.logger.debug(
      () => `[DEVICE] Using client_id: ${CODEX_CONFIG.clientId}`,
    );

    const response = await this.fetchWithDeadline(
      CODEX_CONFIG.deviceAuthUserCodeEndpoint,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          client_id: CODEX_CONFIG.clientId,
        }),
      },
      signal,
    );

    if (!response.ok) {
      if (response.status === 404) {
        throw new Error(
          'Device code authorization is not enabled for this Codex server',
        );
      }
      const errorText = response.text;
      this.logger.debug(
        () => `[DEVICE] User code request FAILED: ${errorText}`,
      );
      throw new Error(
        `User code request failed: ${response.status} ${errorText}`,
      );
    }

    const data = this.parseSuccessfulJson(response, 'Device code request');
    // Log only non-sensitive keys to avoid exposing auth data
    this.logger.debug(
      () =>
        `[DEVICE] User code response keys: ${Object.keys(data as object).join(', ')}`,
    );

    // Parse the response
    const UserCodeResponseSchema = z.object({
      device_auth_id: z.string(),
      user_code: z.string(),
      interval: z
        .union([z.number(), z.string()])
        .transform((val) =>
          typeof val === 'string' ? parseInt(val.trim(), 10) : val,
        )
        .optional()
        .default(5),
    });

    const result = UserCodeResponseSchema.parse(data);

    this.logger.debug(`[DEVICE] Received user code: ${result.user_code}`);

    return result;
  }

  /**
   * Poll for token using device authorization
   * @param deviceAuthId Device authorization ID
   * @param userCode User code from device flow
   * @param intervalSeconds Polling interval in seconds
   * @returns Authorization code and PKCE codes for token exchange
   */
  async pollForDeviceToken(
    deviceAuthId: string,
    userCode: string,
    intervalSeconds: number = 5,
    signal?: AbortSignal,
  ): Promise<{
    authorization_code: string;
    code_verifier: string;
    code_challenge: string;
  }> {
    this.logger.debug('[DEVICE] Starting device token polling');

    const maxWaitMs = 15 * 60 * 1000; // 15 minutes
    const startTime = Date.now();
    const intervalMs = intervalSeconds * 1000;

    while (Date.now() - startTime < maxWaitMs) {
      this.logger.debug(
        () =>
          `[DEVICE] Polling ${CODEX_CONFIG.deviceAuthTokenEndpoint} with device_auth_id=${deviceAuthId}, user_code=${userCode}`,
      );

      const response = await this.fetchWithDeadline(
        CODEX_CONFIG.deviceAuthTokenEndpoint,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            device_auth_id: deviceAuthId,
            user_code: userCode,
          }),
        },
        signal,
      );

      const responseText = response.text;
      // Log status only, not the full response body which may contain sensitive data
      this.logger.debug(
        () => `[DEVICE] Poll response status: ${response.status}`,
      );

      if (response.ok) {
        const data = this.parseSuccessfulJson(response, 'Device token polling');

        // Log only non-sensitive keys to avoid exposing auth data
        this.logger.debug(
          () =>
            `[DEVICE] Token polling successful, keys: ${Object.keys(data as object).join(', ')}`,
        );

        // Parse the successful response - includes authorization_code for token exchange
        const CodeSuccessResponseSchema = z.object({
          authorization_code: z.string(),
          code_verifier: z.string(),
          code_challenge: z.string(),
        });

        return CodeSuccessResponseSchema.parse(data);
      }

      // 403 or 404 means still waiting for user authorization
      if (response.status === 403 || response.status === 404) {
        this.logger.debug(
          () =>
            `[DEVICE] User hasn't authorized yet (${response.status}), waiting ${intervalMs}ms...`,
        );
        await waitForDelay(intervalMs, signal);
        continue;
      }

      // Any other status is an error
      this.logger.debug(`[DEVICE] Token polling FAILED: ${responseText}`);
      throw new Error(
        `Device authorization failed: ${response.status} ${responseText}`,
      );
    }

    throw new Error('Device authorization timed out after 15 minutes');
  }

  private parseDeviceTokenResponse(
    response: ConsumedResponse,
  ): z.infer<typeof CodexTokenResponseSchema> {
    if (!response.ok) {
      this.logger.debug(`[DEVICE] Token exchange FAILED: ${response.text}`);
      throw new Error(
        `Token exchange failed: ${response.status} ${response.text}`,
      );
    }
    const data = this.parseSuccessfulJson(response, 'Token exchange');
    this.logger.debug(
      () =>
        `[DEVICE] Token response received, keys: ${Object.keys(data as object).join(', ')}`,
    );
    return CodexTokenResponseSchema.parse(data);
  }

  /**
   * Complete device authorization flow by exchanging authorization code for tokens
   * @param authorizationCode Authorization code from polling response
   * @param codeVerifier PKCE code verifier from polling response
   * @param redirectUri OAuth redirect URI
   * @returns Complete OAuth token with access_token, refresh_token, etc.
   */
  async completeDeviceAuth(
    authorizationCode: string,
    codeVerifier: string,
    redirectUri: string,
    signal?: AbortSignal,
  ): Promise<CodexOAuthToken> {
    this.logger.debug(
      () => '[DEVICE] Completing device authorization with code exchange',
    );
    this.logger.debug(
      () =>
        `[DEVICE] authCode=${authorizationCode.substring(0, 15)}..., redirectUri=${redirectUri}`,
    );

    // For device flow, we have the code_verifier directly from OpenAI's response
    // instead of looking it up from our PKCE state map
    this.logger.debug(
      () =>
        `[DEVICE] Making token exchange request to ${CODEX_CONFIG.tokenEndpoint}`,
    );

    const response = await this.fetchWithDeadline(
      CODEX_CONFIG.tokenEndpoint,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
        },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code: authorizationCode,
          redirect_uri: redirectUri,
          client_id: CODEX_CONFIG.clientId,
          code_verifier: codeVerifier,
        }).toString(),
      },
      signal,
    );

    this.logger.debug(
      () => `[DEVICE] Token exchange response status: ${response.status}`,
    );

    const tokenResponse = this.parseDeviceTokenResponse(response);
    const hasIdToken = typeof tokenResponse.id_token === 'string';
    const hasRefreshToken = typeof tokenResponse.refresh_token === 'string';
    this.logger.debug(
      () =>
        `[DEVICE] Token response validated: has_id_token=${hasIdToken}, has_refresh_token=${hasRefreshToken}, expires_in=${tokenResponse.expires_in}`,
    );

    // Extract account_id from id_token JWT
    this.logger.debug('[DEVICE] Extracting account_id from id_token...');
    const idToken = tokenResponse.id_token;
    const accountId =
      typeof idToken === 'string'
        ? this.extractAccountIdFromIdToken(idToken)
        : this.throwMissingAccountId();
    this.logger.debug(
      () => `[DEVICE] Extracted account_id: ${accountId.substring(0, 8)}...`,
    );

    // Build and return the CodexOAuthToken
    const now = Date.now();
    // expires_in 0 is invalid, treat nullish/NaN/0 as default 1 hour
    const rawExpiresIn = tokenResponse.expires_in;
    const expiresIn =
      typeof rawExpiresIn === 'number' &&
      !Number.isNaN(rawExpiresIn) &&
      rawExpiresIn !== 0
        ? rawExpiresIn
        : 3600;
    const token: CodexOAuthToken = CodexOAuthTokenSchema.parse({
      access_token: tokenResponse.access_token,
      refresh_token: tokenResponse.refresh_token,
      id_token: tokenResponse.id_token,
      token_type: tokenResponse.token_type,
      expiry: Math.floor(now / 1000) + expiresIn,
      account_id: accountId,
    });

    this.logger.debug(
      () => '[DEVICE] Device authorization completed successfully',
    );

    return token;
  }

  /**
   * Generate PKCE code verifier and challenge
   * @returns Object containing verifier and challenge strings
   */
  private generatePKCE(): { verifier: string; challenge: string } {
    // Generate 64 random bytes for verifier (matches shell script and Rust CLI)
    const verifier = randomBytes(64).toString('base64url');

    // Create SHA-256 hash of verifier for challenge (S256 method)
    const challenge = createHash('sha256').update(verifier).digest('base64url');

    return { verifier, challenge };
  }
}
