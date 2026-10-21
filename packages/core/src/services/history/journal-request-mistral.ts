/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { JournalFormatError } from '../../journal/errors.js';
import type { MistralMapping } from '../../journal/mistralMapping.js';
import { kimiRowCalls } from '../../journal/normalizedRowOccurrences.js';
import { plannedFromIds } from '../../journal/unitContributions.js';
import type { VersionSnapshot } from '../../journal/versionSnapshot.js';
import type { IndexedOverlayRow } from './journal-indexed-overlay.js';
import type { JournalTailSource } from './journal-tail-source.js';
import { planSourceRowOccurrences } from './source-fact-planner.js';

export class JournalRequestMistral {
  private readonly pending = new Map<string, MistralMapping>();
  private empty: MistralMapping | undefined;

  private constructor(
    private readonly snapshot: VersionSnapshot,
    private readonly source: JournalTailSource,
    private readonly slot: number,
  ) {}

  static async create(
    snapshot: VersionSnapshot,
    source: JournalTailSource,
    rows: readonly IndexedOverlayRow[],
    slot: number,
  ): Promise<JournalRequestMistral> {
    await snapshot.requireMistralSlot(slot);
    const view = new JournalRequestMistral(snapshot, source, slot);
    for (const row of rows) await view.observe(row);
    return view;
  }

  private async observe(row: IndexedOverlayRow): Promise<void> {
    const planned = plannedFromIds(await this.source.readIds(row.entry));
    const emitted = await kimiRowCalls(
      planned,
      row.entry,
      await planSourceRowOccurrences(planned, this.snapshot.facts),
      this.source.facts,
    );
    const calls = [...emitted.ids].flatMap(([rawId, id]) =>
      id.calls.map((call) => ({ rawId, call })),
    );
    calls.sort((left, right) => {
      const part = left.call.position.part - right.call.position.part;
      if (part !== 0) return part;
      const unit = left.call.position.unit - right.call.position.unit;
      return unit !== 0 ? unit : left.call.block - right.call.block;
    });
    for (const { rawId } of calls) {
      if (
        rawId === '' ||
        !this.source.hasPendingId(rawId) ||
        (await this.mapping(rawId)) !== undefined
      )
        continue;
      if (!this.source.isTail(row.entry.label))
        throw new JournalFormatError(
          'Earlier Mistral call needs a mapping refill',
        );
      this.pending.set(rawId, await this.assign(rawId));
    }
  }

  private async used(id: string): Promise<boolean> {
    if (this.empty?.id === id) return true;
    for (const mapping of this.pending.values())
      if (mapping.id === id) return true;
    return (
      (await this.snapshot.facts.mistralUsedBy(this.slot, id)) !== undefined
    );
  }

  private async assign(rawId: string): Promise<MistralMapping> {
    if (/^[a-zA-Z0-9]{9}$/.test(rawId)) return { id: rawId, salt: null };
    let salt = 0;
    let id = this.snapshot.mistralCandidate(rawId, salt);
    while (await this.used(id)) {
      salt++;
      if (!Number.isSafeInteger(salt + 1))
        throw new JournalFormatError('Mistral salt exhausted');
      id = this.snapshot.mistralCandidate(rawId, salt);
    }
    return { id, salt };
  }

  async resolve(rawId: string): Promise<MistralMapping> {
    const observed = await this.mapping(rawId);
    if (observed !== undefined) return observed;
    if (rawId !== '')
      throw new JournalFormatError(
        'Unobserved Mistral id requires selected conversion facts',
      );
    this.empty ??= await this.assign(rawId);
    return this.empty;
  }

  async mapping(rawId: string): Promise<MistralMapping | undefined> {
    this.snapshot.requireOpen();
    return (
      this.pending.get(rawId) ?? this.snapshot.mistralMapping(rawId, this.slot)
    );
  }
}
