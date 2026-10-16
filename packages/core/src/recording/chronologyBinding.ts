/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { ChronologyMarker } from '../services/history/IContent.js';
import { field, validSeq } from './resolverProjection.js';

export interface ChronologyBinding {
  readonly rowIndex: number;
  readonly chronology: ChronologyMarker;
  readonly invalidateResponses?: boolean;
}

export function parseChronologyBinding(
  value: unknown,
): ChronologyBinding | null {
  const rowIndex = field(value, 'rowIndex');
  const marker = field(value, 'chronology');
  const seq = field(marker, 'seq');
  const userTurn = field(marker, 'userTurn');
  const step = field(marker, 'step');
  const recordedAt = field(marker, 'recordedAt');
  if (
    !validSeq(rowIndex) ||
    !validSeq(seq) ||
    !validSeq(userTurn) ||
    !validSeq(step)
  )
    return null;
  if (!validSeq(recordedAt)) return null;
  return {
    rowIndex,
    chronology: { seq, userTurn, step, recordedAt },
    ...(field(value, 'invalidateResponses') === true
      ? { invalidateResponses: true }
      : {}),
  };
}
