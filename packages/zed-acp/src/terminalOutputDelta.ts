/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Maximum number of bytes/code units to scan when searching for an overlap
 * between the previous and current terminal snapshots after the peer reports
 * truncation. Keeps the search bounded (issue #3200 finding 6) so a hostile or
 * pathological peer cannot cause super-linear work.
 */
export const OVERLAP_SEARCH_BOUND = 8192;

/**
 * Marker inserted into the output delta when the terminal peer evicts
 * scrollback content and no bounded overlap is found, so the model sees an
 * explicit discontinuity rather than a silent replay or data loss.
 */
export const TERMINAL_DISCONTINUITY_NOTICE =
  '[... terminal output truncated/evicted by peer ...]\n';

export interface DeltaResult {
  /** The incremental chunk to emit (may include a discontinuity notice). */
  readonly delta: string;
  /** True when peer eviction left some prior content unmatched or lost. */
  readonly discontinuity: boolean;
}

/**
 * Compute the KMP prefix (failure) function for `pattern` in O(pattern.length).
 * Used by {@link longestSuffixPrefixOverlap} to avoid the O(n^2) nested scan.
 */
function computePrefixFunction(pattern: string): number[] {
  const pi = new Array<number>(pattern.length).fill(0);
  let k = 0;
  for (let i = 1; i < pattern.length; i++) {
    while (k > 0 && pattern.charCodeAt(k) !== pattern.charCodeAt(i)) {
      k = pi[k - 1];
    }
    if (pattern.charCodeAt(k) === pattern.charCodeAt(i)) {
      k += 1;
    }
    pi[i] = k;
  }
  return pi;
}

/**
 * Return the length of the longest suffix of `text` that equals a prefix of
 * `pattern`, using KMP matching in O(|pattern| + |text|) time (issue #3200
 * finding 6). No sentinel character is needed: the failure function is computed
 * only on `pattern`, and the matcher never indexes past it.
 */
function longestSuffixPrefixOverlap(pattern: string, text: string): number {
  if (pattern.length === 0 || text.length === 0) {
    return 0;
  }
  const pi = computePrefixFunction(pattern);
  const m = pattern.length;
  let q = 0;
  for (let i = 0; i < text.length; i++) {
    // When the full pattern is already matched, fall back via the failure
    // function before trying to extend, so pattern[m] is never indexed.
    if (q === m) {
      q = pi[m - 1];
    }
    const c = text.charCodeAt(i);
    while (q > 0 && pattern.charCodeAt(q) !== c) {
      q = pi[q - 1];
    }
    if (pattern.charCodeAt(q) === c) {
      q += 1;
    }
  }
  return q;
}

/**
 * Compute the incremental delta between two terminal output snapshots using a
 * bounded, truly-linear (KMP) overlap search (issue #3200 finding 6).
 *
 * - **Clean append** (current starts with previous): O(previous.length) slice.
 * - **Non-prefix snapshot**: a bounded overlap search (capped at
 *   {@link OVERLAP_SEARCH_BOUND}) finds the longest suffix of `previous` that
 *   is a prefix of `current` in O(bound) time via the KMP prefix function. If
 *   found, the delta skips the overlap. For truncated snapshots with no overlap,
 *   a {@link TERMINAL_DISCONTINUITY_NOTICE} is emitted instead of silently
 *   replaying the entire window. If the true overlap extends beyond the bounded
 *   search operands, content outside the detected overlap may be replayed; the
 *   discontinuity flag makes that uncertainty explicit for truncated output.
 *   A non-truncated snapshot with no overlap is treated as a reset.
 */
export function computeBoundedDelta(
  previous: string,
  current: string,
  truncated: boolean,
): DeltaResult {
  if (previous.length === 0) {
    return { delta: current, discontinuity: false };
  }

  // Fast path: clean monotonic append.
  if (current.startsWith(previous)) {
    return { delta: current.slice(previous.length), discontinuity: false };
  }

  // The snapshot is not a clean append. Search a bounded suffix/prefix window
  // even when the peer did not report truncation so screen rewrites do not
  // replay bytes that are still present at the snapshot boundary.
  const maxK = Math.min(previous.length, current.length, OVERLAP_SEARCH_BOUND);
  const prevTail = previous.slice(previous.length - maxK);
  const currHead = current.slice(0, maxK);
  const overlap = longestSuffixPrefixOverlap(currHead, prevTail);

  if (overlap > 0) {
    return {
      delta: current.slice(overlap),
      discontinuity: truncated && overlap < previous.length,
    };
  }

  if (!truncated) {
    // No truncation flag and no overlap: the peer replaced the snapshot.
    return { delta: current, discontinuity: false };
  }

  // No overlap found within the bounded search — represent the discontinuity
  // explicitly rather than replaying the entire window.
  return {
    delta: TERMINAL_DISCONTINUITY_NOTICE + current,
    discontinuity: true,
  };
}

/**
 * Bound a snapshot string to its tail by UTF-8 byte budget, never splitting a
 * multibyte character. Used to keep retained polling state bounded to the
 * configured acquisition budget rather than a fixed character cap (issue #3200
 * finding 4).
 */
export function boundSnapshotBytes(text: string, maxBytes: number): string {
  if (maxBytes <= 0) {
    return '';
  }
  if (Buffer.byteLength(text, 'utf8') <= maxBytes) {
    return text;
  }
  // Keep the tail: find the smallest start byte offset such that the retained
  // tail is within the byte budget and begins on a character boundary (a byte
  // that is not a UTF-8 continuation byte).
  const encoded = Buffer.from(text, 'utf8');
  let start = encoded.length - maxBytes;
  if (start < 0) {
    start = 0;
  }
  while (start < encoded.length && (encoded[start] & 0xc0) === 0x80) {
    start += 1;
  }
  return encoded.toString('utf8', start);
}

/**
 * Legacy character-cap snapshot bounding. Prefer {@link boundSnapshotBytes} with
 * the configured byte budget. Retained for existing callers/tests.
 */
export const MAX_RETAINED_SNAPSHOT_CHARS = 1024 * 1024;

export function boundSnapshot(text: string): string {
  if (text.length <= MAX_RETAINED_SNAPSHOT_CHARS) {
    return text;
  }
  let start = text.length - MAX_RETAINED_SNAPSHOT_CHARS;
  const code = text.charCodeAt(start);
  if (code >= 0xdc00 && code <= 0xdfff) {
    start += 1;
  }
  return text.slice(start);
}
