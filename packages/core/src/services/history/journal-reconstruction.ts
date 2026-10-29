/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { JournalFormatError } from '../../journal/errors.js';
import type { BlockPosition, IdFact } from '../../journal/idFactCodec.js';
import { comparePositions } from '../../journal/idFactUpdate.js';
import { ROW_ID_KIND, ROW_SPEAKER } from '../../journal/rowRecord.js';
import type { RowEntry } from '../../journal/rowEntry.js';
import type { JournalResponseSource } from './journal-response-source.js';
import {
  partIds,
  partPosition,
  responseParts,
  sameResponsePart,
  type ResponsePart,
} from './journal-response-parts.js';

export interface CallTarget {
  readonly at: BlockPosition;
  readonly reconstructed: boolean;
}

export function callTarget(fact: IdFact): CallTarget | undefined {
  if (
    fact.firstToolResponse !== undefined &&
    (fact.firstCall === undefined ||
      comparePositions(fact.firstToolResponse, fact.firstCall) < 0)
  )
    return { at: fact.firstToolResponse, reconstructed: true };
  return fact.firstCall === undefined
    ? undefined
    : { at: fact.firstCall, reconstructed: false };
}

export function targetsPart(
  target: CallTarget | undefined,
  part: ResponsePart,
): boolean {
  return (
    sameResponsePart(target?.at, partPosition(part)) &&
    target?.reconstructed === (part.reconstructed === true)
  );
}

async function reconstructedIndices(
  snapshot: JournalResponseSource,
  part: ResponsePart,
): Promise<readonly number[]> {
  if (part.speaker !== ROW_SPEAKER.tool) return [];
  const indices: number[] = [];
  for (const tuple of partIds(part)) {
    if (tuple.kind !== ROW_ID_KIND.response) continue;
    const fact = await snapshot.facts.fact(tuple.id);
    if (fact === undefined)
      throw new JournalFormatError('Missing reconstruction source fact');
    const before =
      fact.firstCall !== undefined &&
      (fact.firstCall.label < part.entry.label ||
        (fact.firstCall.label === part.entry.label &&
          fact.firstCall.part < part.part));
    if (!before && sameResponsePart(fact.firstToolResponse, partPosition(part)))
      indices.push(part.indices[tuple.block]);
  }
  return indices;
}

export async function* completedResponseParts(
  snapshot: JournalResponseSource,
  entries?: AsyncIterable<RowEntry>,
): AsyncGenerator<ResponsePart> {
  for await (const part of responseParts(snapshot, entries)) {
    const indices = await reconstructedIndices(snapshot, part);
    if (indices.length > 0) {
      const reconstructed = {
        ...part,
        indices,
        speaker: ROW_SPEAKER.ai,
        reconstructed: true,
      };
      yield reconstructed;
    }
    yield part;
  }
}
