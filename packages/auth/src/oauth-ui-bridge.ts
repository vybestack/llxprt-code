/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { OAuthUIEvent, OAuthUICallback } from './oauth-ui-events.js';

/**
 * A minimal no-op logger used by {@link OAuthUIBridge}.
 *
 * The auth package intentionally does not depend on
 * `@vybestack/llxprt-code-core`, so it cannot import `DebugLogger`. The bridge
 * only needs debug-level logging for rare buffer-overflow / delivery-failure
 * diagnostics, which are silent here. A core-backed `DebugLogger` can be
 * injected later if richer diagnostics are required.
 */
const noopLogger = {
  debug(_message: () => string): void {
    /* no-op */
  },
};

/** Maximum number of pending events buffered before drop-oldest. */
export const OAUTH_UI_MAX_PENDING = 32;

interface PendingEvent {
  readonly event: OAuthUIEvent;
  readonly timestamp?: number;
}

export interface OAuthAuthOutcome {
  readonly complete: boolean;
  readonly error: string | undefined;
}

export interface OAuthCodeRequest {
  readonly needsCode: boolean;
  readonly provider: string | undefined;
}

/** What an OAuth provider may do to its manager's dialog state. */
export interface OAuthProviderUIPort {
  emit(event: OAuthUIEvent, timestamp?: number): number | undefined;
  beginDialog(id: string, provider: string): void;
  settleDialog(id: string, error?: unknown): OAuthUIEvent | undefined;
  requestCode(provider: string): void;
  clearCodeRequest(): void;
}

export interface OAuthDialogAttempt {
  readonly id: string;
  readonly provider: string;
  readonly status: 'pending' | 'succeeded' | 'failed';
  readonly error?: string;
}

/**
 * UI-agnostic buffer for OAuth UI events.
 *
 * Ports the exact semantics of the CLI's former `GlobalOAuthUI`:
 * - Events emitted with no callback attached are buffered.
 * - When a callback is attached via {@link setCallback}, buffered events are
 *   flushed FIFO. The callback is installed *before* the flush so reentrant
 *   events go directly to the handler.
 * - The buffer is capped at {@link OAUTH_UI_MAX_PENDING} with drop-oldest
 *   semantics.
 * - {@link clearCallback} detaches the handler but preserves the buffer (so
 *   events survive a UI remount).
 *
 * Each OAuth manager owns one bridge. The bridge also holds that manager's
 * dialog attempt, manual-code request and login outcome, so two managers in
 * one process never share dialog state.
 */
class OAuthUIBridge implements OAuthProviderUIPort {
  private callback: OAuthUICallback | null = null;
  private pending: PendingEvent[] = [];
  private dialogAttempt: OAuthDialogAttempt | undefined;
  private authOutcome: OAuthAuthOutcome = { complete: false, error: undefined };
  private codeRequest: OAuthCodeRequest = {
    needsCode: false,
    provider: undefined,
  };

  private readonly dialogListeners = new Set<() => void>();

  subscribeDialog = (listener: () => void): (() => void) => {
    this.dialogListeners.add(listener);
    return () => {
      this.dialogListeners.delete(listener);
    };
  };

  private notifyDialog(): void {
    for (const listener of this.dialogListeners) listener();
  }

  /** Forget the previous login outcome when a new login starts. */
  resetAuthOutcome(): void {
    this.authOutcome = { complete: false, error: undefined };
  }

  completeAuth(): void {
    this.authOutcome = { complete: true, error: undefined };
  }

  failAuth(message: string): void {
    this.authOutcome = { complete: false, error: message };
  }

  /** Returns the recorded login outcome and clears it, so each is read once. */
  takeAuthOutcome(): OAuthAuthOutcome {
    const outcome = this.authOutcome;
    this.authOutcome = { complete: false, error: undefined };
    return outcome;
  }

  /** A provider needs the user to paste an authorization code. */
  requestCode(provider: string): void {
    this.codeRequest = { needsCode: true, provider };
  }

  /** The code request was answered or abandoned; the provider stays known. */
  clearCodeRequest(): void {
    this.codeRequest = { ...this.codeRequest, needsCode: false };
  }

  getCodeRequest(): OAuthCodeRequest {
    return this.codeRequest;
  }

  beginDialog(id: string, provider: string): void {
    this.dialogAttempt = { id, provider, status: 'pending' };
    this.notifyDialog();
  }

  getDialog(): OAuthDialogAttempt | undefined {
    return this.dialogAttempt;
  }

  dismissDialog(id: string): void {
    if (this.dialogAttempt?.id === id) {
      this.dialogAttempt = undefined;
      this.notifyDialog();
    }
  }

  /**
   * Settle the pending dialog attempt. Returns the failure event for the
   * caller to deliver through its own message owner.
   */
  settleDialog(id: string, error?: unknown): OAuthUIEvent | undefined {
    const attempt = this.dialogAttempt;
    if (attempt?.id !== id || attempt.status !== 'pending') return undefined;
    const message = error instanceof Error ? error.message : String(error);
    this.dialogAttempt =
      error === undefined
        ? { ...attempt, status: 'succeeded' }
        : { ...attempt, status: 'failed', error: message };
    this.notifyDialog();
    if (error === undefined) return undefined;
    return {
      type: 'error',
      text: `${attempt.provider} authentication failed: ${message}`,
    };
  }

  /**
   * Attach the UI callback. Flushes any buffered events in FIFO order.
   * The callback is installed before the flush so concurrent/reentrant events
   * during flush go directly to the handler.
   */
  setCallback(callback: OAuthUICallback): void {
    this.callback = callback;
    const pending = this.pending.splice(0);
    for (const item of pending) {
      try {
        callback(item.event, item.timestamp);
      } catch (error) {
        noopLogger.debug(
          () =>
            `[OAUTH] Failed to deliver buffered event: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }

  /**
   * Detach the UI callback. Does NOT clear the buffer — events persist for the
   * next handler.
   */
  clearCallback(): void {
    this.callback = null;
  }

  /**
   * Emit an event to the handler if attached, otherwise buffer it.
   *
   * When buffered, returns `undefined`. When the buffer is full, the oldest
   * event is dropped.
   */
  emit(event: OAuthUIEvent, timestamp?: number): number | undefined {
    if (this.callback) {
      return this.callback(event, timestamp);
    }
    if (this.pending.length >= OAUTH_UI_MAX_PENDING) {
      this.pending.shift();
      noopLogger.debug(
        () =>
          `[OAUTH] Pending buffer full (${OAUTH_UI_MAX_PENDING}), dropped oldest event`,
      );
    }
    this.pending.push({ event, timestamp });
    return undefined;
  }

  /** Number of events currently buffered. */
  getPendingCount(): number {
    return this.pending.length;
  }

  /** Empty the buffer. */
  clearPending(): void {
    this.pending.length = 0;
  }
}

/** The bridge class, exported for consumers that need to construct their own instance (e.g. tests). */
export { OAuthUIBridge };
