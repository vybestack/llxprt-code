/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { SynchronousValueSpool } from './synchronous-value-spool.js';
import type { StagedPurgeRecording } from './semanticPurgeRecordingRows.js';
import { isRecord } from '../services/history/historyJournalGuards.js';

export interface PendingRecord {
  readonly seq: number;
  readonly json: string;
  readonly bytes: number;
  readonly staged?: StagedPurgeRecording;
  readonly suffix?: string;
}

function decodeRecord(value: unknown): PendingRecord {
  if (!isRecord(value)) throw new Error('Invalid recording value ticket');
  if (
    typeof value.seq !== 'number' ||
    typeof value.json !== 'string' ||
    typeof value.bytes !== 'number'
  )
    throw new Error('Invalid recording value ticket');
  if (value.suffix !== undefined && typeof value.suffix !== 'string')
    throw new Error('Invalid recording value ticket');
  return {
    seq: value.seq,
    json: value.json,
    bytes: value.bytes,
    suffix: value.suffix,
  };
}

export class RecordingTicketQueue implements Iterable<PendingRecord> {
  private values = new SynchronousValueSpool(decodeRecord);
  private head = 0;
  private readonly staged = new Map<number, StagedPurgeRecording>();
  get length(): number {
    return this.values.length - this.head;
  }
  push(...records: readonly PendingRecord[]): void {
    for (const record of records) {
      const ordinal = this.values.append({
        seq: record.seq,
        json: record.json,
        bytes: record.bytes,
        suffix: record.suffix,
      });
      if (record.staged !== undefined) this.staged.set(ordinal, record.staged);
    }
  }
  read(index: number): PendingRecord {
    const ordinal = this.head + index;
    return { ...this.values.read(ordinal), staged: this.staged.get(ordinal) };
  }
  removeFirst(): void {
    if (this.length === 0) throw new Error('Recording ticket queue is empty');
    this.staged.delete(this.head++);
    if (this.length === 0) {
      this.values = this.values.reset();
      this.head = 0;
    }
  }
  retireIdleStorage(): void {
    if (this.length === 0) this.clear();
  }
  clear(): void {
    for (const staged of this.staged.values()) staged.close();
    this.staged.clear();
    this.values.close();
    this.values = new SynchronousValueSpool(decodeRecord);
    this.head = 0;
  }
  close(): void {
    this.clear();
    this.values.close();
  }
  *[Symbol.iterator](): Generator<PendingRecord, void, unknown> {
    for (let index = 0; index < this.length; index++) yield this.read(index);
  }
}
