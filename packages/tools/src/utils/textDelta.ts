/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Normalizes and filters a streaming text delta for lossless forwarding.
 *
 * Applies only transport-safe CR/CRLF-to-LF normalization and returns
 * `undefined` when the normalized result is the truly empty string. All
 * nonempty content — including standalone whitespace (spaces, tabs,
 * newlines) — is preserved exactly so callers never drop meaningful
 * formatting deltas.
 */
export function toLosslessTextDelta(text: string): string | undefined {
  const normalized = text.replace(/\r\n?/g, '\n');
  return normalized.length > 0 ? normalized : undefined;
}
