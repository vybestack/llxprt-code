/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Shared provider utilities for OAuth providers.
 * Extracted from the four CLI OAuth providers to eliminate DRY violations.
 */

import { OAuthError, OAuthErrorFactory } from '@vybestack/llxprt-code-core';
import type { OAuthToken } from '@vybestack/llxprt-code-core';

/**
 * Initialization state machine values shared across all four CLI OAuth providers.
 */
export enum InitializationState {
  NotStarted = 'not-started',
  InProgress = 'in-progress',
  Completed = 'completed',
  Failed = 'failed',
}

/**
 * Manages the lazy-initialization state machine for OAuth providers.
 *
 * Two error modes:
 * - 'wrap': wraps unknown errors via OAuthErrorFactory.fromUnknown and stores
 *   initializationError (Anthropic, Gemini, Qwen semantics)
 * - 'rethrow': rethrows unknown errors directly without wrapping (Codex semantics)
 */
export class InitializationGuard {
  private state = InitializationState.NotStarted;
  private promise?: Promise<void>;
  private error?: Error;

  constructor(
    private readonly mode: 'wrap' | 'rethrow' = 'wrap',
    private readonly providerName?: string,
  ) {}

  getState(): InitializationState {
    return this.state;
  }

  /**
   * Ensures the provided initFn runs exactly once, handling concurrent callers.
   * On failure: resets to NotStarted for next attempt but re-throws the error.
   */
  async ensureInitialized(initFn: () => Promise<void>): Promise<void> {
    // Already completed — fast path
    if (this.state === InitializationState.Completed) {
      return;
    }

    // Failed — allow retry by resetting to NotStarted
    if (this.state === InitializationState.Failed) {
      this.state = InitializationState.NotStarted;
      this.promise = undefined;
      this.error = undefined;
    }

    // Start initialization if not yet started
    if (this.state === InitializationState.NotStarted) {
      this.state = InitializationState.InProgress;
      this.promise = initFn();
    }

    // Wait for completion — handles concurrent callers sharing the same promise
    if (this.promise != null) {
      try {
        await this.promise;
        this.state = InitializationState.Completed;
      } catch (error) {
        this.state = InitializationState.Failed;

        if (this.mode === 'wrap') {
          this.error =
            error instanceof OAuthError
              ? error
              : OAuthErrorFactory.fromUnknown(
                  this.providerName ?? 'unknown',
                  error,
                  'ensureInitialized',
                );
          throw this.error;
        } else {
          // rethrow mode — preserve original error
          throw error;
        }
      }
    }
  }

  /** Returns the stored initialization error (wrap mode only). */
  getError(): Error | undefined {
    return this.error;
  }
}

/**
 * Manages the auth-code dialog promise for OAuth providers that use a
 * browser/paste-box flow (Anthropic and Gemini).
 */
export class AuthCodeDialog {
  private resolver?: (code: string) => void;
  private rejecter?: (error: Error) => void;

  /**
   * Returns a promise that resolves when submitAuthCode() is called,
   * or rejects when cancelAuth() is called.
   */
  waitForAuthCode(): Promise<string> {
    return new Promise((resolve, reject) => {
      this.resolver = resolve;
      this.rejecter = reject;
    });
  }

  /** Resolve the pending auth-code promise with the given code. */
  submitAuthCode(code: string): void {
    if (this.resolver != null) {
      this.resolver(code);
      this.resolver = undefined;
      this.rejecter = undefined;
    }
  }

  /**
   * Reject the pending auth-code promise with the provided error and clear
   * dialog pending state.
   */
  rejectWithError(error: Error): void {
    (global as unknown as { __oauth_needs_code: boolean }).__oauth_needs_code =
      false;
    if (this.rejecter != null) {
      this.rejecter(error);
      this.resolver = undefined;
      this.rejecter = undefined;
    }
  }

  /**
   * Reject the pending auth-code promise with a cancellation error.
   * Uses OAuthErrorFactory.fromUnknown semantics per spec.
   */
  cancelAuth(providerName: string): void {
    this.rejectWithError(
      OAuthErrorFactory.fromUnknown(
        providerName,
        new Error('OAuth authentication cancelled'),
        'cancelAuth',
      ),
    );
  }

  /** True when a promise is pending (waiting for code or cancellation). */
  hasPendingPromise(): boolean {
    return this.resolver !== undefined;
  }
}

/**
 * Returns true when the token is expired or will expire within bufferSeconds.
 *
 * Shared by Anthropic and Qwen providers (identical 30-second buffer logic).
 */
export function isTokenExpired(token: OAuthToken, bufferSeconds = 30): boolean {
  const now = Date.now() / 1000;
  return token.expiry <= now + bufferSeconds;
}

/**
 * Type predicate: returns true when the token has a non-empty, plausible
 * refresh_token string (length < 1000 prevents obviously invalid values).
 *
 * Canonical implementation extracted from AnthropicOAuthProvider.
 */
export function hasValidRefreshToken(
  token: OAuthToken,
): token is OAuthToken & { refresh_token: string } {
  return (
    typeof token.refresh_token === 'string' &&
    token.refresh_token.trim().length > 0 &&
    token.refresh_token.length < 1000
  );
}
