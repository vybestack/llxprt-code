/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { IContent } from '../services/history/IContent.js';
import type { SessionRecordLine } from './types.js';

/**
 * A record that has already been serialised. Serialising at enqueue time keeps
 * byte accounting free and means each record — including large media payloads —
 * is stringified exactly once instead of once for accounting and again for the
 * write (issue #2852). Only the serialized form is retained: the live payload
 * object graph is not pinned until drain (issue #3432).
 */
export interface PendingRecord {
  readonly json: string;
  readonly bytes: number;
}

export function toPendingRecord(line: SessionRecordLine): PendingRecord {
  const json = JSON.stringify(line);
  return { json, bytes: Buffer.byteLength(json, 'utf8') + 1 };
}

export function toContentBatchRecords(
  contents: readonly IContent[],
  lastSeq: number,
): PendingRecord[] {
  return contents.map((content, index) =>
    toPendingRecord({
      v: recordingVersion({ content }),
      seq: lastSeq + index + 1,
      ts: new Date().toISOString(),
      type: 'content',
      payload: { content },
    }),
  );
}

export function totalRecordBytes(records: readonly PendingRecord[]): number {
  return records.reduce((total, record) => total + record.bytes, 0);
}

function containsMediaReference(
  value: unknown,
  seen = new WeakSet<object>(),
): boolean {
  if (typeof value !== 'object' || value === null) return false;
  if (seen.has(value)) return false;
  seen.add(value);
  if (
    Reflect.get(value, 'type') === 'media' &&
    Reflect.get(value, 'encoding') === 'reference'
  ) {
    return true;
  }
  if (Array.isArray(value)) {
    return value.some((entry) => containsMediaReference(entry, seen));
  }
  return Reflect.ownKeys(value).some((key) =>
    containsMediaReference(Reflect.get(value, key), seen),
  );
}

export function recordingVersion(payload: unknown): number {
  return containsMediaReference(payload) ? 2 : 1;
}
