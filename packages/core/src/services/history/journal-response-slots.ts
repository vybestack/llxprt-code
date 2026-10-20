/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { JournalFormatError } from '../../journal/errors.js';
import type { BlockPosition, IdFact } from '../../journal/idFactCodec.js';
import { comparePositions } from '../../journal/idFactUpdate.js';
import {
  ROW_BLOCK_TYPE,
  ROW_ID_KIND,
  ROW_SPEAKER,
} from '../../journal/rowRecord.js';
import type { VersionSnapshot } from '../../journal/versionSnapshot.js';
import { sanitizeProviderContentForSerialization } from './historyCloneUtils.js';
import type {
  ContentMetadata,
  IContent,
  ToolResponseBlock,
} from './IContent.js';
import {
  partIds,
  partPosition,
  responseBlockAt,
  responsePartAt,
  responsePartContent,
  sameResponsePart,
  UnsupportedJournalNormalizationError,
  type ResponsePart,
} from './journal-response-parts.js';

interface ResponseSlot {
  readonly id: string;
  readonly first: BlockPosition;
  readonly selected: BlockPosition;
  readonly orphan: boolean;
}
interface SelectedBlock {
  readonly at: BlockPosition;
  readonly orphan: boolean;
}

function target(fact: IdFact): BlockPosition | undefined {
  if (
    fact.firstToolResponse !== undefined &&
    (fact.firstCall === undefined ||
      comparePositions(fact.firstToolResponse, fact.firstCall) < 0)
  ) {
    throw new UnsupportedJournalNormalizationError(
      'Reconstructed call units are not implemented',
    );
  }
  return fact.firstCall;
}

export async function assertResponsePartSupported(
  snapshot: VersionSnapshot,
  part: ResponsePart,
): Promise<void> {
  for (const tuple of partIds(part)) {
    const fact = await snapshot.facts.fact(tuple.id);
    if (fact === undefined)
      throw new JournalFormatError('Missing response source fact');
    target(fact);
    if (
      part.speaker === ROW_SPEAKER.tool &&
      tuple.kind === ROW_ID_KIND.response &&
      (fact.firstCall === undefined || !beforePart(fact.firstCall, part))
    ) {
      throw new UnsupportedJournalNormalizationError(
        'Reconstructed call units are not implemented',
      );
    }
  }
}

function beforePart(at: BlockPosition, part: ResponsePart): boolean {
  return (
    at.label < part.entry.label ||
    (at.label === part.entry.label && at.part < part.part)
  );
}

async function slotsFor(
  snapshot: VersionSnapshot,
  part: ResponsePart,
): Promise<readonly ResponseSlot[]> {
  const seen = new Set<string>();
  const slots: ResponseSlot[] = [];
  for (const tuple of partIds(part)) {
    if (
      tuple.kind !== ROW_ID_KIND.call ||
      tuple.id === '' ||
      seen.has(tuple.id)
    )
      continue;
    seen.add(tuple.id);
    const fact = await snapshot.facts.fact(tuple.id);
    if (fact === undefined)
      throw new JournalFormatError('Missing call source fact');
    if (sameResponsePart(target(fact), partPosition(part))) {
      const first = fact.firstResponse ?? fact.firstAiCall;
      const selected = fact.best ?? fact.firstAiCall;
      if (first !== undefined && selected !== undefined)
        slots.push({
          id: tuple.id,
          first,
          selected,
          orphan: fact.firstResponse === undefined,
        });
    }
  }
  return slots.sort((left, right) => {
    if (!sameResponsePart(left.first, right.first))
      return comparePositions(left.first, right.first);
    const syntheticOrder = Number(left.orphan) - Number(right.orphan);
    return syntheticOrder !== 0
      ? syntheticOrder
      : left.first.block - right.first.block;
  });
}

async function mediaOwner(
  snapshot: VersionSnapshot,
  source: ResponsePart,
): Promise<BlockPosition | undefined> {
  for (const tuple of partIds(source)) {
    if (tuple.kind !== ROW_ID_KIND.response || tuple.id === '') continue;
    const fact = await snapshot.facts.fact(tuple.id);
    if (fact === undefined)
      throw new JournalFormatError('Missing media source fact');
    if (
      fact.firstResponse !== undefined &&
      comparePositions(
        fact.firstResponse,
        partPosition(source, tuple.block),
      ) === 0
    ) {
      const owner = target(fact);
      if (owner !== undefined) return owner;
    }
  }
  return undefined;
}

async function mediaFor(
  snapshot: VersionSnapshot,
  part: ResponsePart,
  slots: readonly ResponseSlot[],
): Promise<readonly SelectedBlock[]> {
  const media: SelectedBlock[] = [];
  let previous: BlockPosition | undefined;
  for (const slot of slots) {
    if (slot.orphan || sameResponsePart(previous, slot.first)) continue;
    previous = slot.first;
    const source = await responsePartAt(snapshot, slot.first);
    const owner = await mediaOwner(snapshot, source);
    if (sameResponsePart(owner, partPosition(part))) {
      media.push(
        ...source.indices.flatMap((index, block) =>
          source.ids.header.blocks[index].type === ROW_BLOCK_TYPE.media
            ? [{ at: partPosition(source, block), orphan: false }]
            : [],
        ),
      );
    }
  }
  return media;
}

async function orphanSuccessor(
  snapshot: VersionSnapshot,
  part: ResponsePart,
): Promise<readonly SelectedBlock[]> {
  if (part.speaker !== ROW_SPEAKER.ai) return [];
  const refs: SelectedBlock[] = [];
  for (const tuple of partIds(part)) {
    if (tuple.kind !== ROW_ID_KIND.call || tuple.id === '') continue;
    const fact = await snapshot.facts.fact(tuple.id);
    if (
      fact?.firstResponse === undefined &&
      sameResponsePart(fact?.firstAiCall, partPosition(part))
    )
      refs.push({ at: partPosition(part, tuple.block), orphan: true });
  }
  return refs;
}

function sameSelected(left: SelectedBlock, right: SelectedBlock): boolean {
  return (
    left.orphan === right.orphan && comparePositions(left.at, right.at) === 0
  );
}

async function metadataFor(
  snapshot: VersionSnapshot,
  part: ResponsePart,
  next: ResponsePart | undefined,
  selected: readonly SelectedBlock[],
): Promise<ContentMetadata | undefined> {
  const orphan = await orphanSuccessor(snapshot, part);
  if (orphan.length > 0) {
    if (
      orphan.length === selected.length &&
      selected.every((ref, index) => sameSelected(ref, orphan[index]))
    )
      return { synthetic: true, reason: 'orphaned_tool_call' };
  } else if (
    next?.speaker === ROW_SPEAKER.tool &&
    next.indices.length === selected.length &&
    next.indices.every((index) => {
      const type = next.ids.header.blocks[index].type;
      return (
        type === ROW_BLOCK_TYPE.tool_response || type === ROW_BLOCK_TYPE.media
      );
    }) &&
    selected.every(
      (ref, index) =>
        !ref.orphan &&
        comparePositions(ref.at, partPosition(next, index)) === 0,
    )
  ) {
    await assertResponsePartSupported(snapshot, next);
    return (await responsePartContent(snapshot, next)).metadata;
  }
  return { synthetic: true, reason: 'reordered_tool_responses' };
}

async function slotBlock(
  snapshot: VersionSnapshot,
  slot: ResponseSlot,
): Promise<ToolResponseBlock> {
  const block = await responseBlockAt(snapshot, slot.selected);
  if (!slot.orphan) {
    if (block.type !== 'tool_response' || block.callId !== slot.id)
      throw new JournalFormatError(
        'Response fact does not point to its response',
      );
    return block;
  }
  if (block.type !== 'tool_call' || block.id !== slot.id)
    throw new JournalFormatError('Orphan fact does not point to its call');
  return {
    type: 'tool_response',
    callId: slot.id,
    toolName: block.name || 'unknown_tool',
    result: null,
    error: 'Tool call interrupted or cancelled',
    isComplete: true,
  };
}

export async function responseAdjacent(
  snapshot: VersionSnapshot,
  part: ResponsePart,
  next: ResponsePart | undefined,
): Promise<IContent | undefined> {
  const slots = await slotsFor(snapshot, part);
  if (slots.length === 0) return undefined;
  const media = await mediaFor(snapshot, part, slots);
  const selected = [
    ...slots.map((slot) => ({ at: slot.selected, orphan: slot.orphan })),
    ...media,
  ];
  const metadata = await metadataFor(snapshot, part, next, selected);
  const blocks: IContent['blocks'] = [];
  for (const slot of slots) blocks.push(await slotBlock(snapshot, slot));
  for (const ref of media) blocks.push(await responseBlockAt(snapshot, ref.at));
  return sanitizeProviderContentForSerialization({
    speaker: 'tool',
    blocks,
    metadata,
  });
}
