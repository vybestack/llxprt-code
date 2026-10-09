/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { IContent, ToolCallBlock } from './IContent.js';
import type { HistoryReadCursor } from '../../recording/synchronousHistoryCursor.js';
import type { RowOwnership } from '../../recording/rowOwnership.js';
import type {
  HistoryJournalStore,
  HistoryJournalOp,
} from './historyJournalStore.js';
import { HistoryDensityRows } from './historyDensityRows.js';
import { HistoryRepairIndex } from './historyRepairIndex.js';
import {
  hasValidBlocks,
  createSyntheticToolMessage,
} from './historyToolPairing.js';
import { planHistoryMutation } from './planHistoryMutation.js';
import { historyMutationFailure } from './historyMutationEffects.js';

export class HistoryValidationRepair {
  readonly previous: HistoryDensityRows;
  readonly next: HistoryDensityRows;
  readonly inserted: HistoryDensityRows;
  private readonly index: HistoryRepairIndex;
  private addressed = true;
  private admitted = 0;

  constructor(private readonly ownership?: RowOwnership) {
    this.previous = new HistoryDensityRows(ownership);
    try {
      this.next = new HistoryDensityRows(ownership);
      try {
        this.inserted = new HistoryDensityRows(ownership);
        try {
          this.index = new HistoryRepairIndex();
        } catch (error) {
          this.inserted.close();
          throw error;
        }
      } catch (error) {
        this.next.close();
        throw error;
      }
    } catch (error) {
      this.previous.close();
      throw error;
    }
  }

  capture(cursor: HistoryReadCursor, stamp: (row: IContent) => IContent): void {
    let position = 0;
    for (const row of cursor.rows()) {
      const seq = row.metadata?.chronology?.seq;
      if (seq === undefined || !this.index.add('sequence-', String(seq)))
        this.addressed = false;
      if (seq !== undefined) stamp(row);
      if (cursor.isPendingRow(position++)) this.previous.appendSanitized(row);
      else this.previous.append(row);
      this.collectResponses(row);
    }
    for (const row of this.previous) {
      this.next.append(row);
      const missing =
        row.speaker !== 'ai' || !hasValidBlocks(row)
          ? []
          : row.blocks.filter(
              (block): block is ToolCallBlock =>
                block.type === 'tool_call' && !this.index.has(block.id),
            );
      if (missing.length === 0) continue;
      const synthetic = stamp(createSyntheticToolMessage(missing));
      this.ownership?.retain(synthetic);
      try {
        this.index.writeAnchor(
          this.inserted.length,
          row.metadata?.chronology?.seq ?? 0,
        );
        this.inserted.append(synthetic);
        this.next.append(synthetic);
        for (const call of missing) this.index.add('response-', call.id);
      } finally {
        this.ownership?.release(synthetic);
      }
    }
  }

  private collectResponses(row: IContent): void {
    if (!hasValidBlocks(row)) return;
    for (const block of row.blocks)
      if (block.type === 'tool_response' && block.callId)
        this.index.add('response-', block.callId);
  }

  private *operations(): Generator<HistoryJournalOp, void, unknown> {
    if (!this.addressed) {
      yield* planHistoryMutation(this.previous, this.next, this.ownership);
      return;
    }
    let index = 0;
    for (const content of this.inserted) {
      const chronologySeq = content.metadata?.chronology?.seq;
      if (chronologySeq === undefined)
        throw new Error('Repair row chronology missing');
      yield {
        kind: 'syntheticInsert',
        payload: {
          content,
          chronologySeq,
          afterSeq: this.index.readAnchor(index++),
        },
      };
    }
  }

  publish(journal: HistoryJournalStore): void {
    if (this.inserted.length === 0) return;
    try {
      for (const op of this.operations()) {
        journal.apply(op);
        this.admitted++;
      }
    } catch (error) {
      const failures: unknown[] = [];
      try {
        this.rollback(journal);
      } catch (failure) {
        failures.push(failure);
      }
      throw historyMutationFailure(error, failures);
    }
  }

  rollback(journal: HistoryJournalStore): void {
    if (this.admitted === 0) return;
    journal.apply({
      kind: 'rewind',
      itemsRemoved: this.previous.length + this.inserted.length,
    });
    for (const content of this.previous)
      journal.apply({ kind: 'content', content });
    this.admitted = 0;
  }

  close(): void {
    try {
      this.index.close();
    } finally {
      try {
        this.inserted.close();
      } finally {
        try {
          this.next.close();
        } finally {
          this.previous.close();
        }
      }
    }
  }
}
