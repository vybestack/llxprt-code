/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @fileoverview Bounded buffering of streamed text for the OpenAI chat path.
 *
 * Some models (Kimi) emit tool calls inside a delimited text section, so text
 * must be buffered until the section closes rather than flushed at the first
 * natural break. That buffer is fed by the network and had no ceiling, and the
 * section delimiters were counted by re-scanning the whole buffer on every
 * delta, which is quadratic while a section stays open (issue #3341).
 */

import {
  assertProviderStreamByteLimit,
  MAX_PROVIDER_BUFFERED_TEXT_BYTES,
  utf8ByteLength,
} from '../streamLimits.js';
import type { StreamingState } from './OpenAIStreamProcessorState.js';

export const KIMI_SECTION_BEGIN = '<|tool_calls_section_begin|>';
const KIMI_SECTION_END = '<|tool_calls_section_end|>';
const KIMI_SCAN_TAIL_LENGTH =
  Math.max(KIMI_SECTION_BEGIN.length, KIMI_SECTION_END.length) - 1;

function countNewTokenOccurrences(
  text: string,
  token: string,
  previousTailLength: number,
): number {
  let count = 0;
  let searchFrom = 0;
  for (;;) {
    const index = text.indexOf(token, searchFrom);
    if (index === -1) {
      return count;
    }
    if (index + token.length > previousTailLength) {
      count++;
    }
    searchFrom = index + token.length;
  }
}

export function updateKimiSectionCounts(
  deltaContent: string,
  state: StreamingState,
): void {
  const previousTailLength = state.kimiScanTail.length;
  const searchableText = state.kimiScanTail + deltaContent;
  state.kimiBeginCount += countNewTokenOccurrences(
    searchableText,
    KIMI_SECTION_BEGIN,
    previousTailLength,
  );
  state.kimiEndCount += countNewTokenOccurrences(
    searchableText,
    KIMI_SECTION_END,
    previousTailLength,
  );
  state.kimiScanTail = searchableText.slice(-KIMI_SCAN_TAIL_LENGTH);
}

/**
 * Handle text delta content: buffer or immediately emit.
 */
/**
 * Appends a text delta to the buffer, enforcing the byte cap first.
 *
 * The running byte count is incremented by the delta rather than recomputed
 * from the buffer, so the check stays O(1) per delta instead of O(n^2) across
 * a stream that never reaches a flush point.
 */
export function appendBufferedText(
  deltaContent: string,
  state: StreamingState,
): void {
  state.textBufferBytes += utf8ByteLength(deltaContent);
  assertProviderStreamByteLimit(
    'buffered text',
    state.textBufferBytes,
    MAX_PROVIDER_BUFFERED_TEXT_BYTES,
  );
  state.textBuffer += deltaContent;
  updateKimiSectionCounts(deltaContent, state);
}
