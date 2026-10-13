/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { ReplaceTransactionFold } from '../../recording/replaceTransaction.js';
import type { SessionEventType } from '../../recording/types.js';
import type { IContent } from './IContent.js';
import {
  applyFoldEvent,
  envelopeToEvent,
  type FoldEvent,
} from './historyJournalFold.js';
import { scanJournalRecords } from './historyJournalRecordScan.js';
import { payloadOrigin } from './historyOriginId.js';

/** Byte ranges of the hidden primary journal whose records never reached a mirror. */
export class DroppedRanges {
  private readonly ranges: Array<[number, number]> = [];

  add(start: number, end: number): void {
    const count = this.ranges.length;
    if (count > 0 && this.ranges[count - 1][1] === start)
      this.ranges[count - 1][1] = end;
    else this.ranges.push([start, end]);
  }

  has(offset: number): boolean {
    let low = 0;
    let high = this.ranges.length - 1;
    while (low <= high) {
      const middle = (low + high) >> 1;
      const [start, end] = this.ranges[middle];
      if (offset < start) high = middle - 1;
      else if (offset >= end) low = middle + 1;
      else return true;
    }
    return false;
  }

  clear(): void {
    this.ranges.length = 0;
  }
}

/** Rows below this byte offset of the primary are owned by `origin`, whatever their records say. */
export interface BaselineOwner {
  readonly origin: string;
  readonly end: number;
}

export interface SharedRecord {
  readonly type: SessionEventType;
  readonly payload: unknown;
}

function introducedRows(event: FoldEvent): readonly IContent[] {
  switch (event.kind) {
    case 'content':
      return [event.content];
    case 'compressed':
      return [event.summary];
    case 'syntheticInsert':
      return [event.content];
    case 'density':
      return event.replacements.map((entry) => entry.replacement);
    case 'semanticPurge':
      return event.history;
    default:
      return [];
  }
}

/**
 * The shared history as the mirrors collectively hold it, with the owner of
 * every row. A row's owner is the origin its writing record carries (absent
 * means unowned). It is folded from the hidden primary journal with the one
 * fold rule every reader uses, skipping the ranges whose publication failed,
 * so it equals the union of the mirrors. It exists only while the pump
 * translates one batch and is never retained between batches.
 */
export class SharedHistoryRows {
  readonly rows: IContent[] = [];
  private readonly owners = new WeakMap<IContent, string | undefined>();
  private readonly transaction = new ReplaceTransactionFold();

  ownerOf(row: IContent): string | undefined {
    return this.owners.get(row);
  }

  /** Fold one committed record; returns the event it applied, if it changes history. */
  apply(record: SharedRecord, owner: string | undefined): FoldEvent | null {
    const event = envelopeToEvent(record.type, record.payload);
    if (event === null) return null;
    for (const row of introducedRows(event)) this.owners.set(row, owner);
    if (event.kind !== 'chronologyBind') {
      applyFoldEvent(this.rows, event, this.transaction);
      return event;
    }
    const index = event.binding.rowIndex;
    const before = index < this.rows.length ? this.rows[index] : undefined;
    applyFoldEvent(this.rows, event, this.transaction);
    // A rebinding replaces the row object but not its owner.
    if (before !== undefined && this.rows[index] !== before)
      this.owners.set(this.rows[index], this.owners.get(before));
    return event;
  }

  /** Fold the committed records of [0, end) that reached the mirrors. */
  static async fold(
    filePath: string,
    end: number,
    dropped: DroppedRanges,
    baseline: BaselineOwner | undefined,
  ): Promise<SharedHistoryRows> {
    const sharedRows = new SharedHistoryRows();
    for await (const record of scanJournalRecords(filePath, 0, end)) {
      if (dropped.has(record.start)) continue;
      const owner =
        baseline !== undefined && record.start < baseline.end
          ? baseline.origin
          : payloadOrigin(record.payload);
      sharedRows.apply(record, owner);
    }
    return sharedRows;
  }
}
