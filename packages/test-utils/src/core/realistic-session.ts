/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { createHash } from 'node:crypto';

export const REALISTIC_SESSION_ROWS = 25_000;
export const REALISTIC_SESSION_PAYLOAD_BYTES = 64 * 1024 * 1024;
const LARGE_ROW_BYTES = 2 * 1024 * 1024;
const LARGE_ROW_INDICES = [4095, 12_287, 20_479];

export interface RealisticSessionRow {
  readonly id: string;
  readonly role: 'human' | 'ai' | 'tool';
  readonly kind: 'text' | 'tool-call' | 'tool-result';
  readonly text: string;
  readonly callId?: string;
  readonly toolName?: string;
}

export interface RealisticSessionOptions {
  readonly rowCount?: number;
  readonly payloadBytes?: number;
  readonly onRow?: (row: RealisticSessionRow) => void;
}

export interface RealisticSessionSummary {
  readonly rowCount: number;
  readonly neutralPayloadBytes: number;
  readonly largestUnitBytes: number;
  readonly sha256: string;
  readonly kinds: Readonly<Record<RealisticSessionRow['kind'], number>>;
}

function rowText(index: number, bytes: number): string {
  const prefix = `Session row ${index.toString().padStart(8, '0')}: café 雪 "\\\n`;
  const remaining = bytes - Buffer.byteLength(prefix);
  if (remaining < 0)
    throw new Error('Session payload is too small for row identities');
  const body = `command output ${index.toString(36)} abcdefghijklmnopqrstuvwxyz0123456789 `;
  return (
    prefix + body.repeat(Math.ceil(remaining / body.length)).slice(0, remaining)
  );
}

function makeRow(index: number, bytes: number): RealisticSessionRow {
  const id = `85400000-0000-4000-8000-${index.toString(16).padStart(12, '0')}`;
  const text = rowText(index, bytes);
  const offset = index % 4;
  if (offset < 2) {
    return { id, text, kind: 'text', role: offset === 0 ? 'human' : 'ai' };
  }
  const callId = `call_${Math.floor(index / 4)
    .toString(16)
    .padStart(24, '0')}`;
  return {
    id,
    text,
    callId,
    toolName: 'read_file',
    role: offset === 2 ? 'ai' : 'tool',
    kind: offset === 2 ? 'tool-call' : 'tool-result',
  };
}

export function* realisticSessionRows(
  options: RealisticSessionOptions = {},
): Generator<RealisticSessionRow, void, unknown> {
  const rowCount = options.rowCount ?? REALISTIC_SESSION_ROWS;
  const payloadBytes = options.payloadBytes ?? REALISTIC_SESSION_PAYLOAD_BYTES;
  if (!Number.isSafeInteger(rowCount) || rowCount < 4 || rowCount % 4 !== 0) {
    throw new Error('Session rowCount must be a positive multiple of four');
  }
  if (!Number.isSafeInteger(payloadBytes) || payloadBytes < rowCount * 128) {
    throw new Error(
      'Session payloadBytes must provide at least 128 bytes per row',
    );
  }
  const largeIndices =
    rowCount === REALISTIC_SESSION_ROWS && payloadBytes >= 60 * 1024 * 1024
      ? LARGE_ROW_INDICES
      : [];
  const ordinaryCount = rowCount - largeIndices.length;
  const ordinaryBytes = payloadBytes - largeIndices.length * LARGE_ROW_BYTES;
  const base = Math.floor(ordinaryBytes / ordinaryCount);
  const remainder = ordinaryBytes % ordinaryCount;
  let ordinaryIndex = 0;
  for (let index = 0; index < rowCount; index++) {
    const ordinarySize = base + Number(ordinaryIndex < remainder);
    const large = largeIndices.includes(index);
    const bytes = large ? LARGE_ROW_BYTES : ordinarySize;
    if (!large) ordinaryIndex++;
    const row = makeRow(index, bytes);
    options.onRow?.(row);
    yield row;
  }
}

/** Reconstruct one default-corpus row for random-access reference converters. */
export function realisticSessionRowAt(index: number): RealisticSessionRow {
  if (
    !Number.isSafeInteger(index) ||
    index < 0 ||
    index >= REALISTIC_SESSION_ROWS
  )
    throw new RangeError('Reference row is outside the realistic session');
  const ordinaryCount = REALISTIC_SESSION_ROWS - LARGE_ROW_INDICES.length;
  const ordinaryBytes =
    REALISTIC_SESSION_PAYLOAD_BYTES -
    LARGE_ROW_INDICES.length * LARGE_ROW_BYTES;
  const ordinaryIndex =
    index - LARGE_ROW_INDICES.filter((large) => large < index).length;
  const bytes = LARGE_ROW_INDICES.includes(index)
    ? LARGE_ROW_BYTES
    : Math.floor(ordinaryBytes / ordinaryCount) +
      Number(ordinaryIndex < ordinaryBytes % ordinaryCount);
  return makeRow(index, bytes);
}

export function sessionRowPayload(row: RealisticSessionRow): string {
  return row.text;
}

export function realisticSessionSummary(
  options: RealisticSessionOptions = {},
): RealisticSessionSummary {
  const hash = createHash('sha256');
  let rowCount = 0;
  let neutralPayloadBytes = 0;
  let largestUnitBytes = 0;
  let callBytes = 0;
  const kinds = { text: 0, 'tool-call': 0, 'tool-result': 0 };
  for (const row of realisticSessionRows(options)) {
    const payload = sessionRowPayload(row);
    const bytes = Buffer.byteLength(payload);
    hash.update(payload);
    rowCount++;
    neutralPayloadBytes += bytes;
    const unitBytes = row.kind === 'tool-result' ? bytes + callBytes : bytes;
    largestUnitBytes = Math.max(largestUnitBytes, unitBytes);
    callBytes = row.kind === 'tool-call' ? bytes : 0;
    kinds[row.kind]++;
  }
  return {
    rowCount,
    neutralPayloadBytes,
    largestUnitBytes,
    kinds,
    sha256: hash.digest('hex'),
  };
}
