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
 * @plan PLAN-20260917-ISSUE854.P01
 * @requirement REQ-854-002
 * Offset index over the scrollback journal. Appends one entry per journal
 * record, validates the index against the journal size on open, and rebuilds
 * only the un-indexed suffix after a crash. Page reads seek to the recorded
 * byte offset and read exactly the recorded length, so no full-file parse is
 * ever needed.
 */

import * as fs from 'node:fs';
import {
  type ScrollbackIndexEntry,
  type ScrollbackRecord,
  parseScrollbackIndexEntry,
  parseScrollbackRecord,
  recordChronologySeq,
} from './scrollbackRecords.js';

export interface ScrollbackPageEntry {
  readonly entry: ScrollbackIndexEntry;
  readonly record: ScrollbackRecord;
}

function journalSize(journalPath: string): number {
  try {
    return fs.statSync(journalPath).size;
  } catch {
    return 0;
  }
}

function readIndexEntries(indexPath: string): ScrollbackIndexEntry[] {
  let raw: string;
  try {
    raw = fs.readFileSync(indexPath, 'utf-8');
  } catch {
    return [];
  }
  const entries: ScrollbackIndexEntry[] = [];
  for (const line of raw.split('\n')) {
    const entry = parseScrollbackIndexEntry(line);
    if (entry !== null) {
      entries.push(entry);
    }
  }
  return entries;
}

/**
 * Scans the journal suffix starting at `fromOffset` and returns one index
 * entry per complete line. A torn final line (no trailing newline) is
 * ignored; the next append overwrites it is impossible in append mode, so a
 * torn tail simply stays unindexed until the file is rewritten by the janitor.
 */
function scanJournalSuffix(
  journalPath: string,
  fromOffset: number,
): { entries: ScrollbackIndexEntry[]; endOffset: number } {
  const size = journalSize(journalPath);
  if (size <= fromOffset) {
    return { entries: [], endOffset: Math.max(fromOffset, 0) };
  }
  const fd = fs.openSync(journalPath, 'r');
  try {
    const length = size - fromOffset;
    const buffer = Buffer.alloc(length);
    fs.readSync(fd, buffer, 0, length, fromOffset);
    const text = buffer.toString('utf-8');
    const entries: ScrollbackIndexEntry[] = [];
    let offset = fromOffset;
    let cursor = 0;
    while (cursor < text.length) {
      const newlineAt = text.indexOf('\n', cursor);
      if (newlineAt === -1) {
        break;
      }
      const line = text.slice(cursor, newlineAt);
      const lineBytes = Buffer.byteLength(line, 'utf-8');
      const record = parseScrollbackRecord(line);
      if (record !== null) {
        entries.push({
          uiSeq: record.uiSeq,
          byteOffset: offset,
          byteLen: lineBytes,
          kind: record.rec === 'item' ? record.kind : record.rec,
          chronologySeq: recordChronologySeq(record),
        });
      }
      offset += lineBytes + 1;
      cursor = newlineAt + 1;
    }
    return { entries, endOffset: offset };
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * @plan PLAN-20260917-ISSUE854.P01
 * @requirement REQ-854-002
 */
export class ScrollbackIndex {
  private appendFd: number | null = null;
  private readonly entries: ScrollbackIndexEntry[];
  private readonly journalPath: string;
  private readonly indexPath: string;

  private constructor(
    journalPath: string,
    indexPath: string,
    entries: ScrollbackIndexEntry[],
  ) {
    this.journalPath = journalPath;
    this.indexPath = indexPath;
    this.entries = entries;
  }

  /**
   * Opens (or creates) the index for `journalPath`, validating the recorded
   * offsets against the journal's actual size and rebuilding only the
   * un-indexed suffix. Existing index entries are never rewritten.
   */
  static open(journalPath: string, indexPath: string): ScrollbackIndex {
    const size = journalSize(journalPath);
    let entries = readIndexEntries(indexPath);
    // Drop entries (and any torn trailing entry) that point past the journal.
    while (
      entries.length > 0 &&
      entries[entries.length - 1].byteOffset + entries[entries.length - 1].byteLen >
        size
    ) {
      entries = entries.slice(0, -1);
    }
    const last = entries[entries.length - 1];
    const coveredThrough = last === undefined ? 0 : last.byteOffset + last.byteLen;
    if (coveredThrough < size) {
      const rebuilt = scanJournalSuffix(journalPath, coveredThrough);
      if (rebuilt.entries.length > 0) {
        const fd = fs.openSync(indexPath, 'a');
        try {
          for (const entry of rebuilt.entries) {
            fs.writeSync(fd, `${JSON.stringify(entry)}\n`);
          }
        } finally {
          fs.closeSync(fd);
        }
      }
      entries = [...entries, ...rebuilt.entries];
    }
    return new ScrollbackIndex(journalPath, indexPath, entries);
  }

  /** Number of indexed journal records. */
  get size(): number {
    return this.entries.length;
  }

  /** Highest indexed uiSeq, or 0 for an empty index. */
  get lastUiSeq(): number {
    const last = this.entries[this.entries.length - 1];
    return last === undefined ? 0 : last.uiSeq;
  }

  /** Timeline metadata without parsing any journal payloads. */
  getRangeMeta(): { count: number; firstUiSeq: number; lastUiSeq: number } {
    const first = this.entries[0];
    return {
      count: this.entries.length,
      firstUiSeq: first === undefined ? 0 : first.uiSeq,
      lastUiSeq: this.lastUiSeq,
    };
  }

  /** Appends one entry line to the index file and the in-memory list. */
  append(entry: ScrollbackIndexEntry): void {
    if (this.appendFd === null) {
      this.appendFd = fs.openSync(this.indexPath, 'a');
    }
    fs.writeSync(this.appendFd, `${JSON.stringify(entry)}\n`);
    this.entries.push(entry);
  }

  /**
   * Reads journal records for the inclusive uiSeq range [a, b] via bounded
   * seeks. Unknown uiSeq values are skipped; the array is ordered by uiSeq.
   */
  pageRead(a: number, b: number): ScrollbackPageEntry[] {
    const results: ScrollbackPageEntry[] = [];
    if (this.entries.length === 0) {
      return results;
    }
    const fd = fs.openSync(this.journalPath, 'r');
    try {
      for (const entry of this.entries) {
        if (entry.uiSeq < a || entry.uiSeq > b) {
          continue;
        }
        const buffer = Buffer.alloc(entry.byteLen);
        const read = fs.readSync(fd, buffer, 0, entry.byteLen, entry.byteOffset);
        const record = parseScrollbackRecord(
          buffer.toString('utf-8', 0, read),
        );
        if (record !== null) {
          results.push({ entry, record });
        }
      }
    } finally {
      fs.closeSync(fd);
    }
    return results;
  }

  /** Releases the append handle; safe to call more than once. */
  close(): void {
    if (this.appendFd !== null) {
      fs.closeSync(this.appendFd);
      this.appendFd = null;
    }
  }
}
