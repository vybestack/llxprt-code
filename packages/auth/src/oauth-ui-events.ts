/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * UI-agnostic OAuth UI event types.
 *
 * These types decouple the auth package's OAuth providers from any specific
 * UI layer. The field shapes intentionally mirror the CLI history item
 * variants (info / warning / error / oauth_url) so that a CLI adapter can
 * convert an {@link OAuthUIEvent} into a history item with a trivial
 * pass-through.
 *
 * OAuth providers emit these event kinds; this seam lets the providers live
 * in `@vybestack/llxprt-code-auth` without importing UI types.
 */

/** The set of OAuth UI event discriminator values. */
export type OAuthUIEventType = 'info' | 'warning' | 'error' | 'oauth_url';

/**
 * Discriminated union of all OAuth UI events.
 *
 * - `info`: an informational message, optionally with a custom icon/color.
 * - `warning`: a non-fatal warning message (e.g. a recoverable fallback).
 * - `error`: a non-fatal error message.
 * - `oauth_url`: an authorization URL the user must visit.
 */
export type OAuthUIEvent =
  | {
      readonly type: 'info';
      readonly text: string;
      readonly icon?: string;
      readonly color?: string;
    }
  | { readonly type: 'warning'; readonly text: string }
  | { readonly type: 'error'; readonly text: string }
  | { readonly type: 'oauth_url'; readonly text: string; readonly url: string };

/**
 * Callback invoked when an {@link OAuthUIEvent} is emitted to a handler.
 *
 * Implementations return a numeric id (e.g. a history item id) or `undefined`
 * when no id is produced. The optional `timestamp` carries the originating
 * base timestamp, mirroring the CLI history-item callback contract.
 */
export type OAuthUICallback = (
  event: OAuthUIEvent,
  timestamp?: number,
) => number | undefined;
