/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { RemovedInteriorSpan } from './historyEventTypes.js';
import { SPAN_WINDOW_CAPACITY } from './historySpanWindow.js';

export const JOURNAL_SPAN_WINDOW = 'history:density-spans:1';
const reasons: ReadonlyArray<RemovedInteriorSpan['reason']> = [
  'density-removed',
  'density-replaced',
  'rewound',
  'cleared',
  'compressed',
];
const SPAN_BYTES = 15;

function putSequence(bytes: Uint8Array, offset: number, value: number): void {
  let remaining = BigInt(value);
  for (let at = offset + 6; at >= offset; at--) {
    bytes[at] = Number(remaining & 255n);
    remaining >>= 8n;
  }
}

export function encodeJournalSpanWindow(
  spans: readonly RemovedInteriorSpan[],
): Uint8Array {
  if (spans.length > SPAN_WINDOW_CAPACITY)
    throw new RangeError('Standing span window exceeds capacity');
  const bytes = new Uint8Array(2 + spans.length * SPAN_BYTES);
  new DataView(bytes.buffer).setUint16(0, spans.length);
  spans.forEach((span, index) => {
    const offset = 2 + index * SPAN_BYTES;
    putSequence(bytes, offset, span.start);
    putSequence(bytes, offset + 7, span.end);
    bytes[offset + 14] = reasons.indexOf(span.reason);
  });
  return bytes;
}
