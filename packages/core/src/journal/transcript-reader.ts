/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { JournalReader } from './journalReader.js';
import type { IdKeyHasher } from './idKeys.js';
import { BoundedIdNodeCache } from './idTrieCache.js';
import { KeyedMapReader } from './keyedMap.js';
import { decodeRowHeader } from './rowRecord.js';
import { entryForNewRow } from './rowDraft.js';
import { readStoredRow, type StoredRow } from './rowReads.js';
import {
  TRANSCRIPT_HEAD_KEY,
  decodeTranscriptHead,
  decodeMembership,
  type TranscriptHead,
  type TranscriptMembership,
} from './transcript-head.js';
import { transcriptEntries, type TranscriptEntry } from './transcript-tree.js';
import { JournalFormatError } from './errors.js';

export interface TranscriptPageOptions {
  readonly direction: 'forward' | 'backward';
  /** Inclusive id anchor. An omitted anchor starts at the corresponding end. */
  readonly fromId?: bigint;
  readonly limit: number;
}

/** Bound to one published trailer. Decodes only rows explicitly requested by its caller. */
export class TranscriptReader {
  private readonly state: KeyedMapReader;
  private readonly meta: KeyedMapReader;
  private headValue: Promise<TranscriptHead> | undefined;
  constructor(
    private readonly journal: JournalReader,
    hasher: IdKeyHasher,
  ) {
    this.state = new KeyedMapReader(
      journal,
      new BoundedIdNodeCache(),
      'state',
      hasher,
    );
    this.meta = new KeyedMapReader(
      journal,
      new BoundedIdNodeCache(),
      'meta',
      hasher,
    );
  }
  head(): Promise<TranscriptHead> {
    this.headValue ??= this.state
      .get(this.journal.trailer?.stateRoot ?? 0, TRANSCRIPT_HEAD_KEY)
      .then(decodeTranscriptHead);
    return this.headValue;
  }
  async page(options: TranscriptPageOptions): Promise<TranscriptEntry[]> {
    if (
      !Number.isSafeInteger(options.limit) ||
      options.limit < 0 ||
      options.limit > 256
    )
      throw new RangeError('Transcript page limit must be between 0 and 256');
    if (options.limit === 0) return [];
    const head = await this.head();
    const backward = options.direction === 'backward';
    const fromId = options.fromId ?? (backward ? head.nextId - 1n : 1n);
    const entries: TranscriptEntry[] = [];
    for await (const entry of transcriptEntries(
      this.journal,
      head.root,
      'transcript',
      fromId,
      backward,
    )) {
      entries.push(entry);
      if (entries.length === options.limit) break;
    }
    return entries;
  }
  async membership(ids: readonly bigint[]): Promise<TranscriptMembership[]> {
    if (ids.length > 256)
      throw new RangeError(
        'Membership queries are limited to one visible page',
      );
    const members: TranscriptMembership[] = [];
    for (const id of ids)
      members.push(
        decodeMembership(
          await this.meta.get(
            this.journal.trailer?.metaRoot ?? 0,
            `member:${id}`,
          ),
        ),
      );
    return members;
  }
  async readRow(entry: TranscriptEntry): Promise<StoredRow> {
    if (entry.rowRef === 0)
      throw new JournalFormatError('An operation marker has no ROW payload');
    const head = await this.journal.readRecordHead(entry.rowRef, 'ROW');
    const header = decodeRowHeader(head.kindHeader);
    return readStoredRow(
      this.journal,
      entryForNewRow(
        { header, recordLength: entry.recordLength },
        entry.rowRef,
      ),
      head,
    );
  }
}
