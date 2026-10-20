/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { MistralCandidate } from './mistralMapping.js';
import { JournalFormatError } from './errors.js';
import {
  decodeCountValue,
  decodeHashValue,
  decodeOccurrenceValue,
  decodeRelocationValue,
  decodeUnitPositionValue,
  type OccurrenceEntry,
  type UnitPosition,
} from './idEntryCodecs.js';
import { decodeIdFact, type IdFact } from './idFactCodec.js';
import { compareUnitPositions, type IdNormalizers } from './idFactUpdate.js';
import {
  ID_NS,
  fact0Key,
  kimiExceptionKey,
  mistralUsedKey,
  normalizedKey,
  occurrenceKey,
  relocationKey,
  type IdKeyHasher,
  type NormalizedFamily,
  type OccurrenceKind,
} from './idKeys.js';

/** What the queries read: one fact by its 128-bit hash. */
export interface IdEntryView {
  get(hash: Uint8Array): Promise<Uint8Array | undefined>;
}

/** The two seams of the id index: how keys are hashed, and the pure normalizers. */
export interface IdFactDeps {
  readonly hasher: IdKeyHasher;
  readonly normalizers: IdNormalizers;
  readonly occurrenceSpace: 'source' | 'normalized' | 'source-with-normalized';
  readonly mistralCandidate?: MistralCandidate;
}

/**
 * Reads of the id trie, whatever view they sit on: a committed root, or a
 * commit group's pending writes laid over one. Every method is a bounded
 * number of lookups, never a scan.
 */
export class IdFactQueries {
  /** Lookups issued, so a caller can state the cost of a query. */
  lookups = 0;

  constructor(
    private readonly view: IdEntryView,
    private readonly deps: IdFactDeps,
  ) {}

  private get(
    namespace: number,
    key: Uint8Array,
  ): Promise<Uint8Array | undefined> {
    this.lookups += 1;
    return this.view.get(this.deps.hasher(namespace, key));
  }

  /** The fact for a raw id (namespace 0), or undefined when the id has never occurred. */
  async fact(rawId: string): Promise<IdFact | undefined> {
    const bytes = await this.get(ID_NS.fact, fact0Key(rawId));
    return bytes === undefined ? undefined : decodeIdFact(bytes);
  }

  /** The `k`-th occurrence of a raw id and kind (namespace 4), `k` from 1. */
  async occurrence(
    rawId: string,
    kind: OccurrenceKind,
    ordinal: number,
  ): Promise<OccurrenceEntry | undefined> {
    const bytes = await this.get(
      ID_NS.occurrence,
      occurrenceKey(kind, ordinal, rawId),
    );
    return bytes === undefined ? undefined : decodeOccurrenceValue(bytes);
  }

  private requireNormalized(): void {
    if (this.deps.occurrenceSpace === 'source') {
      throw new JournalFormatError(
        'Normalized unit occurrences are not available',
      );
    }
  }

  /** The number of entries in the list of a normalized id (namespaces 1 and 2). */
  async normalizedCount(
    family: NormalizedFamily,
    kind: OccurrenceKind,
    normalizedId: string,
  ): Promise<number> {
    this.requireNormalized();
    const bytes = await this.get(family, normalizedKey(kind, 0, normalizedId));
    return bytes === undefined ? 0 : decodeCountValue(bytes);
  }

  /** The unit position of the `k`-th entry, `k` from 1. */
  async normalizedPosition(
    family: NormalizedFamily,
    kind: OccurrenceKind,
    normalizedId: string,
    ordinal: number,
  ): Promise<UnitPosition | undefined> {
    this.requireNormalized();
    const bytes = await this.get(
      family,
      normalizedKey(kind, ordinal, normalizedId),
    );
    return bytes === undefined ? undefined : decodeUnitPositionValue(bytes);
  }

  /** Does the list have an entry at or after `from`: the last entry answers it, in two lookups. */
  async lastAtOrAfter(
    family: NormalizedFamily,
    kind: OccurrenceKind,
    normalizedId: string,
    from: UnitPosition,
  ): Promise<boolean> {
    const count = await this.normalizedCount(family, kind, normalizedId);
    if (count === 0) return false;
    const last = await this.normalizedPosition(
      family,
      kind,
      normalizedId,
      count,
    );
    if (last === undefined) throw missingEntry(family, normalizedId, count);
    return compareUnitPositions(last, from) >= 0;
  }

  /**
   * The first entry strictly after `after` (Anthropic's `repairAdjacency`
   * successor query): a binary search over `k`, since positions grow with it.
   */
  async firstAfter(
    family: NormalizedFamily,
    kind: OccurrenceKind,
    normalizedId: string,
    after: UnitPosition,
  ): Promise<UnitPosition | undefined> {
    const count = await this.normalizedCount(family, kind, normalizedId);
    let low = 1;
    let high = count + 1;
    let found: UnitPosition | undefined;
    while (low < high) {
      const middle = (low + high) >> 1;
      const position = await this.normalizedPosition(
        family,
        kind,
        normalizedId,
        middle,
      );
      if (position === undefined)
        throw missingEntry(family, normalizedId, middle);
      if (compareUnitPositions(position, after) > 0) {
        found = position;
        high = middle;
      } else {
        low = middle + 1;
      }
    }
    return found;
  }

  /** The hash of the fact of the `k`-th Kimi exception id, `k` from 0 (namespace 5). */
  async exceptionHash(ordinal: number): Promise<Uint8Array | undefined> {
    const bytes = await this.get(
      ID_NS.kimiException,
      kimiExceptionKey(ordinal),
    );
    return bytes === undefined ? undefined : decodeHashValue(bytes);
  }

  /** The hash of the raw id that took `mappedId` in a format slot, or undefined when the mapped id is free (namespace 3). */
  async mistralUsedBy(
    slot: number,
    mappedId: string,
  ): Promise<Uint8Array | undefined> {
    const bytes = await this.get(
      ID_NS.mistralUsed,
      mistralUsedKey(slot, mappedId),
    );
    return bytes === undefined ? undefined : decodeHashValue(bytes);
  }

  /** Where compaction put the record that was at `oldOffset` (namespace 6). */
  async relocation(oldOffset: number): Promise<number | undefined> {
    const bytes = await this.get(ID_NS.relocation, relocationKey(oldOffset));
    return bytes === undefined ? undefined : decodeRelocationValue(bytes);
  }
}

function missingEntry(
  family: NormalizedFamily,
  normalizedId: string,
  ordinal: number,
): JournalFormatError {
  return new JournalFormatError(
    `Namespace ${family} list of ${JSON.stringify(normalizedId)} is missing entry ${ordinal} below its count`,
  );
}
