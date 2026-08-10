/**
 * Copyright 2026 Vybestack LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * Canonical bounded first-line reader for session JSONL recordings (Item 7).
 *
 * This is the **single** shared reader used by session discovery, resume
 * (ReplayEngine), and the session-recording janitor.  It replaces the former
 * split approach (a fixed 4 KiB buffer that fell back to an unbounded
 * readline stream) with one implementation that:
 *
 * - Strips a UTF-8 BOM prefix.
 * - Reads the first line in bounded chunks, growing up to a documented maximum.
 * - Supports valid first-line headers far larger than the old 4 KiB buffer.
 * - Classifies a no-newline/malformed file exceeding the maximum as unreadable
 *   (`null`) **without** buffering the entire file into memory.
 *
 * The maximum is deliberately generous (1 MiB) — far above any legitimate
 * `session_start` header — so real recordings are always read while a giant
 * no-newline file is rejected promptly.
 */

import * as fs from 'node:fs/promises';
import { StringDecoder } from 'node:string_decoder';

/**
 * Maximum number of bytes the reader will inspect when searching for the first
 * newline.  A file whose first line exceeds this limit (with no newline) is
 * classified as unreadable without reading further.
 */
export const BOUNDED_HEADER_MAX_BYTES = 1024 * 1024; // 1 MiB

/** Size of each read chunk when searching for the first newline. */
const READ_CHUNK_SIZE = 64 * 1024; // 64 KiB

/** UTF-8 BOM byte sequence. */
const BOM = '\uFEFF';

/** Strip the UTF-8 BOM from the start of a chunk if present. */
function stripBom(text: string, alreadyStripped: boolean): string {
  if (alreadyStripped) return text;
  if (text.startsWith(BOM)) return text.slice(BOM.length);
  return text;
}

/**
 * Read the first line from `filePath` using a bounded, chunked read.
 *
 * Uses a streaming {@link StringDecoder} so that multi-byte UTF-8 characters
 * split across the 64 KiB chunk boundary are decoded correctly rather than
 * producing stray replacement characters.
 *
 * @returns The first line as a UTF-8 string (with BOM stripped), or `null`
 *          when the file is empty, unreadable, or its first line exceeds
 *          {@link BOUNDED_HEADER_MAX_BYTES} without a newline terminator.
 */
export async function readBoundedFirstLine(
  filePath: string,
): Promise<string | null> {
  let fh: fs.FileHandle | undefined;
  try {
    fh = await fs.open(filePath, 'r');
  } catch {
    return null;
  }

  const decoder = new StringDecoder('utf-8');

  try {
    let accumulated = '';
    let offset = 0;
    let bomStripped = false;

    for (;;) {
      if (offset >= BOUNDED_HEADER_MAX_BYTES) return null;

      const chunkSize = Math.min(
        READ_CHUNK_SIZE,
        BOUNDED_HEADER_MAX_BYTES - offset,
      );
      const buf = Buffer.alloc(chunkSize);
      const { bytesRead } = await fh.read(buf, 0, chunkSize, offset);

      if (bytesRead === 0) {
        // EOF — flush any remaining buffered bytes from the decoder.
        const tail = decoder.end();
        const text = stripBom(tail, bomStripped);
        accumulated += text;
        return accumulated.length > 0 ? accumulated : null;
      }

      // The decoder correctly carries over incomplete multi-byte sequences
      // across chunk boundaries.
      const decoded = decoder.write(buf.subarray(0, bytesRead));
      const text = stripBom(decoded, bomStripped);
      // Only mark BOM as handled once the decoder has produced text.
      // On a short read the first chunk may contain only the leading bytes
      // of a multi-byte BOM, causing the decoder to buffer them without
      // emitting any character.  Prematurely setting bomStripped here would
      // let the BOM leak into a subsequent chunk's output unstripped.
      if (decoded.length > 0) {
        bomStripped = true;
      }

      const newlineIdx = text.indexOf('\n');
      if (newlineIdx >= 0) {
        accumulated += text.slice(0, newlineIdx);
        return accumulated;
      }
      accumulated += text;
      offset += bytesRead;
    }
  } catch {
    return null;
  } finally {
    try {
      await fh.close();
    } catch {
      // Swallow close errors to preserve the null-on-unreadable contract.
    }
  }
}
