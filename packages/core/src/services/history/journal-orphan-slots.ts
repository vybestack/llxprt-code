/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { JournalFormatError } from '../../journal/errors.js';
import type { IdFactQueries } from '../../journal/idFactQueries.js';
import type { BlockPosition } from '../../journal/idFactCodec.js';
import { comparePositions } from '../../journal/idFactUpdate.js';
import type { VersionSnapshot } from '../../journal/versionSnapshot.js';
import type { IContent, ToolCallBlock, ToolResponseBlock } from './IContent.js';
import { decodeStoredRow } from './journalRowCodec.js';
import { HistoryToolNormalization } from './historyToolNormalization.js';

interface OrphanSlot {
  readonly id: string;
  readonly at: BlockPosition;
}

function samePart(
  at: BlockPosition | undefined,
  label: bigint,
  part: number,
): boolean {
  return at?.label === label && at.part === part;
}

async function slotsFor(
  row: IContent,
  label: bigint,
  part: number,
  facts: IdFactQueries,
): Promise<readonly OrphanSlot[]> {
  const ids = new Set<string>();
  const slots: OrphanSlot[] = [];
  for (const block of row.blocks) {
    if (block.type !== 'tool_call' || block.id === '' || ids.has(block.id))
      continue;
    ids.add(block.id);
    const fact = await facts.fact(block.id);
    if (fact === undefined)
      throw new JournalFormatError(
        `Missing source fact for ${JSON.stringify(block.id)}`,
      );
    if (fact.firstResponse !== undefined)
      throw new JournalFormatError('Real response units are not implemented');
    if (
      samePart(fact.firstCall, label, part) &&
      fact.firstAiCall !== undefined
    ) {
      slots.push({ id: block.id, at: fact.firstAiCall });
    }
  }
  return slots.sort((left, right) => comparePositions(left.at, right.at));
}

async function orphanCall(
  snapshot: VersionSnapshot,
  slot: OrphanSlot,
): Promise<ToolCallBlock> {
  const entry = await snapshot.entryByLabel(slot.at.label);
  if (entry === undefined)
    throw new JournalFormatError('Orphan source row is absent');
  const row = decodeStoredRow(await snapshot.readRow(entry));
  const parts = HistoryToolNormalization.splitToolCallsOutOfToolMessages([row]);
  const block = parts[slot.at.part].blocks[slot.at.block];
  if (block.type !== 'tool_call' || block.id !== slot.id)
    throw new JournalFormatError(
      'Orphan source fact does not point to its call',
    );
  return block;
}

export async function orphanAdjacent(
  row: IContent,
  label: bigint,
  part: number,
  snapshot: VersionSnapshot,
  facts: IdFactQueries,
): Promise<IContent | undefined> {
  const slots = await slotsFor(row, label, part, facts);
  if (slots.length === 0) return undefined;
  const blocks: ToolResponseBlock[] = [];
  for (const slot of slots) {
    const call = await orphanCall(snapshot, slot);
    blocks.push({
      type: 'tool_response',
      callId: slot.id,
      toolName: call.name || 'unknown_tool',
      result: null,
      error: 'Tool call interrupted or cancelled',
      isComplete: true,
    });
  }
  const ownCalls = row.blocks.filter(
    (block) => block.type === 'tool_call' && block.id !== '',
  );
  const retained =
    row.speaker === 'ai' &&
    ownCalls.length === slots.length &&
    slots.every(
      (slot, index) =>
        samePart(slot.at, label, part) &&
        row.blocks[slot.at.block] === ownCalls[index],
    );
  return {
    speaker: 'tool',
    blocks,
    metadata: {
      synthetic: true,
      reason: retained ? 'orphaned_tool_call' : 'reordered_tool_responses',
    },
  };
}
