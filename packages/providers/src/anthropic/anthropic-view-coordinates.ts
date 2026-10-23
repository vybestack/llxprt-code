/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { IndexedJournalRequestSnapshot } from '@vybestack/llxprt-code-core/services/history/indexed-journal-request-snapshot.js';
import type { RepairMessage } from './anthropic-repair-source.js';

type ChangedRow =
  IndexedJournalRequestSnapshot['viewPlan']['changedSources'][number];
export interface AnthropicSourceChange {
  readonly row: ChangedRow;
  readonly oldStart: number;
}
export class AnthropicViewCoordinates {
  readonly changes: readonly AnthropicSourceChange[];
  readonly prefixEnd: number;
  readonly resized: boolean;
  constructor(query: IndexedJournalRequestSnapshot, units: number) {
    const end = query.viewPlan.sourceVersion?.nextLabel ?? 1n;
    let delta = 0;
    this.changes = query.viewPlan.changedSources.flatMap((row) => {
      if (row.entry.label >= end) return [];
      const oldStart = row.start - delta;
      delta += row.count - row.oldCount;
      return [{ row, oldStart }];
    });
    this.prefixEnd = units + delta;
    this.resized = this.changes.some(({ row }) => row.count !== row.oldCount);
  }
  forward(at: number): number {
    let delta = 0;
    for (const { row, oldStart } of this.changes) {
      if (at < oldStart) break;
      if (at < oldStart + row.oldCount) return row.start + at - oldStart;
      delta += row.count - row.oldCount;
    }
    return at + delta;
  }
  backward(at: number): number {
    let delta = 0;
    for (const { row, oldStart } of this.changes) {
      if (at < row.start) break;
      if (at < row.start + row.count) return oldStart + at - row.start;
      delta += row.count - row.oldCount;
    }
    return at - delta;
  }
  message(message: RepairMessage): RepairMessage {
    return {
      ...message,
      start: this.forward(message.start),
      end: this.forward(message.end),
    };
  }
}
