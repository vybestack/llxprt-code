/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */

/**
 * Metadata key carrying the sink a provider calls with the size of the
 * serialized request body once it is final and before it is transmitted. The
 * logging wrapper installs it so `api_request` can carry a size that only the
 * sender knows, without anyone re-reading or re-serializing the rows. Internal
 * plumbing; never sent on the wire.
 */
export const REQUEST_SIZE_SINK_KEY = '__requestSizeSink';

export type RequestSizeSink = (requestChars: number) => void;

function isRequestSizeSink(value: unknown): value is RequestSizeSink {
  return typeof value === 'function';
}

/**
 * Reports the serialized request body size to the wrapper that is logging this
 * call. The size is the body's UTF-8 byte length, the exact Content-Length on
 * the HTTP transports. A call with no sink installed (no logging wrapper)
 * reports nothing.
 */
export function reportRequestSize(
  metadata: Record<string, unknown> | undefined,
  requestChars: number,
): void {
  const sink = metadata?.[REQUEST_SIZE_SINK_KEY];
  if (sink === undefined) return;
  if (!isRequestSizeSink(sink)) {
    throw new TypeError(`${REQUEST_SIZE_SINK_KEY} must be a function`);
  }
  if (!Number.isSafeInteger(requestChars) || requestChars < 0) {
    throw new RangeError(
      `Request size must be a non-negative integer, got ${requestChars}`,
    );
  }
  sink(requestChars);
}
