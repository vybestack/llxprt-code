/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * @fix issue1861
 * Implementation of OnAuthErrorHandler for CLI package
 *
 * This class handles 401/403 token revocation errors by:
 * 1. Calling OAuthManager.forceRefreshToken() to get a fresh token
 * 2. Using TOCTOU pattern to handle race conditions with other processes
 */

import {
  type OnAuthErrorHandler,
  DebugLogger,
} from '@vybestack/llxprt-code-core';
import type { BucketFailoverOAuthManagerLike } from './types.js';

const logger = new DebugLogger('llxprt:auth:error-handler');

/**
 * CLI implementation of OnAuthErrorHandler
 *
 * Handles token revocation (401/403) by force-refreshing the OAuth token
 * via OAuthManager. The forceRefreshToken method internally uses TOCTOU
 * pattern to handle race conditions with other processes.
 *
 * @fix issue1861 - Token revocation handling
 */
export class OnAuthErrorHandlerImpl implements OnAuthErrorHandler {
  private readonly oauthManager: BucketFailoverOAuthManagerLike;

  constructor(oauthManager: BucketFailoverOAuthManagerLike) {
    this.oauthManager = oauthManager;

    logger.debug('[issue1861] OnAuthErrorHandlerImpl initialized');
  }

  /**
   * Handle an authentication error by forcing token refresh.
   * Called by RetryOrchestrator and retryWithBackoff on 401/403 errors before retry.
   *
   * @param context - Information about the failed authentication attempt
   * @fix issue1861
   */
  async handleAuthError(context: {
    failedAccessToken: string;
    providerId: string;
    profileId?: string;
    errorStatus: number;
  }): Promise<void> {
    const { failedAccessToken, providerId, profileId, errorStatus } = context;

    logger.debug(
      () =>
        `[issue1861] handleAuthError called for provider: ${providerId}, status: ${errorStatus}, profile: ${profileId ?? 'default'}`,
    );

    // Call forceRefreshToken to handle the revocation.
    // This uses TOCTOU pattern internally to handle race conditions.
    logger.debug(
      () =>
        `[issue1861] Calling forceRefreshToken for ${providerId} with failed token (hash: ${this.hashToken(failedAccessToken)})`,
    );

    try {
      const refreshedToken = await this.oauthManager.forceRefreshToken(
        providerId,
        failedAccessToken,
      );

      if (refreshedToken) {
        logger.debug(
          () =>
            `[issue1861] Successfully refreshed token for ${providerId} (new token hash: ${this.hashToken(refreshedToken.access_token)})`,
        );
      } else {
        logger.debug(
          () =>
            `[issue1861] forceRefreshToken returned null for ${providerId} - refresh may not have been possible`,
        );
      }
    } catch (error) {
      // Log but don't throw - the retry should still proceed
      logger.debug(
        () =>
          `[issue1861] forceRefreshToken failed for ${providerId}: ${error instanceof Error ? error.message : error}`,
      );
    }
  }

  /**
   * Create a simple hash of a token for logging purposes (not for security)
   */
  private hashToken(token: string): string {
    if (token.length <= 8) {
      return '[short]';
    }
    return `${token.slice(0, 4)}...${token.slice(-4)}`;
  }
}
