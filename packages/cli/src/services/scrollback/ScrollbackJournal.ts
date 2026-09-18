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
 * @requirement REQ-854-001
 * Append-only UI scrollback journal. Every committed UI history item becomes
 * one JSONL record in `<chatsDir>/sb-<sessionFileBase>.jsonl`, with a
 * sibling offset index `sb-<sessionFileBase>.idx.jsonl` (REQ-854-002).
 * Writes are synchronous appends with explicit flush/fsync at commit points;
 * the journal is never read back into memory by this phase except through
 * the index's page reads.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { ScrollbackIndex } from './scrollbackIndex.js';
import {
  SCROLLBACK_RECORD_VERSION,
  type ScrollbackBoundaryRecord,
  type ScrollbackClearRecord,
  type ScrollbackItemRecord,
  type ScrollbackRecord,
  type ScrollbackRevisionRecord,
  type ScrollbackRewindRecord,
} from './scrollbackRecords.js';
import type { HistoryItem } from '../../ui/types.js';

export interface ScrollbackJournalOptions {
  readonly chatsDir: string;
  readonly sessionFileBase: string;
  readonly enabled: boolean;
}

/** Chronology correlation carried onto a journaled item (REQ-854-003). */
export interface ScrollbackAppendMeta {
  readonly chronologySeq?: number;
  readonly seqSpan?: readonly [number, number];
}

export interface ScrollbackBoundaryInput {
  readonly summaryText: string;
  readonly replacedFromSeq: number;
  readonly replacedToSeq: number;
  readonly itemCount: number;
}

/**
 * @plan PLAN-20260917-ISSUE854.P01
 * @requirement REQ-854-001
 */
export class ScrollbackJournal {
  private index: ScrollbackIndex | null = null;
  private journalFd: number | null = null;
  private uiSeq: number = 0;
  private readonly journalPath: string;
  private readonly indexPath: string;
  private readonly enabled: boolean;

  private constructor(options: ScrollbackJournalOptions) {
    this.journalPath = path.join(
      options.chatsDir,
      `sb-${options.sessionFileBase}.jsonl`,
    );
    this.indexPath = path.join(
      options.chatsDir,
      `sb-${options.sessionFileBase}.idx.jsonl`,
    );
    this.enabled = options.enabled;
  }

  /**
   * Opens the journal for a session. When `enabled` is false the instance is
   * inert: no files are created and every append is a no-op (REQ-854-005).
   * Otherwise the existing index (if any) is validated and its suffix
   * rebuilt, and the uiSeq counter resumes from the index tail so sequences
   * stay strictly monotonic across resume.
   */
  static open(options: ScrollbackJournalOptions): ScrollbackJournal {
    const journal = new ScrollbackJournal(options);
    if (!options.enabled) {
      return journal;
    }
    journal.index = ScrollbackIndex.open(journal.journalPath, journal.indexPath);
    journal.uiSeq = journal.index.lastUiSeq;
    return journal;
  }

  /** True when the journal writes to disk (flag on and recording active). */
  isActive(): boolean {
    return this.enabled;
  }

  /** Timeline length without parsing payloads (delegates to the index). */
  getRangeMeta(): { count: number; firstUiSeq: number; lastUiSeq: number } {
    if (this.index === null) {
      return { count: 0, firstUiSeq: 0, lastUiSeq: 0 };
    }
    return this.index.getRangeMeta();
  }

  /**
   * Journals one committed UI item; returns the assigned uiSeq, or null when
   * disabled. One `item` record is appended and immediately indexed.
   */
  append(item: HistoryItem, meta?: ScrollbackAppendMeta): number | null {
    if (!this.enabled || this.index === null) {
      return null;
    }
    this.uiSeq += 1;
    const record: ScrollbackItemRecord = {
      v: SCROLLBACK_RECORD_VERSION,
      rec: 'item',
      uiSeq: this.uiSeq,
      itemId: item.id,
      ts: new Date().toISOString(),
      kind: item.type,
      ...(meta?.chronologySeq !== undefined
        ? { chronologySeq: meta.chronologySeq }
        : {}),
      ...(meta?.seqSpan !== undefined ? { seqSpan: meta.seqSpan } : {}),
      payload: item,
    };
    this.writeRecord(record, {
      chronologySeq: record.chronologySeq,
    });
    return this.uiSeq;
  }

  /**
   * Journals a committed revision of an already-journaled item. Readers
   * apply revisions last-wins per itemId.
   */
  appendRevision(itemId: number, item: HistoryItem): void {
    if (!this.enabled || this.index === null) {
      return;
    }
    this.uiSeq += 1;
    const record: ScrollbackRevisionRecord = {
      v: SCROLLBACK_RECORD_VERSION,
      rec: 'rev',
      uiSeq: this.uiSeq,
      itemId,
      ts: new Date().toISOString(),
      payload: item,
    };
    this.writeRecord(record);
  }

  /** Journals a compression boundary row. */
  appendBoundary(input: ScrollbackBoundaryInput): void {
    if (!this.enabled || this.index === null) {
      return;
    }
    this.uiSeq += 1;
    const record: ScrollbackBoundaryRecord = {
      v: SCROLLBACK_RECORD_VERSION,
      rec: 'boundary',
      uiSeq: this.uiSeq,
      ts: new Date().toISOString(),
      summaryText: input.summaryText,
      replacedFromSeq: input.replacedFromSeq,
      replacedToSeq: input.replacedToSeq,
      itemCount: input.itemCount,
    };
    this.writeRecord(record);
  }

  /** Journals a /chat clear marker. */
  appendClear(): void {
    if (!this.enabled || this.index === null) {
      return;
    }
    this.uiSeq += 1;
    const record: ScrollbackClearRecord = {
      v: SCROLLBACK_RECORD_VERSION,
      rec: 'clear',
      uiSeq: this.uiSeq,
      ts: new Date().toISOString(),
    };
    this.writeRecord(record);
  }

  /** Journals a rewind marker truncating the logical timeline. */
  appendRewind(truncateAfterUiSeq: number): void {
    if (!this.enabled || this.index === null) {
      return;
    }
    this.uiSeq += 1;
    const record: ScrollbackRewindRecord = {
      v: SCROLLBACK_RECORD_VERSION,
      rec: 'rewind',
      uiSeq: this.uiSeq,
      ts: new Date().toISOString(),
      truncateAfterUiSeq,
    };
    this.writeRecord(record);
  }

  /** Flushes written bytes to stable storage. */
  flush(): void {
    if (this.journalFd !== null) {
      fs.fsyncSync(this.journalFd);
    }
    this.index?.close();
  }

  /** Flushes and releases all handles. The journal must not be reused. */
  close(): void {
    this.flush();
    if (this.journalFd !== null) {
      fs.closeSync(this.journalFd);
      this.journalFd = null;
    }
    this.index = null;
  }

  private writeRecord(
    record: ScrollbackRecord,
    entryMeta?: { chronologySeq?: number },
  ): void {
    if (this.index === null) {
      return;
    }
    if (this.journalFd === null) {
      this.journalFd = fs.openSync(this.journalPath, 'a');
    }
    const line = `${JSON.stringify(record)}\n`;
    const byteOffset = fs.fstatSync(this.journalFd).size;
    const byteLen = Buffer.byteLength(line, 'utf-8');
    fs.writeSync(this.journalFd, line);
    this.index.append({
      uiSeq: record.uiSeq,
      byteOffset,
      byteLen,
      kind: record.rec === 'item' ? record.kind : record.rec,
      ...(entryMeta?.chronologySeq !== undefined
        ? { chronologySeq: entryMeta.chronologySeq }
        : {}),
    });
  }
}
