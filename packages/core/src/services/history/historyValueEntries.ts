/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { IContent } from './IContent.js';
import type { RowOwnership } from '../../recording/rowOwnership.js';
import { trackMutationOwners } from './historyMutationOwnership.js';
import { invalidateResponsesStatefulChain } from './IContent.js';
import type { DensityResult } from '../../core/compression/types.js';
import { validateDensityResult } from './densityValidation.js';
import type { DiskDensityResult } from './historyDiskDensity.js';
import type {
  DetachedHistorySink,
  DetachedHistoryTransform,
} from './detachedHistoryAPI.js';

async function appendDensityValue(
  sink: DetachedHistorySink,
  index: number,
  row: IContent,
  replacement: IContent | undefined,
): Promise<void> {
  const [clean] = invalidateResponsesStatefulChain([replacement ?? row]);
  if (replacement === undefined) await sink.appendValue(clean);
  else await sink.appendReplacement(index, clean);
}

/** A row history admits: a known speaker and at least one block. */
export function isAcceptedHistoryValue(content: IContent): boolean {
  return (
    ['human', 'ai', 'tool'].includes(content.speaker) &&
    Array.isArray(content.blocks) &&
    content.blocks.length > 0
  );
}

export function* acceptedHistoryValues(
  contents: readonly IContent[],
): Generator<IContent, void, unknown> {
  for (const content of contents) {
    if (isAcceptedHistoryValue(content)) yield content;
  }
}

export function densityValueTransform(
  result: DensityResult,
): DetachedHistoryTransform {
  const input: { result: DensityResult | undefined } = { result };
  return async (source, sink): Promise<void> => {
    const current = input.result;
    if (current === undefined)
      throw new Error('Density values already consumed');
    try {
      validateDensityResult(current, source.length);
      const removed = new Set(current.removals);
      let ordinal = 0;
      for await (const row of source.streamRows()) {
        const index = ordinal++;
        if (removed.has(index)) await sink.removeValue(index);
        else
          await appendDensityValue(
            sink,
            index,
            row,
            current.replacements.get(index),
          );
      }
    } finally {
      input.result = undefined;
    }
  };
}

/** Applies the decisions of a disk density pass to the rows of the version it read. */
export function diskDensityTransform(
  result: DiskDensityResult,
  ownership?: RowOwnership,
): DetachedHistoryTransform {
  return async (source, sink): Promise<void> => {
    let ordinal = 0;
    for await (const row of source.streamRows()) {
      const release = trackMutationOwners([row], ownership);
      try {
        const index = ordinal++;
        const decision = result.decision(index);
        if (decision?.kind === 'removed') await sink.removeValue(index);
        else
          await appendDensityValue(
            sink,
            index,
            row,
            decision?.kind === 'replaced' ? decision.row : undefined,
          );
      } finally {
        release();
      }
    }
  };
}
