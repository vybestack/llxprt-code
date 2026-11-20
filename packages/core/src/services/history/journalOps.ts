/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { FIRST_NEXT_LABEL } from '../../journal/labels.js';
import type { DensityMutationPayload } from '../../recording/types.js';
import type { RowDraft } from '../../journal/rowDraft.js';
import type { IContent } from './IContent.js';
import type { HistoryJournalOp } from './historyStorePort.js';
import { planDensity } from './journalHistoryEdits.js';
import type { JournalOwners } from './journalOwners.js';
import {
  syntheticInsertEdits,
  type EditBuilder,
} from './journalPublication.js';
import { encodeContentRow, UNOWNED_ROW } from './journalRowCodec.js';

/** What the translation of a port operation into a queued group needs from the store. */
export interface JournalWriteHost {
  /** The rows once everything queued is applied. */
  rows(): number;
  append(draft: RowDraft, origin: string | undefined): void;
  /** Read when a group is built: a resume can replace the store's owners while the operation waits. */
  owners(): JournalOwners;
  /** Queues a group; the tentative count moves to `rowsAfter` now. */
  enqueue(rowsAfter: number, build: EditBuilder): void;
  /** Offers the first user row of an origin as the session preview. */
  offerPreview(content: IContent, origin: string | undefined): void;
}

/**
 * Queues the group a port operation stands for. Only rows an op writes carry
 * its origin; a rewind, a density and a detail name who asked, not who owns.
 */
export function applyOperation(
  host: JournalWriteHost,
  op: HistoryJournalOp,
): RowDraft | undefined {
  switch (op.kind) {
    case 'content':
      return applyContent(host, op.content, op.tx, op.origin);
    case 'rewind':
      applyRewind(host, op.itemsRemoved);
      return;
    case 'compressed':
      applyCompressed(host, op.summary, op.origin);
      return;
    case 'syntheticInsert':
      applySyntheticInsert(
        host,
        op.payload.content,
        op.payload.afterSeq,
        op.origin,
      );
      return;
    case 'compressionDetail':
      // The span a compression destroyed is in the summary row's metadata (design 4.4).
      return;
    case 'density':
      applyDensity(host, op.payload);
      return;
    case 'replaceBegin':
    case 'replaceCommit':
    case 'replaceAbort':
      throw new Error(
        `The "${op.kind}" operation is not implemented in the journal store yet`,
      );
    default: {
      const unmapped: never = op;
      throw new Error(`Unmapped history operation ${JSON.stringify(unmapped)}`);
    }
  }
}

function applyContent(
  host: JournalWriteHost,
  content: IContent,
  tx: string | undefined,
  origin: string | undefined,
): RowDraft {
  if (tx !== undefined) {
    throw new Error(
      'Rows of a replace transaction are not implemented in the journal store yet',
    );
  }
  const draft = encodeAppended(host, content, origin);
  host.append(draft, origin);
  return draft;
}

/**
 * The draft of a row about to be appended. Encoded now: the chronology
 * stamper writes the entry's metadata in place after the call. The row is
 * offered as the session preview of `origin` here, as it is the row's first
 * appearance.
 */
export function encodeAppended(
  host: JournalWriteHost,
  content: IContent,
  origin: string | undefined,
  streamPromptText = false,
): RowDraft {
  const draft = encodeContentRow(content, {
    owner: UNOWNED_ROW,
    streamPromptText,
  });
  host.offerPreview(content, origin);
  return draft;
}

/** Queues `drafts` (from {@link encodeAppended}) as one append group, which is one durable commit. */
export function applyAppendDrafts(
  host: JournalWriteHost,
  drafts: readonly RowDraft[],
  origin: string | undefined,
  inheritedOwners?: ReadonlyArray<number | undefined>,
): void {
  host.enqueue(host.rows() + drafts.length, async () => {
    const owner = await host.owners().resolve(origin);
    return [
      ...owner.edits,
      {
        kind: 'append',
        rows: drafts.map((draft, index) => ({
          ...draft,
          owner: inheritedOwners?.[index] ?? owner.id,
        })),
      },
    ];
  });
}

function applyDensity(
  host: JournalWriteHost,
  payload: DensityMutationPayload,
): void {
  const planned = planDensity(payload);
  if (planned.empty) return;
  if (planned.removedRows > host.rows()) {
    throw new Error(
      `A density removing ${planned.removedRows} rows exceeds the ${host.rows()} rows of the history`,
    );
  }
  host.enqueue(host.rows() - planned.removedRows, planned.build);
}

function applyRewind(host: JournalWriteHost, itemsRemoved: number): void {
  if (
    !Number.isInteger(itemsRemoved) ||
    itemsRemoved < 0 ||
    itemsRemoved > host.rows()
  ) {
    throw new Error(
      `A rewind of ${itemsRemoved} rows exceeds the ${host.rows()} rows of the history`,
    );
  }
  if (itemsRemoved === 0) return;
  // The count is authoritative and the cut is the label of the row at that position (design 4.3).
  host.enqueue(host.rows() - itemsRemoved, async (snapshot) => {
    const first = await snapshot.entryAt(snapshot.rows - itemsRemoved);
    return [
      { kind: 'pop', cutLabel: first.label, expectedRemoved: itemsRemoved },
    ];
  });
}

function applyCompressed(
  host: JournalWriteHost,
  summary: IContent,
  origin: string | undefined,
): void {
  const draft = encodeContentRow(summary, { owner: UNOWNED_ROW });
  // A compression replaces the whole history; the rows to keep are appended after it.
  host.enqueue(1, async (snapshot) => {
    const owner = await host.owners().resolve(origin);
    return [
      ...owner.edits,
      {
        kind: 'compress',
        summary: { ...draft, owner: owner.id },
        retainFromLabel: snapshot.version?.nextLabel ?? FIRST_NEXT_LABEL,
        expectedReplaced: snapshot.rows,
      },
    ];
  });
}

function applySyntheticInsert(
  host: JournalWriteHost,
  content: IContent,
  afterSeq: number,
  origin: string | undefined,
): void {
  if (!Number.isSafeInteger(afterSeq) || afterSeq < 0) {
    throw new Error(`Invalid synthetic insert anchor ${afterSeq}`);
  }
  const draft = encodeContentRow(content, { owner: UNOWNED_ROW });
  host.enqueue(
    host.rows() + 1,
    syntheticInsertEdits(draft, afterSeq, origin, () => host.owners()),
  );
}
