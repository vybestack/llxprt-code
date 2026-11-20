/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { JournalFormatError } from '../../journal/errors.js';
import type { UnitPosition } from '../../journal/idEntryCodecs.js';
import type { NormalizedFamily, OccurrenceKind } from '../../journal/idKeys.js';
import { normalizedRowLists } from '../../journal/normalizedRowOccurrences.js';
import type { RowEntry } from '../../journal/rowEntry.js';
import { plannedFromIds } from '../../journal/unitContributions.js';
import type { VersionSnapshot } from '../../journal/versionSnapshot.js';
import type { PendingRequestOverlay } from './journal-indexed-overlay.js';
import type { JournalTailSource } from './journal-tail-source.js';
import { planSourceRowOccurrences } from './source-fact-planner.js';

export interface RequestUnitRange {
  readonly from: number;
  readonly to: number;
}

type Segment =
  | {
      readonly kind: 'persisted';
      readonly first: number;
      readonly count: number;
    }
  | {
      readonly kind: 'overlay';
      readonly positions: readonly number[];
      readonly count: number;
    };

function unitOffset(entry: RowEntry, at: UnitPosition): number {
  return at.unit + (at.part === 0 ? 0 : 1 + Number(entry.answered > 0));
}

export class JournalRequestOccurrences {
  private readonly segments: Segment[] = [];
  private total = 0;
  private lower = 0;
  private upper = 0;

  private constructor(
    private readonly snapshot: VersionSnapshot,
    private readonly rows: PendingRequestOverlay,
    private readonly family: NormalizedFamily,
    private readonly kind: OccurrenceKind,
    private readonly id: string,
  ) {}

  static async create(
    snapshot: VersionSnapshot,
    source: JournalTailSource,
    rows: PendingRequestOverlay,
    family: NormalizedFamily,
    kind: OccurrenceKind,
    id: string,
    count: number,
    range: RequestUnitRange = { from: 0, to: count },
  ): Promise<JournalRequestOccurrences> {
    if (!Number.isInteger(range.from) || !Number.isInteger(range.to))
      throw new RangeError(
        'Normalized occurrence range must use integer unit indices',
      );
    if (range.from < 0 || range.to < range.from || range.to > count)
      throw new RangeError(
        'Normalized occurrence range is outside the request',
      );
    const view = new JournalRequestOccurrences(
      snapshot,
      rows,
      family,
      kind,
      id,
    );
    const persisted = await snapshot.facts.normalizedCount(family, kind, id);
    let next = 1;
    for (const row of rows) {
      const begin = await view.labelBound(persisted, row.entry.label);
      const end = await view.labelBound(persisted, row.entry.label + 1n);
      view.add({ kind: 'persisted', first: next, count: begin - next });
      const planned = plannedFromIds(await source.readIds(row.entry));
      const lists = await normalizedRowLists(
        planned,
        row.entry,
        await planSourceRowOccurrences(planned, snapshot.facts),
        source.facts,
        (ns, raw) => snapshot.normalizedId(ns, raw),
      );
      const list = lists.find(
        (value) =>
          value.family === family && value.kind === kind && value.id === id,
      );
      const positions =
        list?.positions.map((at) => row.start + unitOffset(row.entry, at)) ??
        [];
      view.add({ kind: 'overlay', positions, count: positions.length });
      next = end;
    }
    view.add({ kind: 'persisted', first: next, count: persisted + 1 - next });
    view.lower = range.from === 0 ? 0 : await view.indexBound(range.from);
    view.upper =
      range.to === count ? view.total : await view.indexBound(range.to);
    return view;
  }

  private add(segment: Segment): void {
    if (segment.count === 0) return;
    this.segments.push(segment);
    this.total += segment.count;
  }

  private async persisted(ordinal: number): Promise<UnitPosition> {
    const at = await this.snapshot.facts.normalizedPosition(
      this.family,
      this.kind,
      this.id,
      ordinal,
    );
    if (at === undefined)
      throw new JournalFormatError('Counted normalized occurrence is absent');
    return at;
  }

  private async labelBound(count: number, label: bigint): Promise<number> {
    let low = 1;
    let high = count + 1;
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      if ((await this.persisted(middle)).label < label) low = middle + 1;
      else high = middle;
    }
    return low;
  }

  private async coordinate(at: UnitPosition): Promise<number> {
    let delta = 0;
    for (const row of this.rows) {
      if (row.entry.label === at.label)
        return row.start + unitOffset(row.entry, at);
      if (row.entry.label > at.label) break;
      delta += row.count - row.oldCount;
    }
    const entry = await this.snapshot.entryByLabel(at.label);
    if (entry === undefined)
      throw new JournalFormatError('Normalized occurrence row is absent');
    return (
      (await this.snapshot.unitsBelow(at.label)) + delta + unitOffset(entry, at)
    );
  }

  private async select(index: number): Promise<number> {
    for (const segment of this.segments) {
      if (index < segment.count)
        return segment.kind === 'overlay'
          ? segment.positions[index]
          : this.coordinate(await this.persisted(segment.first + index));
      index -= segment.count;
    }
    throw new JournalFormatError(
      'Normalized occurrence selection exceeds its count',
    );
  }

  private async indexBound(index: number): Promise<number> {
    if (this.rows.length === 0) {
      if (index === 0) return 0;
      if (index >= this.snapshot.units) return this.total;
      const target = await this.snapshot.unitAt(index);
      let low = 0;
      let high = this.total;
      while (low < high) {
        const middle = Math.floor((low + high) / 2);
        const at = await this.persisted(middle + 1);
        if (
          at.label < target.entry.label ||
          (at.label === target.entry.label &&
            unitOffset(target.entry, at) < target.unit)
        )
          low = middle + 1;
        else high = middle;
      }
      return low;
    }
    let low = 0;
    let high = this.total;
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      if ((await this.select(middle)) < index) low = middle + 1;
      else high = middle;
    }
    return low;
  }

  get count(): number {
    this.snapshot.requireOpen();
    return this.upper - this.lower;
  }

  async position(ordinal: number): Promise<number | undefined> {
    this.snapshot.requireOpen();
    if (!Number.isInteger(ordinal) || ordinal < 1)
      throw new RangeError('Occurrence ordinal must be positive');
    return ordinal > this.count
      ? undefined
      : this.select(this.lower + ordinal - 1);
  }

  async countBefore(index: number): Promise<number> {
    this.snapshot.requireOpen();
    if (!Number.isInteger(index) || index < 0)
      throw new RangeError('Occurrence prefix requires a nonnegative integer');
    return Math.max(
      0,
      Math.min(this.upper, await this.indexBound(index)) - this.lower,
    );
  }

  async firstAfter(after: number): Promise<number | undefined> {
    this.snapshot.requireOpen();
    const index = Math.max(this.lower, await this.indexBound(after + 1));
    return index >= this.upper ? undefined : this.select(index);
  }

  async lastAtOrAfter(from: number): Promise<boolean> {
    const last = await this.position(this.count === 0 ? 1 : this.count);
    return last !== undefined && last >= from;
  }
}
