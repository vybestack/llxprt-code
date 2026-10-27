/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { JournalReader } from './journalReader.js';
import { TranscriptReader } from './transcript-reader.js';
import { sha256KeyHash } from './idKeys.js';
import { decodeRowHeader } from './rowRecord.js';
import { entryForNewRow, encodeRowDraft } from './rowDraft.js';
import { hydrateChunkHeader, chunkValue } from './chunk-row.js';
import { encodeContentRow } from '../services/history/journalRowCodec.js';
import type { RowEntry } from './rowEntry.js';
import type { IContent } from '../services/history/IContent.js';

export class NativeTranscriptIndex {
  readonly transcript: TranscriptReader;
  private count = 0;
  private lastEntry: { ordinal: number; entry: RowEntry } | undefined;
  constructor(private readonly journal: JournalReader) {
    this.transcript = new TranscriptReader(journal, sha256KeyHash);
  }
  async initialize(): Promise<void> {
    this.count = (await this.transcript.head()).count;
  }
  get rows(): number {
    return this.count;
  }
  async entryAt(ordinal: number): Promise<RowEntry> {
    if (!Number.isSafeInteger(ordinal) || ordinal < 0 || ordinal >= this.count)
      throw new RangeError('Transcript ordinal is outside the published head');
    if (this.lastEntry?.ordinal === ordinal) return this.lastEntry.entry;
    const entry = await this.readEntryAt(ordinal);
    this.lastEntry = { ordinal, entry };
    return entry;
  }
  private async readEntryAt(ordinal: number): Promise<RowEntry> {
    const entry = (
      await this.transcript.page({
        direction: 'forward',
        fromId: BigInt(ordinal) + 1n,
        limit: 1,
      })
    ).find((candidate) => candidate.transcriptId === BigInt(ordinal) + 1n);
    if (entry === undefined) throw new Error('Missing transcript entry');
    if (entry.rowRef === 0) {
      const encoded = encodeRowDraft(
        entry.label,
        encodeContentRow(await this.marker(entry.presentationRef), {
          owner: 0,
        }),
      );
      return entryForNewRow(encoded, entry.presentationRef, entry.transcriptId);
    }
    const head = await this.journal.readRecordHead(entry.rowRef, 'ROW');
    const header = await hydrateChunkHeader(
      this.journal,
      decodeRowHeader(head.kindHeader),
    );
    return entryForNewRow(
      { header, recordLength: entry.recordLength },
      entry.rowRef,
      entry.transcriptId,
    );
  }
  async marker(ref: number): Promise<IContent> {
    const value: unknown = JSON.parse(
      new TextDecoder().decode(await chunkValue(this.journal, ref)),
    );
    if (typeof value !== 'object' || value === null || !('mutation' in value))
      throw new Error('Invalid transcript operation marker');
    return {
      speaker: 'ai',
      blocks: [
        { type: 'text', text: `[context changed: ${String(value.mutation)}]` },
      ],
    };
  }
  async member(entry: RowEntry): Promise<boolean> {
    const [membership] = await this.transcript.membership([entry.transcriptId]);
    return membership.count > 0;
  }
}
