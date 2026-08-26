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
  constructor(
    message = 'Provider stream delivered a structurally invalid event',
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'MalformedStreamEventError';
  }
}

export function isStreamTruncatedError(error: unknown): boolean {
  return (
    error instanceof StreamTruncatedError ||
    (typeof error === 'object' &&
      error !== null &&
      (error as { name?: unknown }).name === 'StreamTruncatedError')
  );
}

export function isMalformedStreamEventError(error: unknown): boolean {
  return (
    error instanceof MalformedStreamEventError ||
    (typeof error === 'object' &&
      error !== null &&
      (error as { name?: unknown }).name === 'MalformedStreamEventError')
  );
}
