/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { createHash } from 'node:crypto';
import { JournalFormatError } from '../../journal/errors.js';
import type { RowIds } from '../../journal/rowReads.js';
import { ROW_BLOCK_TYPE, ROW_SPEAKER } from '../../journal/rowRecord.js';
import type { VersionSnapshot } from '../../journal/versionSnapshot.js';
import type { IContent } from './IContent.js';
import type { JournalResponsePlan } from './journal-response-plan.js';
import type { JournalTailSource } from './journal-tail-source.js';

export interface MistralUnitIds {
  readonly speaker: IContent['speaker'];
  readonly ids: ReadonlyArray<{
    readonly rawId: string;
    readonly kind: 'call' | 'response';
  }>;
}

export async function mistralPlanIds(
  source: JournalTailSource,
  plan: JournalResponsePlan,
): Promise<MistralUnitIds> {
  const rows = new Map<bigint, RowIds>();
  const ids: Array<MistralUnitIds['ids'][number]> = [];
  for (const ref of plan.blocks) {
    if (ref.kind !== 'source') {
      if (ref.id === undefined)
        throw new JournalFormatError('Mistral planned id is missing');
      ids.push({
        rawId: ref.id,
        kind: ref.kind === 'reconstructed' ? 'call' : 'response',
      });
      continue;
    }
    let row = rows.get(ref.at.label);
    if (row === undefined) {
      const entry = await source.entryByLabel(ref.at.label);
      if (entry === undefined)
        throw new JournalFormatError('Mistral source row is missing');
      row = await source.readIds(entry);
      rows.set(ref.at.label, row);
    }
    const split =
      row.header.speaker === ROW_SPEAKER.tool &&
      row.header.blocks.some(
        (block) => block.type === ROW_BLOCK_TYPE.tool_call,
      );
    const indices = row.header.blocks.flatMap((block, index) =>
      !split ||
      (ref.at.part === 0) === (block.type === ROW_BLOCK_TYPE.tool_call)
        ? [index]
        : [],
    );
    const block = indices[ref.at.block];
    const ordinal = row.header.ids.findIndex((id) => id.block === block);
    if (ordinal >= 0)
      ids.push({
        rawId: row.rawIds[ordinal],
        kind:
          row.header.blocks[block].type === ROW_BLOCK_TYPE.tool_call
            ? 'call'
            : 'response',
      });
  }
  return { speaker: plan.header.speaker, ids };
}

export async function mistralRequestIdentity(
  snapshot: VersionSnapshot,
  source: JournalTailSource,
): Promise<string> {
  const hash = createHash('sha256').update(await snapshot.mistralGeneration());
  for (const entry of source.tailEntries()) {
    const row = await source.readIds(entry);
    hash.update(
      JSON.stringify([
        row.header.speaker,
        row.header.flags,
        row.header.blocks.map((block) => block.type),
        row.header.ids,
        row.rawIds,
      ]),
    );
  }
  return hash.digest('hex');
}
