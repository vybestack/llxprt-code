/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { NativeFactIndexReader } from '../../journal/nativeFactIndex.js';
import type { SlotSummary } from '../../journal/slotSummary.js';
import { composeSlotSummaries } from '../../journal/summaryComposition.js';
import type { JournalStore } from '../../journal/journalStore.js';
import { JournalMistralSelection } from './journal-mistral-selection.js';
import {
  mistralPlanIds,
  mistralRequestIdentity,
  type MistralUnitIds,
} from './journal-mistral-ids.js';
import { JournalFormatError } from '../../journal/errors.js';
import type { JournalRequestProjection } from './journal-request-projection.js';
import type { NormalizedFamily, OccurrenceKind } from '../../journal/idKeys.js';
import {
  JournalRequestOccurrences,
  type RequestUnitRange,
} from './journal-request-occurrences.js';
import type { VersionSnapshot } from '../../journal/versionSnapshot.js';
import type { IndexedUnit } from '../../journal/rowTreeQueries.js';
import {
  isMediaReferenceBlock,
  type IContent,
  type ContentBlock,
  type MediaReferenceBlock,
} from './IContent.js';
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
import {
  anthropicToolFacts,
  type AnthropicToolOccurrenceFacts,
} from './journal-anthropic-facts.js';

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

export interface NativeRequestViewPlan {
  readonly sourceVersion: VersionSnapshot['version'];
  readonly changedSources: readonly IndexedOverlayRow[];
}

export class IndexedJournalRequestSnapshot {
  readonly viewPlan: NativeRequestViewPlan;
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
    private readonly mediaReferences?: WeakSet<MediaReferenceBlock>,
  ) {
    this.viewPlan = Object.freeze({
      sourceVersion: snapshot.version,
      changedSources: rows,
    });
  }

  static async create(
    snapshot: VersionSnapshot,
    tail: readonly IContent[] = [],
    projection?: JournalRequestProjection,
    mediaReferences?: WeakSet<MediaReferenceBlock>,
  ): Promise<IndexedJournalRequestSnapshot> {
    const release = snapshot.hold();
    try {
      const source = await JournalTailSource.create(snapshot, tail, projection);
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
        mediaReferences,
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

  async formatSummary(
    snapshot: VersionSnapshot,
    slot: number,
    measure: (
      plans: AsyncIterable<JournalResponsePlan>,
    ) => Promise<SlotSummary>,
    selection?: {
      readonly label: bigint;
      select(summary: SlotSummary, kept: boolean): SlotSummary;
    },
    additionalSources?: AsyncIterable<bigint>,
  ): Promise<SlotSummary> {
    this.requireOpen();
    const range = async (from: bigint, to: bigint): Promise<SlotSummary> => {
      if (selection === undefined)
        return snapshot.formatSummaryRange(slot, from, to);
      const label = selection.label;
      if (label < from || label >= to)
        return selection.select(
          await snapshot.formatSummaryRange(slot, from, to),
          false,
        );
      return snapshot.formatSummaryRange(slot, from, to, selection);
    };
    let from = 1n;
    let followingLabel: bigint | undefined;
    const end = snapshot.version?.nextLabel ?? 1n;
    let summary = await snapshot.formatSummaryRange(slot, 0n, 0n);
    for await (const { entry, nextEntry } of this.formatEntries(
      additionalSources,
    )) {
      if (entry.label > from && entry.label !== followingLabel)
        summary = composeSlotSummaries(summary, await range(from, entry.label));
      const measured = await measure(
        journalEntryPlans(this.source, entry, nextEntry),
      );
      summary = composeSlotSummaries(
        summary,
        selection === undefined
          ? measured
          : selection.select(measured, entry.label === selection.label),
      );
      from = entry.label + 1n;
      followingLabel = nextEntry?.label;
    }
    if (from < end)
      summary = composeSlotSummaries(summary, await range(from, end));
    return summary;
  }

  private async *formatEntries(
    additional?: AsyncIterable<bigint>,
  ): AsyncGenerator<{
    readonly entry: IndexedOverlayRow['entry'];
    readonly nextEntry?: IndexedOverlayRow['entry'] | null;
  }> {
    async function* empty(): AsyncGenerator<bigint> {}
    const extra = this.snapshot.selectedEntries(additional ?? empty());
    let index = 0;
    try {
      let next = await extra.next();
      while (index < this.rows.length || next.done !== true) {
        const row = index < this.rows.length ? this.rows[index] : undefined;
        if (
          row !== undefined &&
          (next.done === true || row.entry.label <= next.value.entry.label)
        ) {
          next =
            next.done !== true && row.entry.label === next.value.entry.label
              ? await extra.next()
              : next;
          index++;
          yield { entry: row.entry };
        } else if (next.done !== true) {
          yield {
            entry: next.value.entry,
            nextEntry:
              next.value.nextEntry ??
              (await this.source.nextCuratedAfter(next.value.entry.label)) ??
              null,
          };
          next = await extra.next();
        }
      }
    } finally {
      await extra.return(undefined);
    }
  }

  unitEntryAt(index: number): Promise<IndexedUnit> {
    this.requireOpen();
    assertRowIndex(index, this.count);
    return this.locate(index);
  }

  hasPersistedMedia(): Promise<boolean> {
    return this.query(
      () => (this.snapshot.version?.aggregate.mediaContribRows ?? 0) > 0,
    );
  }

  nativeFacts(scope: string): Promise<NativeFactIndexReader> {
    this.requireOpen();
    if (this.rows.length !== 0)
      throw new JournalFormatError(
        'Native fact indexes require persisted request units without a tail overlay',
      );
    return this.snapshot.nativeFacts(scope);
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

  private captureMedia(
    plan: JournalResponsePlan,
    ordinal: number,
    block: ContentBlock,
  ): void {
    this.source.captureAdmission(plan.blocks[ordinal].at, block);
    if (
      this.mediaReferences === undefined ||
      !isMediaReferenceBlock(block) ||
      this.source.isTail(plan.blocks[ordinal].at.label)
    )
      return;
    Object.freeze(block.selectedObject);
    Object.freeze(block.originalObject);
    Object.freeze(block);
    this.mediaReferences.add(block);
  }

  async readAt(index: number, signal?: AbortSignal): Promise<IContent> {
    const plan = await this.planAt(index, signal);
    const blocks: IContent['blocks'] = [];
    for await (const block of plan.openBlocks()) {
      this.requireOpen();
      signal?.throwIfAborted();
      this.captureMedia(plan, blocks.length, block);
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
        this.captureMedia(plan, blocks.length, block);
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

  withHeld<T>(
    consume: (view: IndexedJournalRequestSnapshot) => T | Promise<T>,
    signal?: AbortSignal,
  ): Promise<T> {
    return this.query(() => consume(this), signal);
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

  async mistralForSnapshot(
    snapshot: VersionSnapshot,
    slot: number,
  ): Promise<Pick<JournalRequestMistral, 'resolve' | 'affectedSources'>> {
    const view = await this.query(() =>
      JournalRequestMistral.create(snapshot, this.source, this.rows, slot),
    );
    return {
      resolve: (rawId) => this.query(() => view.resolve(rawId)),
      affectedSources: () => this.mistralSources(view),
    };
  }

  private async *mistralSources(
    view: JournalRequestMistral,
  ): AsyncGenerator<bigint> {
    this.requireOpen();
    const release = this.snapshot.hold();
    try {
      for await (const label of view.affectedSources()) {
        this.requireOpen();
        yield label;
      }
    } finally {
      await release();
    }
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

  async mistralIdsAt(index: number): Promise<MistralUnitIds> {
    return mistralPlanIds(this.source, await this.planAt(index));
  }

  anthropicToolFactsAt(
    index: number,
    signal?: AbortSignal,
  ): Promise<readonly AnthropicToolOccurrenceFacts[]> {
    return this.query(
      async () =>
        anthropicToolFacts(
          this,
          this.source,
          (rawId) => this.snapshot.normalizedId(2, rawId),
          await this.planAt(index, signal),
          index,
        ),
      signal,
    );
  }

  withMistralSelection<T>(
    store: JournalStore,
    slot: number,
    indices: readonly number[],
    consume: (view: JournalMistralSelection) => T | Promise<T>,
    signal?: AbortSignal,
  ): Promise<T> {
    return this.query(async () => {
      await this.snapshot.requireMistralSlot(slot);
      const view = await JournalMistralSelection.create(
        this,
        store,
        await mistralRequestIdentity(this.snapshot, this.source),
        slot,
        indices,
      );
      try {
        return await consume(view);
      } finally {
        await view.close();
      }
    }, signal);
  }

  mistralMapping(
    rawId: string,
    slot: number,
  ): Promise<MistralMapping | undefined> {
    return this.withMistral(slot, (view) => view.mapping(rawId));
  }

  private async kimiCounter(
    view: JournalRequestKimi,
    index: number,
  ): Promise<number> {
    if (!Number.isSafeInteger(index) || index < 0 || index > this.count)
      throw new RangeError('Kimi counter unit is outside the request');
    return view.counterBefore(
      index === this.count ? undefined : await this.locate(index),
    );
  }

  kimiCounterBefore(index: number): Promise<number> {
    return this.withKimi((view) => this.kimiCounter(view, index));
  }

  /**
   * The Kimi ids of this request read from a filled pin. The request's own
   * pin may predate the Kimi fill, so the facts come from `snapshot`, which
   * the caller keeps pinned for as long as it reads them.
   */
  async kimiForSnapshot(snapshot: VersionSnapshot): Promise<{
    mappedId(rawId: string): Promise<string | undefined>;
    counterBefore(index: number): Promise<number>;
  }> {
    const view = await this.query(() =>
      JournalRequestKimi.create(snapshot, this.source, this.rows),
    );
    return {
      mappedId: (rawId) => this.query(() => view.mappedId(rawId)),
      counterBefore: (index) => this.query(() => this.kimiCounter(view, index)),
    };
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
