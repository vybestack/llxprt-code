/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { ROW_BLOCK_TYPE, ROW_SPEAKER } from '../../journal/rowRecord.js';
import type { JournalResponseSource } from './journal-response-source.js';
import {
  partIds,
  partPosition,
  responsePartMetadata,
  type ResponsePart,
} from './journal-response-parts.js';
import {
  responsePlan,
  type JournalResponsePlan,
  type JournalBlockReference,
} from './journal-response-plan.js';

function sourceIndices(part: ResponsePart): readonly number[] {
  const { header } = part.ids;
  const split =
    header.speaker === ROW_SPEAKER.tool &&
    header.blocks.some((block) => block.type === ROW_BLOCK_TYPE.tool_call);
  return header.blocks.flatMap((block, index) =>
    !split || (part.part === 0) === (block.type === ROW_BLOCK_TYPE.tool_call)
      ? [index]
      : [],
  );
}

export async function selfResponsePlan(
  source: JournalResponseSource,
  part: ResponsePart,
): Promise<JournalResponsePlan | undefined> {
  const reconstructed = part.reconstructed === true;
  const hasResponses =
    !reconstructed &&
    part.indices.some(
      (index) =>
        part.ids.header.blocks[index].type === ROW_BLOCK_TYPE.tool_response,
    );
  if (hasResponses && part.speaker === ROW_SPEAKER.tool) return undefined;
  const indices = part.indices.filter(
    (index) =>
      !hasResponses ||
      (part.ids.header.blocks[index].type !== ROW_BLOCK_TYPE.tool_response &&
        part.ids.header.blocks[index].type !== ROW_BLOCK_TYPE.media),
  );
  if (hasResponses && indices.length === 0) return undefined;
  const original = sourceIndices(part);
  const ids = partIds(part);
  const blocks: JournalBlockReference[] = indices.map((index, block) => ({
    at: partPosition(part, original.indexOf(index)),
    kind: reconstructed ? 'reconstructed' : 'source',
    ...(reconstructed
      ? { id: ids.find((tuple) => tuple.block === block)?.id }
      : {}),
  }));
  return responsePlan(
    source,
    await responsePartMetadata(source, part),
    blocks,
    source.isTail?.(part.entry.label) === true,
    part,
  );
}
