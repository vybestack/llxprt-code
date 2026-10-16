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
 * @plan PLAN-20260917-ISSUE854.WP17
 * @requirement R5
 *
 * Bounded first-user-message scan for session titles. Reads the journal
 * forward in fixed-size chunks, assembles one line at a time (never more than
 * `MAX_RECORD_BYTES`; longer lines are skipped like the journal cursor's
 * oversized entries), and stops at the first human text row. Only the capped
 * title is returned, so memory is bounded by one record and I/O ends at the
 * first user message instead of the end of the file.
 */

import * as fs from 'node:fs/promises';
import { MAX_RECORD_BYTES } from './journalCursor.js';

const NEWLINE_BYTE = 0x0a;
const DEFAULT_CHUNK_BYTES = 64 * 1024;

/** Cheap pre-filter: assistant/tool rows are never parsed for titles. */
const HUMAN_SPEAKER_MARKER = '"speaker":"human"';

export interface FirstUserMessageScanOptions {
  /** Read chunk size in bytes; injectable for tests. Default 64 KiB. */
  readonly chunkBytes?: number;
  /** Observes every chunk read from disk (bytes actually read). */
  readonly onChunkRead?: (bytesRead: number) => void;
}

/** Line assembler that refuses to retain more than one bounded record. */
class BoundedLineAssembler {
  private parts: Buffer[] = [];
  private size = 0;
  private oversized = false;

  append(segment: Buffer): void {
    if (this.oversized) return;
    this.size += segment.length;
    if (this.size > MAX_RECORD_BYTES) {
      this.oversized = true;
      this.parts = [];
      return;
    }
    this.parts.push(segment);
  }

  /** Returns the completed line, or null for an oversized/empty line. */
  take(): Buffer | null {
    const line = this.oversized ? null : Buffer.concat(this.parts, this.size);
    this.parts = [];
    this.size = 0;
    this.oversized = false;
    return line;
  }
}

function extractUserMessageText(line: Buffer): string | null {
  if (line.length === 0 || !line.includes(HUMAN_SPEAKER_MARKER)) return null;
  let event: unknown;
  try {
    event = JSON.parse(line.toString('utf8'));
  } catch {
    return null;
  }
  if (typeof event !== 'object' || event === null) return null;
  const record = event as Record<string, unknown>;
  if (record.type !== 'content') return null;
  const payload = record.payload as Record<string, unknown> | undefined;
  if (!payload || typeof payload !== 'object') return null;
  const content = payload.content as Record<string, unknown> | undefined;
  if (!content || typeof content !== 'object') return null;
  if (content.speaker !== 'human' || !Array.isArray(content.blocks)) {
    return null;
  }
  const text = (content.blocks as Array<Record<string, unknown>>)
    .filter((block) => block.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text as string)
    .join('');
  return text || null;
}

/**
 * Return the first human text message of the journal, cut to `maxLength`
 * UTF-16 units, or null when the file is unreadable or has none.
 */
export async function scanFirstUserMessage(
  filePath: string,
  maxLength: number,
  options: FirstUserMessageScanOptions = {},
): Promise<string | null> {
  const chunkBytes = options.chunkBytes ?? DEFAULT_CHUNK_BYTES;
  if (!Number.isSafeInteger(chunkBytes) || chunkBytes <= 0) {
    throw new RangeError('chunkBytes must be a positive safe integer');
  }
  let handle: fs.FileHandle;
  try {
    handle = await fs.open(filePath, 'r');
  } catch {
    return null;
  }
  try {
    const text = await findFirstUserText(handle, chunkBytes, options);
    if (text === null) return null;
    return text.length > maxLength ? text.slice(0, maxLength) : text;
  } catch {
    return null;
  } finally {
    await handle.close().catch(() => undefined);
  }
}

async function findFirstUserText(
  handle: fs.FileHandle,
  chunkBytes: number,
  options: FirstUserMessageScanOptions,
): Promise<string | null> {
  const assembler = new BoundedLineAssembler();
  let position = 0;
  for (;;) {
    const chunk = Buffer.allocUnsafe(chunkBytes);
    const { bytesRead } = await handle.read(chunk, 0, chunkBytes, position);
    if (bytesRead === 0) break;
    options.onChunkRead?.(bytesRead);
    position += bytesRead;
    let start = 0;
    while (start < bytesRead) {
      const newline = chunk.indexOf(NEWLINE_BYTE, start);
      const end = newline === -1 || newline >= bytesRead ? bytesRead : newline;
      assembler.append(chunk.subarray(start, end));
      if (end === bytesRead) break;
      const line = assembler.take();
      const text = line === null ? null : extractUserMessageText(line);
      if (text !== null) return text;
      start = end + 1;
    }
  }
  const tail = assembler.take();
  return tail === null ? null : extractUserMessageText(tail);
}
