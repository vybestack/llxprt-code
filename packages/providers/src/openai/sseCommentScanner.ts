/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

const LINE_FEED = 0x0a;
const CARRIAGE_RETURN = 0x0d;
const COLON = 0x3a;
const UTF8_BYTE_ORDER_MARK = [0xef, 0xbb, 0xbf] as const;

/**
 * Builds a stateful scanner over the raw bytes of one SSE response body that
 * calls `onComment` once for every complete comment line (a line whose first
 * character is `:`, such as `: keepalive`). Lines end with LF, CR or CRLF per
 * the SSE specification, and lines may be split across chunks. One leading
 * UTF-8 byte order mark is skipped, as the SSE decoder strips it.
 *
 * SSE clients, including the OpenAI SDK's decoder, discard comment lines, yet
 * servers send them precisely to show that a slow generation is still alive
 * (issue #4135). Scanning the bytes before decoding is the only point at
 * which they are observable.
 */
export function createSseCommentScanner(
  onComment: () => void,
): (chunk: Uint8Array) => void {
  let atLineStart = true;
  let inComment = false;
  // Bytes of a leading byte order mark matched so far, or -1 once the stream
  // is past its start.
  let byteOrderMarkMatched = 0;

  /** Whether the byte belongs to the stream's leading byte order mark. */
  const consumeByteOrderMark = (byte: number): boolean => {
    if (byteOrderMarkMatched < 0) return false;
    if (byte === UTF8_BYTE_ORDER_MARK[byteOrderMarkMatched]) {
      byteOrderMarkMatched += 1;
      if (byteOrderMarkMatched === UTF8_BYTE_ORDER_MARK.length)
        byteOrderMarkMatched = -1;
      return true;
    }
    // A partial mark is ordinary content, so the first line has already
    // started with a byte that is not a colon.
    if (byteOrderMarkMatched > 0) atLineStart = false;
    byteOrderMarkMatched = -1;
    return false;
  };

  const scanByte = (byte: number): void => {
    if (consumeByteOrderMark(byte)) return;
    if (byte === LINE_FEED || byte === CARRIAGE_RETURN) {
      if (inComment) onComment();
      inComment = false;
      atLineStart = true;
      return;
    }
    if (atLineStart) inComment = byte === COLON;
    atLineStart = false;
  };

  return (chunk) => {
    for (const byte of chunk) scanByte(byte);
  };
}
