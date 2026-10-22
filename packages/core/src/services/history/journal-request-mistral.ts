/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { JournalFormatError } from '../../journal/errors.js';
import type { MistralMapping } from '../../journal/mistralMapping.js';
import {
  compareMistralClaims,
  readMistralClaim,
  type MistralClaim,
} from '../../journal/mistralClaims.js';
import { kimiRowCalls } from '../../journal/normalizedRowOccurrences.js';
import { plannedFromIds } from '../../journal/unitContributions.js';
import type { VersionSnapshot } from '../../journal/versionSnapshot.js';
import type { IndexedOverlayRow } from './journal-indexed-overlay.js';
import type { JournalTailSource } from './journal-tail-source.js';
import { planSourceRowOccurrences } from './source-fact-planner.js';
import { callTarget } from './journal-reconstruction.js';

const CACHE_BYTES = 64 * 1024;
const passthrough = (rawId: string): boolean => /^[a-zA-Z0-9]{9}$/.test(rawId);

export class JournalRequestMistral {
  private readonly seeds = new Map<string, MistralClaim>();
  private readonly cache = new Map<string, MistralMapping>();
  private cacheBytes = 0;
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
    for (const [rawId, id] of emitted.ids) {
      if (rawId === '' || !this.source.hasPendingId(rawId)) continue;
      for (const call of id.calls) {
        const claim = { rawId, position: call.position, block: call.block };
        const previous =
          this.seeds.get(rawId) ??
          (await readMistralClaim(this.snapshot, 'raw', this.slot, rawId));
        if (previous === undefined || compareMistralClaims(claim, previous) < 0)
          this.seeds.set(rawId, claim);
      }
    }
  }

  private async owner(id: string): Promise<MistralClaim | undefined> {
    const hashed = await readMistralClaim(
      this.snapshot,
      'hashed',
      this.slot,
      id,
    );
    const direct = await readMistralClaim(this.snapshot, 'raw', this.slot, id);
    const left =
      hashed === undefined || this.seeds.has(hashed.rawId) ? undefined : hashed;
    const right =
      direct === undefined || this.seeds.has(direct.rawId) ? undefined : direct;
    if (left === undefined) return right;
    if (right === undefined) return left;
    return compareMistralClaims(left, right) < 0 ? left : right;
  }

  /** Each insertion has one displacement frontier and at most one newly occupied terminal ID. */
  private async *repairs(
    terminal: Set<string>,
  ): AsyncGenerator<{ rawId: string; mapping: MistralMapping }> {
    const queue = new Map(this.seeds);
    while (queue.size !== 0) {
      let current: MistralClaim | undefined;
      for (const claim of queue.values())
        if (current === undefined || compareMistralClaims(claim, current) < 0)
          current = claim;
      if (current === undefined)
        throw new JournalFormatError('Missing Mistral repair frontier');
      queue.delete(current.rawId);
      yield {
        rawId: current.rawId,
        mapping: await this.repairClaim(current, queue, terminal),
      };
    }
  }

  private async repairClaim(
    current: MistralClaim,
    queue: Map<string, MistralClaim>,
    terminal: Set<string>,
  ): Promise<MistralMapping> {
    let salt = 0;
    for (;;) {
      const id = passthrough(current.rawId)
        ? current.rawId
        : this.snapshot.mistralCandidate(current.rawId, salt);
      const owner = await this.owner(id);
      const earlier =
        owner !== undefined &&
        (queue.has(owner.rawId) || compareMistralClaims(owner, current) <= 0);
      if (passthrough(current.rawId) || (!terminal.has(id) && !earlier)) {
        if (
          owner !== undefined &&
          !earlier &&
          owner.rawId !== current.rawId &&
          !passthrough(owner.rawId)
        )
          queue.set(owner.rawId, owner);
        else terminal.add(id);
        return { id, salt: passthrough(current.rawId) ? null : salt };
      }
      salt++;
      if (!Number.isSafeInteger(salt + 1))
        throw new JournalFormatError('Mistral salt exhausted');
    }
  }

  private async *changedIds(): AsyncGenerator<string> {
    for await (const repaired of this.repairs(new Set<string>())) {
      const previous = await this.snapshot.mistralMapping(
        repaired.rawId,
        this.slot,
      );
      if (previous !== undefined && previous.id !== repaired.mapping.id)
        yield repaired.rawId;
    }
    const empty = await this.snapshot.facts.fact('');
    if (empty === undefined) return;
    const base = new JournalRequestMistral(
      this.snapshot,
      this.source,
      this.slot,
    );
    if ((await base.resolve('')).id !== (await this.resolve('')).id) yield '';
  }

  private async nextSource(
    rawId: string,
    after: bigint,
  ): Promise<bigint | undefined> {
    const fact = await this.snapshot.facts.fact(rawId);
    if (fact === undefined) return undefined;
    const target = callTarget(fact);
    const targetLabel =
      rawId !== '' || target?.reconstructed === true
        ? target?.at.label
        : undefined;
    const result =
      targetLabel !== undefined && targetLabel > after
        ? targetLabel
        : undefined;
    let low = 1;
    let high = fact.callCount + 1;
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      const occurrence = await this.snapshot.facts.occurrence(rawId, 0, middle);
      if (occurrence === undefined)
        throw new JournalFormatError('Missing Mistral holder occurrence');
      if (occurrence.at.label <= after) low = middle + 1;
      else high = middle;
    }
    for (let ordinal = low; ordinal <= fact.callCount; ordinal++) {
      const occurrence = await this.snapshot.facts.occurrence(
        rawId,
        0,
        ordinal,
      );
      if (occurrence === undefined)
        throw new JournalFormatError('Missing Mistral holder occurrence');
      if (result !== undefined && occurrence.at.label >= result) return result;
      if (occurrence.ai) return occurrence.at.label;
    }
    return result;
  }

  async *affectedSources(): AsyncGenerator<bigint> {
    if (this.seeds.size === 0) return;
    let after = 0n;
    for (;;) {
      let next: bigint | undefined;
      for await (const rawId of this.changedIds()) {
        const label = await this.nextSource(rawId, after);
        if (label !== undefined && (next === undefined || label < next))
          next = label;
      }
      if (next === undefined) return;
      yield next;
      after = next;
    }
  }

  private remember(rawId: string, mapping: MistralMapping): void {
    const bytes = Buffer.byteLength(rawId) * 2 + 256;
    if (bytes > CACHE_BYTES) return;
    if (this.cacheBytes + bytes > CACHE_BYTES) {
      this.cache.clear();
      this.cacheBytes = 0;
    }
    this.cache.set(rawId, mapping);
    this.cacheBytes += bytes;
  }

  async resolve(rawId: string): Promise<MistralMapping> {
    const observed = await this.mapping(rawId);
    if (observed !== undefined) return observed;
    if (rawId !== '')
      throw new JournalFormatError(
        'Unobserved Mistral id requires selected conversion facts',
      );
    if (this.empty !== undefined) return this.empty;
    const terminal = new Set<string>();
    for await (const _repair of this.repairs(terminal)) {
      /* Consume the bounded displacement frontiers. */
    }
    let salt = 0;
    let id = this.snapshot.mistralCandidate('', salt);
    while (
      terminal.has(id) ||
      (this.seeds.size === 0
        ? (await this.snapshot.facts.mistralUsedBy(this.slot, id)) !== undefined
        : (await this.owner(id)) !== undefined)
    )
      id = this.snapshot.mistralCandidate('', ++salt);
    this.empty = { id, salt };
    return this.empty;
  }

  async mapping(rawId: string): Promise<MistralMapping | undefined> {
    this.snapshot.requireOpen();
    const cached = this.cache.get(rawId);
    if (cached !== undefined) return cached;
    if (this.seeds.size !== 0) {
      for await (const repaired of this.repairs(new Set<string>())) {
        if (repaired.rawId === rawId) {
          this.remember(rawId, repaired.mapping);
          return repaired.mapping;
        }
      }
    }
    return this.snapshot.mistralMapping(rawId, this.slot);
  }
}
