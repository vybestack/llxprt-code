/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Protocol-level stream failures thrown by provider adapters.
 *
 * Adapters own decoding: they observe provider protocol events and throw
 * these errors when the protocol itself is violated. Shared recovery policy
 * (retry delay, taxonomy, commit gate) consumes them; it never constructs
 * them. Both failures remain retryable before any request output has been
 * exposed, and the commit boundary makes them terminal after output.
 */

/** A stream ended without delivering its terminal protocol event. */
export class StreamTruncatedError extends Error {
  readonly code = 'LLXPRT_STREAM_TRUNCATED';

  constructor(
    message = 'Provider stream ended without a terminal event',
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'StreamTruncatedError';
  }
}

/**
 * A deterministic protocol violation: an event whose meaning requires state
 * the protocol did not establish (e.g. a tool-argument delta with no open
 * tool block).
 */
export class MalformedStreamEventError extends Error {
  readonly code = 'LLXPRT_MALFORMED_STREAM_EVENT';

  constructor(
    message = 'Provider stream delivered a structurally invalid event',
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'MalformedStreamEventError';
  }
}

/**
 * Guards match `instanceof` first, then a name+code duck check for
 * cross-realm/module-duplicate instances. The code marker prevents
 * unrelated errors that merely share a name from being misclassified.
 */
function hasDuckErrorMarker(
  error: unknown,
  name: string,
  code: string,
): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const candidate = error as { name?: unknown; code?: unknown };
  return candidate.name === name && candidate.code === code;
}

export function isStreamTruncatedError(error: unknown): boolean {
  return (
    error instanceof StreamTruncatedError ||
    hasDuckErrorMarker(error, 'StreamTruncatedError', 'LLXPRT_STREAM_TRUNCATED')
  );
}

export function isMalformedStreamEventError(error: unknown): boolean {
  return (
    error instanceof MalformedStreamEventError ||
    hasDuckErrorMarker(
      error,
      'MalformedStreamEventError',
      'LLXPRT_MALFORMED_STREAM_EVENT',
    )
  );
}
