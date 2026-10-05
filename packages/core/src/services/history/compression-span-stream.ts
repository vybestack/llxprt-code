/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { setImmediate } from 'node:timers/promises';
import { CompressionSpanIndex } from './compression-span-index.js';
import type {
  IContent,
  ChronologyReplacedSpan,
  ContentMetadata,
} from './IContent.js';

type PurgeFrontier = ContentMetadata['semanticMediaPurgeFrontier'];

function transferFrontier(
  entries: IContent[],
  frontier: PurgeFrontier,
): IContent[] {
  if (
    frontier === undefined ||
    entries.length === 0 ||
    entries.some(
      (entry) => entry.metadata?.semanticMediaPurgeFrontier !== undefined,
    )
  )
    return entries;
  const first = entries[0];
  entries[0] = {
    ...first,
    metadata: { ...first.metadata, semanticMediaPurgeFrontier: frontier },
  };
  return entries;
}

function annotateOutput(
  newHistory: readonly IContent[],
  span: ChronologyReplacedSpan,
  frontier: PurgeFrontier,
): IContent[] {
  const annotated = newHistory.map((entry) => {
    if (
      span.itemCount === 0 ||
      entry.metadata?.isSummary !== true ||
      entry.metadata.chronologyReplaced !== undefined
    )
      return entry;
    return {
      ...entry,
      metadata: { ...entry.metadata, chronologyReplaced: span },
    };
  });
  return transferFrontier(annotated, frontier);
}

/** The candidate is borrowed and must remain immutable until annotation settles.
 * Prior membership comes from the caller's pinned cursor. Only scalar markers
 * and the first purge frontier survive traversal; distinct sequence membership
 * is indexed on disk, including duplicate sequences and retained candidates.
 * The result remains array-valued at the existing replacement boundary.
 */
export async function annotateCompressionSpanStream(
  previousHistory: AsyncIterable<IContent> | Iterable<IContent>,
  newHistory: readonly IContent[],
  options: { readonly signal?: AbortSignal; readonly root?: string } = {},
): Promise<IContent[]> {
  const signal = options.signal;
  signal?.throwIfAborted();
  const index = new CompressionSpanIndex(options.root);
  try {
    for (const entry of newHistory) {
      signal?.throwIfAborted();
      const seq = entry.metadata?.chronology?.seq;
      if (typeof seq === 'number') index.preserve(seq);
    }
    let fromSeq = Number.POSITIVE_INFINITY;
    let toSeq = Number.NEGATIVE_INFINITY;
    let itemCount = 0;
    let frontier: PurgeFrontier;
    let frontierCaptured = false;
    for await (const row of previousHistory) {
      signal?.throwIfAborted();
      if (
        !frontierCaptured &&
        row.metadata?.semanticMediaPurgeFrontier !== undefined
      ) {
        frontier = row.metadata.semanticMediaPurgeFrontier;
        frontierCaptured = true;
      }
      const seq = row.metadata?.chronology?.seq;
      if (typeof seq === 'number' && index.destroy(seq)) {
        itemCount += 1;
        fromSeq = seq < fromSeq ? seq : fromSeq;
        toSeq = seq > toSeq ? seq : toSeq;
      }
      await setImmediate();
      signal?.throwIfAborted();
    }
    signal?.throwIfAborted();
    return annotateOutput(newHistory, { fromSeq, toSeq, itemCount }, frontier);
  } finally {
    index.close();
  }
}
