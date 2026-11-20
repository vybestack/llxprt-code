/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { EMPTY_SLOT_TABLE } from '../../version.js';
import { IdFactBatch } from '../../idFactBatch.js';
import { BoundedIdNodeCache } from '../../idTrieCache.js';
import { createJournal } from '../../journalWriterOpen.js';
import { KeyedMapBatch, KeyedMapReader } from '../../keyedMap.js';
import { FIRST_NEXT_LABEL, allocateAppendLabels } from '../../labels.js';
import { encodeDecimal, KIMI_EXCEPTION_KEY } from '../../metaFacts.js';
import { RECORD_KIND, MUTATION } from '../../recordKinds.js';
import { encodeRowDraft, entryForNewRow } from '../../rowDraft.js';
import { ROW_SPEAKER } from '../../rowRecord.js';
import { bulkBuildRowTree } from '../../rowTreeBuilder.js';
import { realDeps } from './idFactFixture.js';
import { plainRecord, testJournalSeams } from './journalFixtures.js';
import { type MistralRow } from './mistralFixtures.js';
import { NO_KINDS, testAlgebra } from './rowTreeFixtures.js';
import { SESSION_STATE } from './copyFixtures.js';
import { draftRow, plainPlanner } from './storeFixtures.js';
import type { PlannedRow } from '../../groupEdits.js';
import type { RowDraft } from '../../rowDraft.js';
import type { RowEntry } from '../../rowEntry.js';
import { createRecordAccess, type RecordAccess } from '../../recordAccess.js';
import type { PositionalReader } from '../../positionalFile.js';
import type { RecordAppender } from '../../groupAppender.js';
import { TranscriptTreeWriter } from '../../transcript-tree.js';
import {
  TRANSCRIPT_HEAD_KEY,
  encodeTranscriptHead,
  encodeMembership,
} from '../../transcript-head.js';

const UTF8 = new TextEncoder();
/** The Mistral id mapper keeps one mapped id per format slot; the fixture uses slot 0. */
export const MISTRAL_SLOT = 0;

interface FixtureRow {
  readonly label: bigint;
  readonly draft: RowDraft;
  readonly planned: PlannedRow;
}

function fixtureRows(
  rows: readonly MistralRow[],
  drafts?: readonly RowDraft[],
): {
  readonly rows: FixtureRow[];
  readonly nextLabel: bigint;
} {
  const { labels, nextLabel } = allocateAppendLabels(
    FIRST_NEXT_LABEL,
    rows.length,
  );
  return {
    nextLabel,
    rows: rows.map((row, at) => {
      const speaker = row.speaker === 'ai' ? ROW_SPEAKER.ai : ROW_SPEAKER.tool;
      const draft =
        drafts?.[at] ??
        draftRow({
          speaker,
          owner: 1 + (at % 2),
          calls: row.speaker === 'ai' ? [row.id] : [],
          responses: row.speaker === 'tool' ? [row.id] : [],
        });
      return {
        label: labels[at],
        draft,
        planned: {
          label: labels[at],
          speaker,
          ids: draft.ids,
          flags: draft.flags,
          blockTypes: draft.blocks.map((block) => block.type),
        },
      };
    }),
  };
}

async function writeTranscript(
  file: string,
  reader: PositionalReader,
  appender: RecordAppender,
  entries: readonly RowEntry[],
  meta: KeyedMapBatch,
  state: KeyedMapBatch,
): Promise<void> {
  const access = (): RecordAccess =>
    createRecordAccess(file, reader, {
      selfOffset: 0,
      durableEnd: appender.nextOffset,
    });
  const transcript = new TranscriptTreeWriter(
    access,
    appender,
    'transcript',
  ).appendGroup(0);
  const membership = new TranscriptTreeWriter(access, appender, 'membership');
  for (const entry of entries) {
    const admission = {
      transcriptId: entry.transcriptId,
      rowRef: entry.recordOffset,
      recordLength: entry.recordLength,
      label: entry.label,
      revision: 1,
      audience: 0,
      status: 1,
      attemptRef: 0,
      supersedesId: 0n,
      presentationRef: 0,
    };
    await transcript.append(admission);
    const occurrencesRoot = await membership.insert(0, {
      ...admission,
      transcriptId: entry.label,
      recordLength: 0,
    });
    meta.set(
      `member:${entry.transcriptId}`,
      encodeMembership({
        count: 1,
        label: entry.label,
        rowRef: entry.recordOffset,
        occurrencesRoot,
      }),
    );
  }
  state.set(
    TRANSCRIPT_HEAD_KEY,
    encodeTranscriptHead({
      root: await transcript.finish(),
      count: entries.length,
      nextId: BigInt(entries.length + 1),
      openRoot: 0,
      reachableBytes: entries.reduce(
        (bytes, entry) => bytes + entry.recordLength + 64,
        0,
      ),
    }),
  );
}

/**
 * Writes a one-version journal the way a Mistral session would leave it:
 * rows with call and response ids, an id fact for each id whose `mappedRef`
 * names a `VALUE` record that holds its mapped id, the used-set entries, a
 * `LENS` record behind the first row, a meta map and a state map. The
 * production store writes none of the `LENS` and mapped-id records yet (they
 * come with the normalizer and the length cache), so the test builds the
 * version from the same record codecs the store uses.
 */
export async function writeMistralSource(
  file: string,
  rows: readonly MistralRow[],
  mapping: ReadonlyMap<string, string>,
  drafts?: readonly RowDraft[],
): Promise<void> {
  const deps = realDeps();
  const writer = await createJournal(file, testJournalSeams().dependencies);
  const planned = fixtureRows(rows, drafts);
  await writer.commitStreamedGroup(async (appender) => {
    const entries: RowEntry[] = [];
    const lens = await appender.append(plainRecord(RECORD_KIND.LENS, 5, 48));
    for (const [at, row] of planned.rows.entries()) {
      const encoded = encodeRowDraft(row.label, row.draft);
      const offset = await appender.append(encoded.record);
      const entry = entryForNewRow(encoded, offset, BigInt(at + 1));
      entries.push(at === 0 ? { ...entry, lensRef: [lens, 0, 0] } : entry);
    }
    const batch = new IdFactBatch(undefined, 0, deps, 0);
    for (const { planned: row } of planned.rows) {
      for (const occ of await plainPlanner(row, batch.queries)) {
        await batch.apply(occ);
      }
    }
    for (const [rawId, mapped] of mapping) {
      const value = UTF8.encode(JSON.stringify({ [MISTRAL_SLOT]: mapped }));
      const valueOffset = await appender.append({
        kind: RECORD_KIND.VALUE,
        kindHeader: UTF8.encode(`mapped:${rawId}`),
        body: { length: value.length, chunks: [value] },
      });
      batch.markMistralUsed(MISTRAL_SLOT, mapped, rawId);
      await batch.setMappedRef(rawId, valueOffset);
    }
    const idRoot = (await batch.commit(appender)).root;
    const tree = await bulkBuildRowTree(
      appender,
      testAlgebra(NO_KINDS),
      entries,
    );
    if (tree === undefined) throw new Error('the fixture has no rows');
    const cache = new BoundedIdNodeCache();
    const meta = new KeyedMapBatch(
      new KeyedMapReader(undefined, cache, 'meta', deps.hasher),
      0,
    );
    meta.set(KIMI_EXCEPTION_KEY, encodeDecimal(0));
    const state = new KeyedMapBatch(
      new KeyedMapReader(undefined, cache, 'state', deps.hasher),
      0,
    );
    for (const [key, value] of SESSION_STATE)
      state.set(key, UTF8.encode(value));
    await writeTranscript(file, writer.reader, appender, entries, meta, state);
    const last = entries[entries.length - 1];
    return {
      parent: 0,
      skip: [0, 0, 0],
      lineage: 1n,
      lineageDepth: 0,
      mutation: MUTATION.append,
      mutationArg0: 0n,
      mutationArg1: 0n,
      rowRoot: tree.root.childOffset,
      idRoot,
      metaRoot: await meta.commit(appender),
      stateRoot: await state.commit(appender),
      nextLabel: planned.nextLabel,
      firstLabel: entries[0].label,
      lastRowOffset: last.recordOffset,
      lastOwner: last.owner,
      ckptBytes: 0,
      rootAggregate: tree.root.aggregate,
      slots: EMPTY_SLOT_TABLE,
    };
  });
  await writer.close();
}
