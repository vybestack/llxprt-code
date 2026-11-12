/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { IContent } from '../services/history/IContent.js';
import type { SessionRecordLine, SessionStartPayload } from './types.js';

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

/** The session_start line as built at construction, before any rebinding. */
export interface PendingSessionStart {
  readonly line: SessionRecordLine;
  readonly payload: SessionStartPayload;
  readonly record: PendingRecord;
}

/** A session_start header rebuilt for the provider/model at materialization. */
export interface HeaderRebind {
  readonly record: PendingRecord;
  /** Byte growth of the rebuilt header over the buffered one. */
  readonly growth: number;
}

/** A record batch that can be published, rolled back, and finalized. */
export interface PreparedContentBatch<
  Completion extends void | Promise<void> = void,
> {
  publish(): void;
  rollback(): void;
  finalize(): Completion;
}

/** Events that install a recorded history snapshot instead of appending. */
export function replacesHistory(type: SessionRecordLine['type']): boolean {
  return type === 'semantic_media_purge' || type === 'refusal_rewrite';
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

/** One record of the given event type, at the sequence after `lastSeq`. */
export function toEventRecord(
  type: SessionRecordLine['type'],
  payload: unknown,
  lastSeq: number,
  version: number,
): PendingRecord {
  return toPendingRecord({
    v: version,
    seq: lastSeq + 1,
    ts: new Date().toISOString(),
    type,
    payload,
  });
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
