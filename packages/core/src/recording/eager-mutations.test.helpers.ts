/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import {
  invalidateResponsesStatefulChain,
  type IContent,
} from '../services/history/IContent.js';

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
function sequence(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}
function content(value: unknown): value is IContent {
  return (
    object(value) &&
    ['human', 'ai', 'tool'].includes(String(value.speaker)) &&
    Array.isArray(value.blocks)
  );
}

export function eagerBinding(
  rows: IContent[],
  payload: Record<string, unknown>,
): IContent[] | null {
  const { rowIndex, chronology, content: replacement } = payload;
  if (!sequence(rowIndex) || rowIndex >= rows.length || !object(chronology))
    return null;
  const { seq, userTurn, step, recordedAt } = chronology;
  if (
    !sequence(seq) ||
    !sequence(userTurn) ||
    !sequence(step) ||
    !sequence(recordedAt)
  )
    return null;
  if (replacement !== undefined && !content(replacement)) return null;
  const previous = rows[rowIndex];
  const source = replacement ?? previous;
  const marked: IContent = {
    ...source,
    metadata: {
      ...source.metadata,
      chronology: { seq, userTurn, step, recordedAt },
    },
  };
  const updated =
    payload.invalidateResponses === true
      ? invalidateResponsesStatefulChain([marked])[0]
      : marked;
  return rows.map((row, index) => (index === rowIndex ? updated : row));
}

export function eagerDensity(
  rows: IContent[],
  payload: Record<string, unknown>,
): IContent[] | null {
  const { removedSeqs, replacements } = payload;
  if (
    !Array.isArray(removedSeqs) ||
    !removedSeqs.every(sequence) ||
    !Array.isArray(replacements)
  )
    return null;
  const updates = new Map<number, IContent>();
  for (const replacement of replacements) {
    if (
      !object(replacement) ||
      !sequence(replacement.replacedSeq) ||
      !content(replacement.replacement)
    )
      return null;
    updates.set(replacement.replacedSeq, replacement.replacement);
  }
  return rows.flatMap((row) => {
    const marker = row.metadata?.chronology;
    if (marker === undefined) return [row];
    const updated = updates.get(marker.seq);
    if (updated !== undefined)
      return [
        { ...updated, metadata: { ...updated.metadata, chronology: marker } },
      ];
    return removedSeqs.includes(marker.seq) ? [] : [row];
  });
}

export function eagerInsert(
  rows: IContent[],
  payload: Record<string, unknown>,
): IContent[] | null {
  const { content: inserted, chronologySeq, afterSeq } = payload;
  if (!content(inserted) || !sequence(chronologySeq) || !sequence(afterSeq))
    return null;
  const index = rows.findIndex(
    (row) => row.metadata?.chronology?.seq === afterSeq,
  );
  if (index === -1) return null;
  return [...rows.slice(0, index + 1), inserted, ...rows.slice(index + 1)];
}
