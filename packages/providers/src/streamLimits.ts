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

/**
 * Retained fragments per tool call.
 *
 * A byte budget alone does not bound object count: empty or one-byte deltas
 * cost almost nothing against it while each still costs a retained object, so
 * a peer emitting them indefinitely grows memory without ever tripping the
 * byte cap. Streaming a maximum-length tool call one token at a time is on the
 * order of 128,000 fragments, so this sits far above any legitimate call and
 * only catches the degenerate case, where the byte cap never would.
 */
export const MAX_PROVIDER_TOOL_CALL_FRAGMENTS = 500_000;

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

/**
 * Rejects a retained-entry count above `limit`, reported in the same shape as
 * the byte limits so a caller cannot tell them apart at the catch site.
 */
export function assertProviderStreamFragmentLimit(
  description: string,
  retainedCount: number,
  limitCount: number,
): void {
  if (retainedCount > limitCount) {
    throw new ProviderStreamProtocolError(
      `${description} count`,
      limitCount,
      retainedCount,
    );
  }
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

/**
 * Bounds a tool-call arguments payload delivered whole rather than in deltas.
 *
 * Streamed deltas are capped as they accumulate, but a provider that sends the
 * entire arguments in a single terminal event never passes through that path,
 * leaving the per-call limit bounded solely by the far larger SSE line limit.
 */
export function assertToolCallArgumentsWithinLimit(
  args: string | undefined,
): void {
  if (args === undefined) {
    return;
  }
  assertProviderStreamByteLimit(
    'tool-call arguments',
    utf8ByteLength(args),
    MAX_PROVIDER_TOOL_CALL_BYTES,
  );
}

/**
 * Rejects any SSE line over the byte limit, complete lines included.
 *
 * Bounding only the trailing incomplete remainder is trivially bypassed by
 * appending a newline: the line then arrives complete and would go straight to
 * JSON.parse unmeasured.
 *
 * The cheap length pre-check comes first because the remainder is re-examined
 * on every read, so measuring it exactly each time would be O(n^2) in the
 * no-newline case the limit exists to catch.
 */
export function assertSseLinesWithinLimit(
  lines: readonly string[],
  remainder: string,
): void {
  for (const candidate of [...lines, remainder]) {
    if (!exceedsUtf8ByteLimit(candidate, MAX_PROVIDER_SSE_LINE_BYTES)) {
      continue;
    }
    assertProviderStreamByteLimit(
      'SSE line',
      utf8ByteLength(candidate),
      MAX_PROVIDER_SSE_LINE_BYTES,
    );
  }
}
