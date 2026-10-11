/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { IContent } from '@vybestack/llxprt-code-core';
import type {
  DisplayJournalEntry,
  JournalPageFile,
} from './journal-page-file.js';

/** Decides whether a journal row of a straddled group survives the cut. */
export type RowKeep = (content: IContent, ordinal: number) => boolean;

/**
 * Where a rewind cuts the projected pages. `keep` is set when the cut lands
 * inside a projected group: the group starts at `index`, its pages go, and it
 * is projected again from the journal rows `keep` accepts.
 */
export interface RewindCut {
  readonly index: number;
  readonly keep: RowKeep | null;
}

/**
 * Locates a rewind's cut. cutSeq names the first removed chronology marker;
 * without a usable one the count of removed journal rows decides, as in
 * replay. A rewind with no readable count cannot be placed and is treated as
 * a full clear.
 */
export function locateRewindCut(
  pages: JournalPageFile,
  payload: Record<string, unknown>,
): RewindCut {
  const count = payload.itemsRemoved;
  if (typeof count !== 'number' || !(count >= 0))
    return { index: 0, keep: null };
  const cutSeq = payload.cutSeq;
  if (Number.isSafeInteger(cutSeq) && (cutSeq as number) >= 0) {
    const cut = cutBySeq(pages, cutSeq as number);
    if (cut.index < pages.length) return cut;
  }
  return cutByCount(pages, Math.ceil(count));
}

/** Compression summaries and rows before the cut marker stay. */
function survivesCut(entry: DisplayJournalEntry, cutSeq: number): boolean {
  return (
    entry.kind === 'boundary' || (entry.seq !== null && entry.seq < cutSeq)
  );
}

function cutBySeq(pages: JournalPageFile, cutSeq: number): RewindCut {
  let index = pages.length;
  while (index > 0 && !survivesCut(pages.get(index - 1), cutSeq)) index -= 1;
  if (index === pages.length) return { index, keep: null };
  const first = pages.get(index);
  const span =
    first.kind === 'projected' && first.item.type === 'tool_group'
      ? first.item.seqSpan
      : undefined;
  // A span that starts before the cut keeps its opener: the group is cut
  // through, not removed.
  if (first.kind !== 'projected' || span === undefined || span[0] >= cutSeq)
    return { index, keep: null };
  const start = groupStart(pages, index, first.offset);
  const rows = groupRows(pages, start);
  return {
    index: start,
    keep: (content, ordinal) =>
      ordinal < rows &&
      (ordinal === 0 || (chronologySeq(content) ?? Infinity) < cutSeq),
  };
}

function cutByCount(pages: JournalPageFile, count: number): RewindCut {
  let index = pages.length;
  let remaining = count;
  while (index > 0 && remaining > 0) {
    const entry = pages.get(index - 1);
    if (entry.kind === 'boundary') break;
    if (entry.rows > remaining) {
      const rows = entry.rows - remaining;
      return { index: index - 1, keep: (_content, ordinal) => ordinal < rows };
    }
    remaining -= entry.rows;
    index -= 1;
  }
  return { index, keep: null };
}

/** Pages of one group share the opener's offset; rows ride on its first. */
function groupStart(
  pages: JournalPageFile,
  from: number,
  offset: number,
): number {
  let index = from;
  while (index > 0) {
    const previous = pages.get(index - 1);
    if (previous.kind !== 'projected' || previous.offset !== offset) break;
    index -= 1;
  }
  return index;
}

function groupRows(pages: JournalPageFile, start: number): number {
  const first = pages.get(start);
  if (first.kind !== 'projected') throw new Error('Group starts at a boundary');
  return first.rows;
}

function chronologySeq(content: IContent): number | undefined {
  return content.metadata?.chronology?.seq;
}
