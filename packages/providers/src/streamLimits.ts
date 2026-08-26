/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { Buffer } from 'node:buffer';
import { ProviderError } from './errors.js';

export const MAX_PROVIDER_TOOL_CALL_BYTES = 16 * 1024 * 1024;
export const MAX_PROVIDER_SSE_LINE_BYTES = 8 * 1024 * 1024;
export const MAX_PROVIDER_REASONING_CAPTURE_BYTES = 8 * 1024 * 1024;
export const MAX_PROVIDER_BUFFERED_TEXT_BYTES = 8 * 1024 * 1024;

export class ProviderStreamProtocolError extends ProviderError {
  readonly category = 'client_error' as const;
  readonly isRetryable = false;
  readonly shouldFailover = false;

  constructor(
    readonly description: string,
    readonly limitBytes: number,
    readonly receivedBytes: number,
  ) {
    super(
      `Provider stream ${description} exceeded ${limitBytes}-byte limit ` +
        `(received ${receivedBytes} bytes).`,
    );
  }
}

export function utf8ByteLength(value: string): number {
  return Buffer.byteLength(value, 'utf8');
}

/**
 * Maximum UTF-8 bytes a single UTF-16 code unit can encode to.
 *
 * Astral code points cost 4 bytes but occupy 2 code units, so 3 bytes per code
 * unit (a BMP character outside Latin-1) is the true worst case.
 */
const MAX_UTF8_BYTES_PER_CODE_UNIT = 3;

/**
 * Whether `value` exceeds `limitBytes` when encoded as UTF-8, without scanning
 * the string unless it is actually close to the limit.
 *
 * Callers that re-check a growing accumulator on every chunk would otherwise
 * pay an O(n) scan per chunk, which is O(n^2) over a stream — quadratic in
 * exactly the pathological case these limits exist to catch. `String.length`
 * is O(1), and UTF-8 length is bounded by three times it, so the cheap
 * comparison settles the common case outright.
 */
export function exceedsUtf8ByteLimit(
  value: string,
  limitBytes: number,
): boolean {
  if (value.length * MAX_UTF8_BYTES_PER_CODE_UNIT <= limitBytes) {
    return false;
  }
  return utf8ByteLength(value) > limitBytes;
}

export function assertProviderStreamByteLimit(
  description: string,
  receivedBytes: number,
  limitBytes: number,
): void {
  if (receivedBytes > limitBytes) {
    throw new ProviderStreamProtocolError(
      description,
      limitBytes,
      receivedBytes,
    );
  }
}
