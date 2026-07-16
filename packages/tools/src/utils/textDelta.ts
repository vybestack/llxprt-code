/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Normalizes and filters a single streaming text delta for lossless
 * forwarding. Returns `undefined` when the result is the truly empty
 * string; all nonempty content (including whitespace) is preserved.
 *
 * Stateless: cannot correctly join a CRLF pair split across chunk
 * boundaries. For that, use {@link createStreamNormalizer}.
 */
export function toLosslessTextDelta(text: string): string | undefined {
  const normalized = text.replace(/\r\n?/g, '\n');
  return normalized.length > 0 ? normalized : undefined;
}

/** Normalizes CR/CRLF to LF while preserving split CRLF pairs across chunks. */
export interface StreamNormalizer {
  /** Returns normalized text, or `undefined` when nothing should be forwarded. */
  push(text: string): string | undefined;
  /** Emits a buffered trailing CR as LF on stream close. Idempotent. */
  flush(): string | undefined;
}

/**
 * Creates an independent per-stream normalizer. A trailing lone CR is
 * buffered until the next non-empty delta: if it starts with LF the pair
 * collapses to a single LF, otherwise the CR becomes a standalone LF.
 * Empty deltas are no-ops. Call {@link StreamNormalizer.flush} on close.
 */
export function createStreamNormalizer(): StreamNormalizer {
  let pendingCR = false;

  return {
    push(text: string): string | undefined {
      if (text.length === 0) {
        return undefined;
      }

      let candidateChunk = text;

      if (pendingCR) {
        pendingCR = false;
        if (text.charCodeAt(0) === 0x0a) {
          candidateChunk = '\n' + text.slice(1);
        } else {
          candidateChunk = '\n' + text;
        }
      }

      if (text.charCodeAt(text.length - 1) === 0x0d) {
        pendingCR = true;
        candidateChunk = candidateChunk.slice(0, -1);
      }

      const normalizedChunk = candidateChunk.replace(/\r\n?/g, '\n');
      return normalizedChunk.length > 0 ? normalizedChunk : undefined;
    },

    flush(): string | undefined {
      if (!pendingCR) {
        return undefined;
      }
      pendingCR = false;
      return '\n';
    },
  };
}
