/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { JournalFormatError } from '../../journal/errors.js';
import type { BlockPosition } from '../../journal/idFactCodec.js';
import { comparePositions } from '../../journal/idFactUpdate.js';
import {
  ROW_BLOCK_TYPE,
  ROW_ID_KIND,
  ROW_SPEAKER,
} from '../../journal/rowRecord.js';
import type { JournalResponseSource } from './journal-response-source.js';
import {
  responsePlan,
  type JournalResponsePlan,
  type JournalBlockReference,
} from './journal-response-plan.js';
import {
  callTarget,
  targetsPart,
  type CallTarget,
} from './journal-reconstruction.js';
import type { ContentMetadata } from './IContent.js';
import {
  partIds,
  partPosition,
  responsePartAt,
  responsePartMetadata,
  sameResponsePart,
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

async function slotsFor(
  snapshot: JournalResponseSource,
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
    if (targetsPart(callTarget(fact), part)) {
      const orphan = fact.firstResponse === undefined;
      if (!orphan && fact.best === undefined)
        throw new JournalFormatError('Real response fact has no best pointer');
      const first = orphan ? fact.firstAiCall : fact.firstResponse;
      const selected = orphan ? fact.firstAiCall : fact.best;
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
  snapshot: JournalResponseSource,
  source: ResponsePart,
): Promise<CallTarget | undefined> {
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
      const owner = callTarget(fact);
      if (owner !== undefined) return owner;
    }
  }
  return undefined;
}

async function mediaFor(
  snapshot: JournalResponseSource,
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
    if (targetsPart(owner, part)) {
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
  snapshot: JournalResponseSource,
  part: ResponsePart,
): Promise<readonly SelectedBlock[]> {
  if (part.speaker !== ROW_SPEAKER.ai || part.reconstructed === true) return [];
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
  snapshot: JournalResponseSource,
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
        (comparePositions(ref.at, partPosition(next, index)) === 0 ||
          snapshot.sameBlock?.(ref.at, partPosition(next, index)) === true),
    )
  ) {
    return (await responsePartMetadata(snapshot, next)).metadata;
  }
  return { synthetic: true, reason: 'reordered_tool_responses' };
}

export async function responseAdjacent(
  snapshot: JournalResponseSource,
  part: ResponsePart,
  next: ResponsePart | undefined,
): Promise<JournalResponsePlan | undefined> {
  const slots = await slotsFor(snapshot, part);
  if (slots.length === 0) return undefined;
  const media = await mediaFor(snapshot, part, slots);
  const selected = [
    ...slots.map((slot) => ({ at: slot.selected, orphan: slot.orphan })),
    ...media,
  ];
  const metadata = await metadataFor(snapshot, part, next, selected);
  return responsePlan(
    snapshot,
    { speaker: 'tool', blocks: [], metadata },
    [
      ...slots.map(
        (slot) =>
          ({
            at: slot.selected,
            kind: slot.orphan ? 'orphan' : 'response',
            id: slot.id,
          }) satisfies JournalBlockReference,
      ),
      ...media.map(
        (ref) =>
          ({ at: ref.at, kind: 'source' }) satisfies JournalBlockReference,
      ),
    ],
    selected.some((ref) => snapshot.isTail?.(ref.at.label) === true),
  );
}
