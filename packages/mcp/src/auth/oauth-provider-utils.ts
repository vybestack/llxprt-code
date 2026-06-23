/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { DebugLogger } from '@vybestack/llxprt-code-core/debug/DebugLogger.js';
import { firstTruthyString } from '../utils/string-fallback.js';

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
    const error = errorParams.get('error');
    const errorDescription = errorParams.get('error_description');
    if (error) {
      return `${action}: ${error} - ${firstTruthyString(errorDescription, 'No description')}`;
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
    return JSON.parse(responseText) as OAuthTokenResponse;
  } catch {
    // Parse form-urlencoded response
    const tokenParams = new URLSearchParams(responseText);
    const accessToken = tokenParams.get('access_token');
    const tokenType = firstTruthyString(
      tokenParams.get('token_type'),
      'Bearer',
    );
    const expiresIn = tokenParams.get('expires_in');
    const refreshToken = tokenParams.get('refresh_token');
    const scope = tokenParams.get('scope');

    if (!accessToken) {
      const error = tokenParams.get('error');
      const errorDescription = tokenParams.get('error_description');
      throw new Error(
        `${action}: ${firstTruthyString(error, missingTokenError)} - ${firstTruthyString(errorDescription, responseText)}`,
      );
    }

    return {
      access_token: accessToken,
      token_type: tokenType,
      expires_in: expiresIn ? parseInt(expiresIn, 10) : undefined,
      refresh_token:
        refreshToken !== null && refreshToken !== '' ? refreshToken : undefined,
      scope: scope !== null && scope !== '' ? scope : undefined,
    } as OAuthTokenResponse;
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
