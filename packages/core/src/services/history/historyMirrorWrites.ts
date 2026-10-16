/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { randomUUID } from 'node:crypto';
import type { SessionEventType } from '../../recording/types.js';
import type { NumericRow } from '../../recording/mutableRowDirectory.js';
import type { IContent } from './IContent.js';
import type { JournalRowReader } from './historyJournalRowReader.js';
import type { MirrorPlan } from './historyMirrorTranslation.js';
import {
  mirrorHolds,
  type OwnerCounts,
  type SharedRowIndex,
} from './historySharedRowIndex.js';

export interface MirrorWriteContext {
  /** The shared rows after the record folded. */
  readonly index: SharedRowIndex;
  readonly reader: JournalRowReader;
  readonly send: (
    mirror: string,
    type: SessionEventType,
    payload: unknown,
  ) => void;
  readonly countsAfter: () => OwnerCounts;
}

async function contentPayload(
  context: MirrorWriteContext,
  row: NumericRow,
  tx?: string,
): Promise<Record<string, unknown>> {
  const content: IContent = await context.reader.read(row);
  const origin = context.index.originOf(row.origin);
  return {
    content,
    ...(tx === undefined ? {} : { tx }),
    ...(origin === undefined ? {} : { origin }),
  };
}

/** Every row the mirror holds, oldest first. */
function* heldRows(
  context: MirrorWriteContext,
  mirror: string,
): Generator<NumericRow, void, undefined> {
  const id = context.index.idOf(mirror);
  for (const row of context.index.rows())
    if (mirrorHolds(id, row.origin)) yield row;
}

/**
 * Give a mirror the rows it holds now. One that held none just appends them;
 * otherwise they replace its rows as one transaction, so a crash midway
 * leaves the mirror as it was. Rows are read and sent one at a time.
 */
async function rebuild(
  context: MirrorWriteContext,
  mirror: string,
  heldBefore: number,
): Promise<void> {
  if (heldBefore === 0) {
    for (const row of heldRows(context, mirror))
      context.send(mirror, 'content', await contentPayload(context, row));
    return;
  }
  const txId = randomUUID();
  context.send(mirror, 'replace_begin', { txId });
  let rowCount = 0;
  for (const row of heldRows(context, mirror)) {
    context.send(mirror, 'content', await contentPayload(context, row, txId));
    rowCount++;
  }
  context.send(mirror, 'replace_commit', { txId, rowCount });
}

function trim(
  context: MirrorWriteContext,
  mirror: string,
  heldBefore: number,
): void {
  const heldAfter = context.countsAfter().heldBy(context.index.idOf(mirror));
  const removed = heldBefore - heldAfter;
  if (removed < 0)
    throw new Error(
      `History fan-out mirror ${mirror} gained rows from a record that only removes`,
    );
  if (removed > 0) context.send(mirror, 'rewind', { itemsRemoved: removed });
}

/** Carry out one mirror's plan against the shared rows after the record. */
export async function writeMirrorPlan(
  context: MirrorWriteContext,
  mirror: string,
  plan: MirrorPlan,
): Promise<void> {
  switch (plan.kind) {
    case 'none':
      return;
    case 'write':
      context.send(mirror, plan.write.type, plan.write.payload);
      return;
    case 'trim':
      trim(context, mirror, plan.heldBefore);
      return;
    case 'appendRow':
      context.send(
        mirror,
        'content',
        await contentPayload(context, context.index.rowAt(plan.position)),
      );
      return;
    case 'rebuild':
      await rebuild(context, mirror, plan.heldBefore);
      return;
    default: {
      const exhaustive: never = plan;
      throw new Error(`unknown mirror plan ${JSON.stringify(exhaustive)}`);
    }
  }
}
