/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { ReplacementRow } from '../../journal/groupEdits.js';
import { ChronologyFacts } from '../../journal/chronologyFacts.js';
import type { RowEntry } from '../../journal/rowEntry.js';
import type { VersionSnapshot } from '../../journal/versionSnapshot.js';
import { mapRowStream } from '../../journal/mapped-row-stream.js';
import type { IContent } from './IContent.js';
import { decodeStoredRow, encodeContentRow } from './journalRowCodec.js';

async function candidate(
  snapshot: VersionSnapshot,
  content: IContent,
  index: number,
): Promise<RowEntry | undefined> {
  if (snapshot.rows === 0) return undefined;
  const seq = content.metadata?.chronology?.seq;
  if (seq !== undefined) {
    const facts = new ChronologyFacts(snapshot.facts);
    if ((await facts.count(BigInt(seq), false)) === 1) {
      const label = await facts.label(BigInt(seq), false, 1);
      if (label === undefined)
        throw new Error('Unique chronology row has no label');
      return snapshot.entryByLabel(label);
    }
  }
  return index < snapshot.rows ? snapshot.entryAt(index) : undefined;
}

/** Compare one candidate body, then let self-adoption retain its physical record. */
export function replacementRows(
  snapshot: VersionSnapshot,
  rows: Iterable<IContent> | AsyncIterable<IContent>,
  owner: number,
): AsyncGenerator<ReplacementRow> {
  let index = 0;
  return mapRowStream(rows, async (content): Promise<ReplacementRow> => {
    const entry = await candidate(snapshot, content, index++);
    if (entry !== undefined) {
      const stored = decodeStoredRow(await snapshot.readRow(entry));
      if (JSON.stringify(stored) === JSON.stringify(content)) {
        const row = snapshot.sourceRow(entry);
        return { ...row, entry: { ...entry, owner } };
      }
    }
    return encodeContentRow(content, { owner });
  });
}
