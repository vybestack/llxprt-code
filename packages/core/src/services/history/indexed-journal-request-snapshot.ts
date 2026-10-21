/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { JournalFormatError } from '../../journal/errors.js';
import type { NormalizedFamily, OccurrenceKind } from '../../journal/idKeys.js';
import {
  JournalRequestOccurrences,
  type RequestUnitRange,
} from './journal-request-occurrences.js';
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
import { JournalRequestKimi } from './journal-request-kimi.js';
import { JournalRequestMistral } from './journal-request-mistral.js';
import type { MistralMapping } from '../../journal/mistralMapping.js';

async function releaseQueryHold(
  release: () => void | Promise<void>,
  failed: boolean,
): Promise<void> {
  try {
    await release();
  } catch (cleanup) {
    if (!failed) throw cleanup;
  }
}

export class IndexedJournalRequestSnapshot {
  private closed = false;
  private kimi: Promise<JournalRequestKimi> | undefined;
  private readonly mistral = new Map<number, Promise<JournalRequestMistral>>();

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
      await releaseQueryHold(release, true);
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

  private occurrences(
    family: NormalizedFamily,
    kind: OccurrenceKind,
    id: string,
    range?: RequestUnitRange,
  ): Promise<JournalRequestOccurrences> {
    return JournalRequestOccurrences.create(
      this.snapshot,
      this.source,
      this.rows,
      family,
      kind,
      id,
      this.count,
      range,
    );
  }

  private async query<T>(
    consume: () => T | Promise<T>,
    signal?: AbortSignal,
  ): Promise<T> {
    this.requireOpen();
    signal?.throwIfAborted();
    const release = this.snapshot.hold();
    let failed = false;
    try {
      const result = await consume();
      signal?.throwIfAborted();
      return result;
    } catch (error) {
      failed = true;
      throw error;
    } finally {
      await releaseQueryHold(release, failed);
    }
  }

  withNormalized<T>(
    family: NormalizedFamily,
    kind: OccurrenceKind,
    id: string,
    consume: (view: JournalRequestOccurrences) => T | Promise<T>,
    range?: RequestUnitRange,
    signal?: AbortSignal,
  ): Promise<T> {
    return this.query(async () => {
      const view = await this.occurrences(family, kind, id, range);
      signal?.throwIfAborted();
      return consume(view);
    }, signal);
  }

  withKimi<T>(
    consume: (view: JournalRequestKimi) => T | Promise<T>,
    signal?: AbortSignal,
  ): Promise<T> {
    return this.query(async () => {
      this.kimi ??= JournalRequestKimi.create(
        this.snapshot,
        this.source,
        this.rows,
      );
      const view = await this.kimi;
      signal?.throwIfAborted();
      return consume(view);
    }, signal);
  }

  withMistral<T>(
    slot: number,
    consume: (view: JournalRequestMistral) => T | Promise<T>,
    signal?: AbortSignal,
  ): Promise<T> {
    return this.query(async () => {
      await this.snapshot.requireMistralSlot(slot);
      let prepared = this.mistral.get(slot);
      if (prepared === undefined) {
        prepared = JournalRequestMistral.create(
          this.snapshot,
          this.source,
          this.rows,
          slot,
        );
        this.mistral.set(slot, prepared);
      }
      const view = await prepared;
      signal?.throwIfAborted();
      return consume(view);
    }, signal);
  }

  mistralMapping(
    rawId: string,
    slot: number,
  ): Promise<MistralMapping | undefined> {
    return this.withMistral(slot, (view) => view.mapping(rawId));
  }

  kimiEligibleCount(): Promise<number> {
    return this.withKimi((view) => view.eligibleCount());
  }

  kimiMappedId(rawId: string): Promise<string | undefined> {
    return this.withKimi((view) => view.mappedId(rawId));
  }

  kimiName(rawId: string): Promise<string | undefined> {
    return this.withKimi((view) => view.name(rawId));
  }

  kimiOrdinal(rawId: string): Promise<number | undefined> {
    return this.withKimi((view) => view.ordinal(rawId));
  }

  normalizedCount(
    family: NormalizedFamily,
    kind: OccurrenceKind,
    id: string,
    range?: RequestUnitRange,
  ): Promise<number> {
    return this.withNormalized(family, kind, id, (view) => view.count, range);
  }

  normalizedPosition(
    family: NormalizedFamily,
    kind: OccurrenceKind,
    id: string,
    ordinal: number,
    range?: RequestUnitRange,
  ): Promise<number | undefined> {
    return this.withNormalized(
      family,
      kind,
      id,
      (view) => view.position(ordinal),
      range,
    );
  }

  firstAfter(
    family: NormalizedFamily,
    kind: OccurrenceKind,
    id: string,
    after: number,
    range?: RequestUnitRange,
  ): Promise<number | undefined> {
    return this.withNormalized(
      family,
      kind,
      id,
      (view) => view.firstAfter(after),
      range,
    );
  }

  lastAtOrAfter(
    family: NormalizedFamily,
    kind: OccurrenceKind,
    id: string,
    from: number,
    range?: RequestUnitRange,
  ): Promise<boolean> {
    return this.withNormalized(
      family,
      kind,
      id,
      (view) => view.lastAtOrAfter(from),
      range,
    );
  }

  async *normalizedRange(
    family: NormalizedFamily,
    kind: OccurrenceKind,
    id: string,
    range?: RequestUnitRange,
    signal?: AbortSignal,
  ): AsyncGenerator<number> {
    this.requireOpen();
    signal?.throwIfAborted();
    const release = this.snapshot.hold();
    let failed = false;
    try {
      const view = await this.occurrences(family, kind, id, range);
      for (let ordinal = 1; ordinal <= view.count; ordinal++) {
        signal?.throwIfAborted();
        const position = await view.position(ordinal);
        if (position === undefined)
          throw new JournalFormatError('Missing request occurrence');
        signal?.throwIfAborted();
        yield position;
      }
    } catch (error) {
      failed = true;
      throw error;
    } finally {
      await releaseQueryHold(release, failed);
    }
  }

  close(): void | Promise<void> {
    if (this.closed) return;
    this.closed = true;
    return this.release();
  }
}
