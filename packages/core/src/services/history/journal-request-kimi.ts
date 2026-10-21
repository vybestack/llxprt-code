/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { JournalFormatError } from '../../journal/errors.js';
import { KIMI_FLAG, type KimiOccurrence } from '../../journal/kimiFactCodec.js';
import { kimiOccurrenceName } from '../../journal/kimiFactQueries.js';
import { kimiSafeCount } from '../../journal/kimiDigits.js';
import type { IndexedUnit } from '../../journal/rowTreeQueries.js';
import { kimiRowCalls } from '../../journal/normalizedRowOccurrences.js';
import { plannedFromIds } from '../../journal/unitContributions.js';
import type { VersionSnapshot } from '../../journal/versionSnapshot.js';
import type { IndexedOverlayRow } from './journal-indexed-overlay.js';
import type { JournalTailSource } from './journal-tail-source.js';
import { planSourceRowOccurrences } from './source-fact-planner.js';

export class JournalRequestKimi {
  private readonly last = new Map<string, KimiOccurrence>();
  private readonly corrections: Array<{
    readonly label: bigint;
    readonly delta: number;
    readonly unmappedDelta: number;
  }> = [];
  private count = 0;

  private constructor(
    private readonly snapshot: VersionSnapshot,
    private readonly source: JournalTailSource,
  ) {}

  static async create(
    snapshot: VersionSnapshot,
    source: JournalTailSource,
    rows: readonly IndexedOverlayRow[],
  ): Promise<JournalRequestKimi> {
    const view = new JournalRequestKimi(snapshot, source);
    view.count = await snapshot.kimiEligibleCount();
    for (const row of rows) await view.addRow(row);
    return view;
  }

  private async addRow(row: IndexedOverlayRow): Promise<void> {
    const planned = plannedFromIds(await this.source.readIds(row.entry));
    const emitted = await kimiRowCalls(
      planned,
      row.entry,
      await planSourceRowOccurrences(planned, this.snapshot.facts),
      this.source.facts,
    );
    const delta = emitted.eligibleCalls - row.entry.callBlocks;
    this.corrections.push({
      label: row.entry.label,
      delta,
      unmappedDelta: emitted.unmapped.length - row.entry.unmappedBlocks,
    });
    this.count = kimiSafeCount(this.count + delta);
    for (const [id, list] of emitted.ids)
      for (const call of list.calls)
        if ((call.flags & KIMI_FLAG.eligible) !== 0) this.last.set(id, call);
  }

  eligibleCount(): number {
    this.snapshot.requireOpen();
    return this.count;
  }

  async counterBefore(selected?: IndexedUnit): Promise<number> {
    this.snapshot.requireOpen();
    const label = selected?.entry.label;
    let consumed =
      label === undefined
        ? await this.snapshot.kimiUnmappedCount()
        : await this.snapshot.kimiUnmappedBelow(label);
    for (const row of this.corrections)
      if (label === undefined || row.label < label)
        consumed += row.unmappedDelta;
    for (const id of this.last.keys()) {
      const native = await this.snapshot.kimiIdFact(id);
      if (native === undefined || native.unmappedUses === 0) continue;
      for await (const holder of this.snapshot.kimiHolders(id)) {
        if (
          (holder.flags & KIMI_FLAG.unmapped) === 0 ||
          this.corrections.some((row) => row.label === holder.position.label)
        )
          continue;
        if (label === undefined || holder.position.label < label) consumed--;
      }
    }
    if (selected !== undefined) {
      const planned = plannedFromIds(await this.source.readIds(selected.entry));
      const emitted = await kimiRowCalls(
        planned,
        selected.entry,
        await planSourceRowOccurrences(planned, this.snapshot.facts),
        this.source.facts,
      );
      consumed += emitted.unmapped.filter(
        (use) => use.occurrence.position.unit < selected.unit,
      ).length;
    }
    return kimiSafeCount(this.count + kimiSafeCount(consumed));
  }

  private async occurrence(rawId: string): Promise<KimiOccurrence | undefined> {
    this.snapshot.requireOpen();
    const native = (await this.snapshot.kimiIdFact(rawId))?.last;
    const overlay = this.last.get(rawId);
    if (native === undefined) return overlay;
    if (
      overlay !== undefined &&
      overlay.position.label >= native.position.label
    )
      return overlay;
    if (this.corrections.some((row) => row.label === native.position.label))
      throw new JournalFormatError(
        'Pending input removed an earlier eligible Kimi call',
      );
    return native;
  }

  private async ordinalOf(last: KimiOccurrence): Promise<number> {
    let ordinal = await this.snapshot.kimiEligibleBelow(last.position.label);
    for (const row of this.corrections) {
      if (row.label >= last.position.label) break;
      ordinal += row.delta;
    }
    return ordinal + last.eligibleWithinRow;
  }

  async ordinal(rawId: string): Promise<number | undefined> {
    const last = await this.occurrence(rawId);
    return last === undefined ? undefined : this.ordinalOf(last);
  }

  async name(rawId: string): Promise<string | undefined> {
    const last = await this.occurrence(rawId);
    return last === undefined
      ? undefined
      : kimiOccurrenceName(this.source, last);
  }

  async mappedId(rawId: string): Promise<string | undefined> {
    const last = await this.occurrence(rawId);
    if (last === undefined) return undefined;
    return `functions.${await kimiOccurrenceName(this.source, last)}:${await this.ordinalOf(last)}`;
  }
}
