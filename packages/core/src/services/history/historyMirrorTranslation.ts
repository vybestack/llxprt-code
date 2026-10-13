/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { randomUUID } from 'node:crypto';
import { ReplaceTransactionFold } from '../../recording/replaceTransaction.js';
import type { SessionEventType } from '../../recording/types.js';
import type { IContent } from './IContent.js';
import {
  applyFoldEvent,
  envelopeToEvent,
  type FoldEvent,
} from './historyJournalFold.js';
import { acceptsHistoryOrigin } from './historyOriginId.js';

/** One record to append to a mirror's own journal. */
export interface MirrorWrite {
  readonly type: SessionEventType;
  readonly payload: unknown;
}

export interface MirrorTranslationInput {
  readonly mirror: string;
  readonly record: MirrorWrite;
  readonly event: FoldEvent;
  /** The shared rows before and after the record. */
  readonly before: readonly IContent[];
  readonly after: readonly IContent[];
  readonly ownerOf: (row: IContent) => string | undefined;
}

function chronSeq(row: IContent): number | undefined {
  const seq = row.metadata?.chronology?.seq;
  return typeof seq === 'number' ? seq : undefined;
}

function isPrefix(
  shorter: readonly IContent[],
  longer: readonly IContent[],
): boolean {
  return (
    shorter.length <= longer.length &&
    shorter.every((row, index) => row === longer[index])
  );
}

function withOrigin(
  payload: object,
  origin: string | undefined,
): Record<string, unknown> {
  return origin === undefined ? { ...payload } : { ...payload, origin };
}

function contentWrite(
  row: IContent,
  origin: string | undefined,
  tx?: string,
): MirrorWrite {
  return {
    type: 'content',
    payload: withOrigin(
      { content: row, ...(tx === undefined ? {} : { tx }) },
      origin,
    ),
  };
}

/** Rewrite the mirror wholesale as one replace transaction. */
function replacement(
  rows: readonly IContent[],
  ownerOf: (row: IContent) => string | undefined,
): MirrorWrite[] {
  const txId = randomUUID();
  return [
    { type: 'replace_begin', payload: { txId } },
    ...rows.map((row) => contentWrite(row, ownerOf(row), txId)),
    {
      type: 'replace_commit',
      payload: { txId, rowCount: rows.length },
    },
  ];
}

/** The density pass restricted to the mirror's own rows. */
function densityWrite(
  input: MirrorTranslationInput,
  event: Extract<FoldEvent, { readonly kind: 'density' }>,
  mineBefore: readonly IContent[],
  mineAfter: readonly IContent[],
): MirrorWrite {
  const heldAfter = new Set(mineAfter);
  const replacements = new Map(
    event.replacements.map((entry) => [entry.replacedSeq, entry.replacement]),
  );
  const removed = new Set(event.removedSeqs);
  const removedSeqs: number[] = [];
  const mirrorReplacements: Array<{
    replacedSeq: number;
    replacement: IContent;
  }> = [];
  for (const row of mineBefore) {
    const seq = chronSeq(row);
    if (seq === undefined) continue;
    const next = replacements.get(seq);
    if (next !== undefined && heldAfter.has(next))
      mirrorReplacements.push({ replacedSeq: seq, replacement: next });
    else if (next !== undefined || removed.has(seq)) removedSeqs.push(seq);
  }
  return {
    type: 'density_mutation',
    payload: {
      ...(input.record.payload as object),
      removedSeqs,
      replacements: mirrorReplacements,
    },
  };
}

function insertWrite(
  input: MirrorTranslationInput,
  event: Extract<FoldEvent, { readonly kind: 'syntheticInsert' }>,
  mineAfter: readonly IContent[],
): MirrorWrite | null {
  const position = mineAfter.indexOf(event.content);
  const anchor = position > 0 ? chronSeq(mineAfter[position - 1]) : undefined;
  if (anchor === undefined) return null;
  return {
    type: 'synthetic_insert',
    payload: { ...(input.record.payload as object), afterSeq: anchor },
  };
}

function candidateWrite(
  input: MirrorTranslationInput,
  mineBefore: readonly IContent[],
  mineAfter: readonly IContent[],
): MirrorWrite | null {
  const { event } = input;
  switch (event.kind) {
    case 'compressed':
      return mineAfter.length === 1 && mineAfter[0] === event.summary
        ? input.record
        : null;
    case 'syntheticInsert':
      return insertWrite(input, event, mineAfter);
    case 'density':
      return densityWrite(input, event, mineBefore, mineAfter);
    default:
      return null;
  }
}

/** Fold a candidate write onto the mirror's rows and say whether it gives `expected`. */
function yields(
  write: MirrorWrite,
  mineBefore: readonly IContent[],
  expected: readonly IContent[],
): boolean {
  const event = envelopeToEvent(write.type, write.payload);
  if (event === null) return false;
  const rows = [...mineBefore];
  applyFoldEvent(rows, event, new ReplaceTransactionFold());
  return rows.length === expected.length && isPrefix(rows, expected);
}

/**
 * The records that bring one mirror from "its own rows before" to "its own
 * rows after" a shared record. A mirror holds exactly the shared rows whose
 * owner it accepts, so positions in the shared history mean nothing to it.
 * The change is expressed in the narrowest form its journal can fold: nothing,
 * a tail rewind, appended rows, the record itself restricted to the mirror's
 * rows, or, when none of those yields the right rows, a replace transaction.
 */
export function mirrorWrites(input: MirrorTranslationInput): MirrorWrite[] {
  const accepts = (row: IContent): boolean =>
    acceptsHistoryOrigin(input.mirror, input.ownerOf(row));
  const mineBefore = input.before.filter(accepts);
  const mineAfter = input.after.filter(accepts);
  if (isPrefix(mineAfter, mineBefore)) {
    const removed = mineBefore.length - mineAfter.length;
    return removed === 0
      ? []
      : [{ type: 'rewind', payload: { itemsRemoved: removed } }];
  }
  if (isPrefix(mineBefore, mineAfter))
    return mineAfter
      .slice(mineBefore.length)
      .map((row) => contentWrite(row, input.ownerOf(row)));
  const candidate = candidateWrite(input, mineBefore, mineAfter);
  if (candidate !== null && yields(candidate, mineBefore, mineAfter))
    return [candidate];
  return replacement(mineAfter, input.ownerOf);
}
