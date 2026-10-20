/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { JournalFormatError } from '../../journal/errors.js';
import type { VersionSnapshot } from '../../journal/versionSnapshot.js';
import type { IndexedUnit } from '../../journal/rowTreeQueries.js';
import type { IContent } from './IContent.js';
import { JournalTailSource } from './journal-tail-source.js';
import {
  indexedOverlay,
  type IndexedOverlayRow,
} from './journal-indexed-overlay.js';
import { journalEntryPlans } from './journal-entry-plans.js';
import type { JournalResponsePlan } from './journal-response-plan.js';
import { assertRowIndex } from './provider-request-snapshot.js';
import { streamResponsePlans } from './journal-response-units.js';

export class IndexedJournalRequestSnapshot {
  private closed = false;

  private constructor(
    private readonly snapshot: VersionSnapshot,
    private readonly source: JournalTailSource,
    private readonly rows: readonly IndexedOverlayRow[],
    readonly count: number,
    readonly pending: {
      readonly inputCount: number;
      readonly firstOutputIndex: number | undefined;
    },
    private readonly release: () => void | Promise<void>,
  ) {}

  static async create(
    snapshot: VersionSnapshot,
    tail: readonly IContent[] = [],
  ): Promise<IndexedJournalRequestSnapshot> {
    const release = snapshot.hold();
    try {
      const source = await JournalTailSource.create(snapshot, tail);
      const overlay = await indexedOverlay(snapshot, source);
      return new IndexedJournalRequestSnapshot(
        snapshot,
        source,
        overlay.rows,
        overlay.count,
        Object.freeze({
          inputCount: tail.length,
          firstOutputIndex: overlay.firstOutputIndex,
        }),
        release,
      );
    } catch (error) {
      await release();
      throw error;
    }
  }

  private requireOpen(): void {
    if (this.closed)
      throw new Error('Indexed journal request snapshot is closed');
    this.snapshot.requireOpen();
  }

  isPending(index: number): boolean {
    this.requireOpen();
    assertRowIndex(index, this.count);
    for (const row of this.rows) {
      if (index >= row.start && index < row.start + row.count)
        return (row.pendingMask & (1 << (index - row.start))) !== 0;
    }
    return false;
  }

  private async locate(index: number): Promise<IndexedUnit> {
    let delta = 0;
    for (const row of this.rows) {
      if (index < row.start) break;
      if (index < row.start + row.count)
        return { entry: row.entry, unit: index - row.start };
      delta += row.count - row.oldCount;
    }
    return this.snapshot.unitAt(index - delta);
  }

  async planAt(
    index: number,
    signal?: AbortSignal,
  ): Promise<JournalResponsePlan> {
    this.requireOpen();
    signal?.throwIfAborted();
    assertRowIndex(index, this.count);
    const selected = await this.locate(index);
    let within = 0;
    for await (const plan of journalEntryPlans(this.source, selected.entry)) {
      if (within++ === selected.unit) return plan;
    }
    throw new JournalFormatError(
      'Indexed unit selection exceeds its row contribution',
    );
  }

  async readAt(index: number, signal?: AbortSignal): Promise<IContent> {
    const plan = await this.planAt(index, signal);
    const blocks: IContent['blocks'] = [];
    for await (const block of plan.openBlocks()) {
      this.requireOpen();
      signal?.throwIfAborted();
      blocks.push(block);
    }
    return { ...plan.header, blocks };
  }

  async *openReader(signal?: AbortSignal): AsyncGenerator<IContent> {
    this.requireOpen();
    for await (const plan of streamResponsePlans(this.source)) {
      this.requireOpen();
      signal?.throwIfAborted();
      const blocks: IContent['blocks'] = [];
      for await (const block of plan.openBlocks()) {
        this.requireOpen();
        signal?.throwIfAborted();
        blocks.push(block);
      }
      yield { ...plan.header, blocks };
    }
  }

  close(): void | Promise<void> {
    if (this.closed) return;
    this.closed = true;
    return this.release();
  }
}
