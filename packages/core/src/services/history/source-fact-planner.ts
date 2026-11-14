/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { OccurrencePlanner } from '../../journal/groupEdits.js';
import type { IdOccurrence } from '../../journal/idFactUpdate.js';
import {
  ROW_BLOCK_TYPE,
  ROW_FLAG,
  ROW_ID_KIND,
  ROW_SPEAKER,
} from '../../journal/rowRecord.js';

export const planSourceRowOccurrences = async (
  row: Parameters<OccurrencePlanner>[0],
  _facts?: Parameters<OccurrencePlanner>[1],
): Promise<readonly IdOccurrence[]> => {
  if ((row.flags & ROW_FLAG.curated) === 0) return [];
  const split =
    row.speaker === ROW_SPEAKER.tool &&
    row.ids.some((id) => id.kind === ROW_ID_KIND.call);
  const callsBefore: number[] = [];
  let calls = 0;
  for (const type of row.blockTypes) {
    callsBefore.push(calls);
    if (type === ROW_BLOCK_TYPE.tool_call) calls++;
  }
  const occurrences: IdOccurrence[] = row.ids.map((id) => {
    const call = id.kind === ROW_ID_KIND.call;
    const part = split && !call ? 1 : 0;
    const splitBlock = call
      ? callsBefore[id.block]
      : id.block - callsBefore[id.block];
    const block = split ? splitBlock : id.block;
    const speaker = split && call ? ROW_SPEAKER.ai : row.speaker;
    return {
      rawId: id.rawId,
      kind: call ? ROW_ID_KIND.call : ROW_ID_KIND.response,
      at: { label: row.label, part, block },
      partSpeaker: speaker,
      unit: {
        position: { label: row.label, part, unit: 0 },
        speaker,
        leadingTool: false,
      },
      score: id.score,
      nameLen: id.nameLen,
      reconstructed: false,
    };
  });
  return occurrences.sort((left, right) => {
    const part = left.at.part - right.at.part;
    return part !== 0 ? part : left.at.block - right.at.block;
  });
};
