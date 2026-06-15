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
 * A stable global hook `(global).__oauth_add_item` is installed at module load
 * and routes through {@link oauthUIBridge.emit}, preserving compatibility with
 * any consumer (e.g. core's `oauth2.ts`) that reads that global directly.
 */
class OAuthUIBridge {
  private callback: OAuthUICallback | null = null;
  private pending: PendingEvent[] = [];

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

/** Singleton bridge instance. */
export const oauthUIBridge = new OAuthUIBridge();

/**
 * Stable global bridge: always exists from module load, routes through the
 * singleton. Never deleted — events buffer when no handler is attached.
 *
 * Preserves the historical `(global).__oauth_add_item` contract so existing
 * consumers (e.g. core's oauth2.ts path) keep working unchanged.
 */
(global as Record<string, unknown>).__oauth_add_item = (
  event: OAuthUIEvent,
  timestamp?: number,
): number | undefined => oauthUIBridge.emit(event, timestamp);
