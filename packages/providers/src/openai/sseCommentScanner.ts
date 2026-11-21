/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

const LINE_FEED = 0x0a;
const CARRIAGE_RETURN = 0x0d;
const COLON = 0x3a;

/**
 * Builds a stateful scanner over the raw bytes of one SSE response body that
 * calls `onComment` once for every complete comment line (a line whose first
 * character is `:`, such as `: keepalive`). Lines end with LF, CR or CRLF per
 * the SSE specification, and lines may be split across chunks.
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
  return (chunk) => {
    for (const byte of chunk) {
      if (byte === LINE_FEED || byte === CARRIAGE_RETURN) {
        if (inComment) onComment();
        inComment = false;
        atLineStart = true;
        continue;
      }
      if (atLineStart) inComment = byte === COLON;
      atLineStart = false;
    }
  };
}
