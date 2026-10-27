/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { JournalReader } from './journalReader.js';
import type { RowEntry } from './rowEntry.js';
import { TranscriptReader } from './transcript-reader.js';
import { sha256KeyHash } from './idKeys.js';
import { KeyedMapReader } from './keyedMap.js';
import { BoundedIdNodeCache } from './idTrieCache.js';
import { chunkValue } from './chunk-row.js';
import { decodeStoredRow } from '../services/history/journalRowCodec.js';
import {
  decodeDisplayDescriptor,
  displayRelationKey,
  type JournalDisplayDescriptor,
} from './display-recording.js';

export interface NativeJournalPresentation {
  readonly descriptor: JournalDisplayDescriptor;
  readonly status: number;
}

/** Visible-call lookup is indexed by attempt and call, never by a transcript scan. */
export class NativeDisplayReader {
  private readonly transcript: TranscriptReader;
  private readonly state: KeyedMapReader;
  constructor(private readonly journal: JournalReader) {
    this.transcript = new TranscriptReader(journal, sha256KeyHash);
    this.state = new KeyedMapReader(
      journal,
      new BoundedIdNodeCache(),
      'state',
      sha256KeyHash,
    );
  }
  private async entry(id: bigint) {
    const entries = await this.transcript.page({
      direction: 'forward',
      fromId: id,
      limit: 1,
    });
    const entry = entries.find((candidate) => candidate.transcriptId === id);
    if (entry === undefined)
      throw new Error('Missing display transcript identity');
    return entry;
  }
  async presentation(
    row: RowEntry,
  ): Promise<NativeJournalPresentation | undefined> {
    const entry = await this.entry(row.transcriptId);
    if (
      entry.audience !== 2 ||
      entry.presentationRef === 0 ||
      entry.rowRef === 0
    )
      return undefined;
    return {
      descriptor: decodeDisplayDescriptor(
        await chunkValue(this.journal, entry.presentationRef),
      ),
      status: entry.status,
    };
  }
  async toolRequestIdentity(row: RowEntry) {
    const opener = await this.entry(row.transcriptId);
    let attemptId = '';
    if (opener.attemptRef !== 0) {
      const attempt: unknown = JSON.parse(
        new TextDecoder().decode(
          await chunkValue(this.journal, opener.attemptRef),
        ),
      );
      if (
        typeof attempt !== 'object' ||
        attempt === null ||
        !('id' in attempt) ||
        typeof attempt.id !== 'string'
      )
        throw new Error('Invalid display attempt');
      attemptId = attempt.id;
    }
    return { transcriptId: row.transcriptId.toString(), attemptId };
  }
  async toolPresentation(row: RowEntry, callId: string) {
    const { attemptId } = await this.toolRequestIdentity(row);
    const bytes = await this.state.get(
      this.journal.trailer?.stateRoot ?? 0,
      displayRelationKey(attemptId, callId),
    );
    if (bytes === undefined) return undefined;
    const entry = await this.entry(BigInt(new TextDecoder().decode(bytes)));
    if (entry.status === 6) return undefined;
    const descriptor = decodeDisplayDescriptor(
      await chunkValue(this.journal, entry.presentationRef),
    );
    if (
      entry.audience !== 2 ||
      entry.status !== 1 ||
      descriptor.type !== 'tool-result'
    )
      throw new Error('Invalid tool display relation');
    if (descriptor.attemptId !== attemptId || descriptor.callId !== callId)
      throw new Error('Mismatched tool display relation');
    return {
      descriptor,
      content: decodeStoredRow(await this.transcript.readRow(entry)),
    };
  }
}
