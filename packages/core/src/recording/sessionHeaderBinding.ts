/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { PendingRecord } from './recording-ticket-queue.js';
import type { SessionRecordLine, SessionStartPayload } from './types.js';

/**
 * A record that has already been serialised. Serialising at enqueue time keeps
 * byte accounting free and means each record, including large media payloads,
 * is stringified exactly once instead of once for accounting and again for the
 * write (issue #2852). Only the serialized form is retained: the live payload
 * object graph is not pinned until drain (issue #3432).
 */
export function toPendingRecord(line: SessionRecordLine): PendingRecord {
  const json = JSON.stringify(line);
  return {
    seq: line.seq,
    json,
    bytes: Buffer.byteLength(json, 'utf8') + 1,
  };
}

/** A session_start header rebuilt for the provider/model at materialization. */
export interface HeaderRebind {
  readonly record: PendingRecord;
  /** Byte growth of the rebuilt header over the buffered one. */
  readonly growth: number;
}

/**
 * The session_start header as built at construction. The provider can change
 * (profile load, model picker) between construction and the first write, so
 * the header written to disk must carry the provider/model in effect then, not
 * the construction-time values (issue #3732).
 */
export class SessionHeaderBinding {
  constructor(
    private readonly line: SessionRecordLine,
    private readonly payload: SessionStartPayload,
    private readonly record: PendingRecord,
    private readonly resolveProviderModel:
      | (() => { provider: string; model: string })
      | undefined,
  ) {}

  /**
   * The header for the provider/model in effect now, or null when it matches
   * the buffered header or no resolver was supplied. `sessionId`, `seq`, `ts`
   * and `startTime` stay those of the original header. Planning mutates
   * nothing: callers account for the growth before applying the plan.
   */
  plan(): HeaderRebind | null {
    if (this.resolveProviderModel === undefined) return null;
    const { provider, model } = this.resolveProviderModel();
    if (provider === this.payload.provider && model === this.payload.model) {
      return null;
    }
    const record = toPendingRecord({
      ...this.line,
      payload: { ...this.payload, provider, model },
    });
    return { record, growth: record.bytes - this.record.bytes };
  }
}
