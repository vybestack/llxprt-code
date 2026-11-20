/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { HistoryService } from './HistoryService.js';
import type { IContent } from './IContent.js';
import type { DetachedHistoryOptions } from './detachedHistoryMutation.js';

export async function publishReviewedRewrite(
  history: HistoryService,
  replacements: ReadonlyMap<number, IContent>,
  options: DetachedHistoryOptions,
): Promise<void> {
  const anchor = history.getCacheAnchorSeq();
  let beforeAnchor = true;
  let headChanged = false;
  const reset = { applied: false };
  try {
    await history.detachedValues.transform(
      async (source, sink) => {
        let ordinal = 0;
        for await (const row of source.streamRows(options.signal)) {
          const replacement = replacements.get(ordinal);
          if (replacement !== undefined && beforeAnchor) headChanged = true;
          if (row.metadata?.chronology?.seq === anchor) beforeAnchor = false;
          const next = replacement ?? row;
          await sink.appendDerived(
            ordinal++,
            replacements.size === 0
              ? next
              : {
                  ...next,
                  metadata: Object.fromEntries(
                    Object.entries(next.metadata ?? {}).filter(
                      ([key]) => key !== 'responsesStored',
                    ),
                  ),
                },
          );
        }
      },
      undefined,
      {
        ...options,
        afterPublication: async () => {
          if (anchor > 0 && !beforeAnchor && headChanged) {
            history.resetCacheAnchorSeq();
            reset.applied = true;
          }
          await options.afterPublication?.();
        },
      },
    );
  } catch (error) {
    if (reset.applied) history.setCacheAnchorSeq(anchor);
    throw error;
  }
}
