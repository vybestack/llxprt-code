/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { JournalFormatError } from '../../journal/errors.js';
import type { BlockPosition } from '../../journal/idFactCodec.js';
import type { RowEntry } from '../../journal/rowEntry.js';
import type { RowIds } from '../../journal/rowReads.js';
import {
  ROW_BLOCK_TYPE,
  ROW_FLAG,
  ROW_SPEAKER,
} from '../../journal/rowRecord.js';
import type { VersionSnapshot } from '../../journal/versionSnapshot.js';
import { decodeStoredRow } from './journalRowCodec.js';
import { HistoryToolNormalization } from './historyToolNormalization.js';
import type { ContentBlock, IContent } from './IContent.js';

export class UnsupportedJournalNormalizationError extends JournalFormatError {}

export interface ResponsePart {
  readonly entry: RowEntry;
  readonly ids: RowIds;
  readonly part: number;
  readonly indices: readonly number[];
  readonly speaker: number;
}

export function sameResponsePart(
  left: BlockPosition | undefined,
  right: Pick<BlockPosition, 'label' | 'part'>,
): boolean {
  return left?.label === right.label && left.part === right.part;
}

export function partPosition(part: ResponsePart, block = 0): BlockPosition {
  return { label: part.entry.label, part: part.part, block };
}

function parts(entry: RowEntry, ids: RowIds): readonly ResponsePart[] {
  const indices = ids.header.blocks.map((_, index) => index);
  const split =
    ids.header.speaker === ROW_SPEAKER.tool &&
    ids.header.blocks.some((block) => block.type === ROW_BLOCK_TYPE.tool_call);
  if (!split)
    return [{ entry, ids, part: 0, indices, speaker: ids.header.speaker }];
  const calls = indices.filter(
    (index) => ids.header.blocks[index].type === ROW_BLOCK_TYPE.tool_call,
  );
  const rest = indices.filter(
    (index) => ids.header.blocks[index].type !== ROW_BLOCK_TYPE.tool_call,
  );
  return [
    { entry, ids, part: 0, indices: calls, speaker: ROW_SPEAKER.ai },
    ...(rest.length === 0
      ? []
      : [{ entry, ids, part: 1, indices: rest, speaker: ROW_SPEAKER.tool }]),
  ];
}

export async function* responseParts(
  snapshot: VersionSnapshot,
): AsyncGenerator<ResponsePart> {
  for await (const entry of snapshot.entries()) {
    if ((entry.flags & ROW_FLAG.curated) === 0) continue;
    yield* parts(entry, await snapshot.readIds(entry));
  }
}

export async function responsePartAt(
  snapshot: VersionSnapshot,
  at: BlockPosition,
): Promise<ResponsePart> {
  const entry = await snapshot.entryByLabel(at.label);
  if (entry === undefined)
    throw new JournalFormatError('Response source row is absent');
  const part = parts(entry, await snapshot.readIds(entry)).find(
    (candidate) => candidate.part === at.part,
  );
  if (part === undefined)
    throw new JournalFormatError('Response source part is absent');
  return part;
}

export async function responsePartContent(
  snapshot: VersionSnapshot,
  part: ResponsePart,
): Promise<IContent> {
  const row = decodeStoredRow(await snapshot.readRow(part.entry));
  return HistoryToolNormalization.splitToolCallsOutOfToolMessages([row])[
    part.part
  ];
}

export async function responseBlockAt(
  snapshot: VersionSnapshot,
  at: BlockPosition,
): Promise<ContentBlock> {
  const part = await responsePartAt(snapshot, at);
  const block = (await responsePartContent(snapshot, part)).blocks.find(
    (_, index) => index === at.block,
  );
  if (block === undefined)
    throw new JournalFormatError('Response source block is absent');
  return block;
}

export function partIds(part: ResponsePart): ReadonlyArray<{
  readonly id: string;
  readonly block: number;
  readonly kind: number;
}> {
  return part.ids.header.ids.flatMap((tuple, index) => {
    const block = part.indices.indexOf(tuple.block);
    return block < 0
      ? []
      : [{ id: part.ids.rawIds[index], block, kind: tuple.kind }];
  });
}
