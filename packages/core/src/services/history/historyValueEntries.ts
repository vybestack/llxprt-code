/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { IContent } from './IContent.js';
import { invalidateResponsesStatefulChain } from './IContent.js';
import type { DensityResult } from '../../core/compression/types.js';
import { validateDensityResult } from './densityValidation.js';
import type {
  DetachedHistorySink,
  DetachedHistoryTransform,
} from './detachedHistoryAPI.js';

function appendDensityValue(
  sink: DetachedHistorySink,
  index: number,
  row: IContent,
  replacement: IContent | undefined,
): void {
  const [clean] = invalidateResponsesStatefulChain([replacement ?? row]);
  if (replacement === undefined) sink.appendValue(clean);
  else sink.appendReplacement(index, clean);
}

export function* acceptedHistoryValues(
  contents: readonly IContent[],
): Generator<IContent, void, unknown> {
  for (const content of contents) {
    if (
      ['human', 'ai', 'tool'].includes(content.speaker) &&
      Array.isArray(content.blocks) &&
      content.blocks.length > 0
    )
      yield content;
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
        if (removed.has(index)) sink.removeValue(index);
        else
          appendDensityValue(sink, index, row, current.replacements.get(index));
      }
    } finally {
      input.result = undefined;
    }
  };
}
