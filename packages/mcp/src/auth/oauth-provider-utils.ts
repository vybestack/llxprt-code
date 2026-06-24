/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { DebugLogger } from '@vybestack/llxprt-code-core/debug/DebugLogger.js';

const debugLogger = new DebugLogger('llxprt:mcp:oauth');

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

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined;
}

function normalizeTokenResponse(
  response: Partial<OAuthTokenResponse>,
  action: string,
  responseText: string,
  missingTokenError: string,
): OAuthTokenResponse {
  const accessToken = nonEmptyString(response.access_token);
  if (accessToken === undefined) {
    throw new Error(`${action}: ${missingTokenError} - ${responseText}`);
  }

  const normalized: OAuthTokenResponse = {
    access_token: accessToken,
    token_type: nonEmptyString(response.token_type) ?? 'Bearer',
  };

  if (response.expires_in !== undefined) {
    normalized.expires_in = response.expires_in;
  }

  const refreshToken = nonEmptyString(response.refresh_token);
  if (refreshToken !== undefined) {
    normalized.refresh_token = refreshToken;
  }

  const scope = nonEmptyString(response.scope);
  if (scope !== undefined) {
    normalized.scope = scope;
  }

  return normalized;
}

/**
 * Parse an error message from a form-urlencoded token response body.
 * Returns null if no error can be extracted.
 */
export function parseTokenErrorResponse(
  responseText: string,
  action: string,
): string | null {
  try {
    const errorParams = new URLSearchParams(responseText);
    const error = nonEmptyString(errorParams.get('error'));
    const errorDescription =
      nonEmptyString(errorParams.get('error_description')) ?? 'No description';
    if (error !== undefined) {
      return `${action}: ${error} - ${errorDescription}`;
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
export function parseTokenResponse(
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
    return normalizeTokenResponse(
      JSON.parse(responseText) as Partial<OAuthTokenResponse>,
      action,
      responseText,
      missingTokenError,
    );
  } catch (error) {
    if (!(error instanceof SyntaxError)) {
      throw error;
    }

    // Parse form-urlencoded response
    const tokenParams = new URLSearchParams(responseText);
    const expiresIn = nonEmptyString(tokenParams.get('expires_in'));
    const parsedResponse: Partial<OAuthTokenResponse> = {
      access_token: tokenParams.get('access_token') ?? undefined,
      token_type: tokenParams.get('token_type') ?? undefined,
      expires_in: expiresIn !== undefined ? parseInt(expiresIn, 10) : undefined,
      refresh_token: tokenParams.get('refresh_token') ?? undefined,
      scope: tokenParams.get('scope') ?? undefined,
    };

    if (nonEmptyString(parsedResponse.access_token) === undefined) {
      const error =
        nonEmptyString(tokenParams.get('error')) ?? missingTokenError;
      const errorDescription =
        nonEmptyString(tokenParams.get('error_description')) ?? responseText;
      throw new Error(`${action}: ${error} - ${errorDescription}`);
    }

    return normalizeTokenResponse(
      parsedResponse,
      action,
      responseText,
      missingTokenError,
    );
  }
}

/**
 * Resolve the listen port from env var, explicit argument, or OS-assigned default.
 * Returns the port number or throws if the env var value is invalid.
 */
export function resolveListenPort(
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
