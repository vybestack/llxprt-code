/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { RecordAppender } from './groupAppender.js';
import { JournalFormatError } from './errors.js';
import {
  encodeCountValue,
  encodeHashValue,
  encodeOccurrenceValue,
  encodeRelocationValue,
  encodeUnitPositionValue,
  type UnitPosition,
} from './idEntryCodecs.js';
import { EMPTY_ID_FACT, encodeIdFact } from './idFactCodec.js';
import {
  entersNormalizedList,
  isKimiException,
  normalizedIdOf,
  occurrenceEntryOf,
  updateFact,
  type IdOccurrence,
} from './idFactUpdate.js';
import {
  IdFactQueries,
  type IdEntryView,
  type IdFactDeps,
} from './idFactQueries.js';
import {
  ID_NS,
  fact0Key,
  kimiExceptionKey,
  mistralUsedKey,
  normalizedKey,
  OCCURRENCE_KIND,
  occurrenceKey,
  relocationKey,
  type NormalizedFamily,
  type OccurrenceKind,
} from './idKeys.js';
import { bulkBuildIdTrie, mergeIdTrie } from './idTrieMerge.js';
import { compareIdHashes, type IdEntry } from './idTrieNode.js';
import type { IdTrieReader } from './idTrieReader.js';

const FAMILIES: readonly NormalizedFamily[] = [ID_NS.openai, ID_NS.anthropic];

function pendingKey(hash: Uint8Array): string {
  return Buffer.from(hash).toString('hex');
}

/** What a commit group leaves behind for the trailer and the meta map. */
export interface FactCommit {
  readonly root: number;
  /** The length of the Kimi exception list, the versioned meta key `kimi:exc`. */
  readonly exceptionCount: number;
}

/**
 * The id trie as one commit group sees it: the committed trie at `root` with
 * this group's writes laid over it. Every read goes through the overlay, so a
 * later block of the group sees an earlier one; nothing reaches the file until
 * `commit`, which merges the writes in one path-copying pass and so writes each
 * node on a changed path once.
 */
export class IdFactBatch {
  private readonly pending = new Map<string, IdEntry>();
  private exceptions: number;
  /** Reads through the pending writes. */
  readonly queries: IdFactQueries;

  constructor(
    private readonly reader: IdTrieReader | undefined,
    private readonly root: number,
    private readonly deps: IdFactDeps,
    exceptionCount: number,
  ) {
    if (root !== 0 && reader === undefined) {
      throw new JournalFormatError(
        'A batch over an existing trie needs a reader',
      );
    }
    this.exceptions = exceptionCount;
    const committed: IdEntryView = {
      get: (hash) =>
        reader === undefined
          ? Promise.resolve(undefined)
          : reader.lookup(root, hash),
    };
    this.queries = new IdFactQueries(
      {
        get: (hash) => {
          const written = this.pending.get(pendingKey(hash));
          return written === undefined
            ? committed.get(hash)
            : Promise.resolve(written.value);
        },
      },
      deps,
    );
  }

  get exceptionCount(): number {
    return this.exceptions;
  }

  get pendingCount(): number {
    return this.pending.size;
  }

  private put(namespace: number, key: Uint8Array, value: Uint8Array): void {
    const hash = this.deps.hasher(namespace, key);
    this.pending.set(pendingKey(hash), { hash, value });
  }

  /**
   * Applies the update rule of design 3.3 to one block: the fact of the raw id,
   * the next entry of its occurrence chain, the lists of the normalized ids,
   * and the Kimi exception list when the id has just stopped being clean.
   */
  async apply(occ: IdOccurrence): Promise<void> {
    const before = await this.queries.fact(occ.rawId);
    const after = updateFact(before ?? EMPTY_ID_FACT, occ);
    this.put(ID_NS.fact, fact0Key(occ.rawId), encodeIdFact(after));
    const kind = occ.kind;
    const ordinal =
      kind === OCCURRENCE_KIND.call ? after.callCount : after.respCount;
    this.put(
      ID_NS.occurrence,
      occurrenceKey(kind, ordinal, occ.rawId),
      encodeOccurrenceValue(occurrenceEntryOf(occ)),
    );
    for (const family of FAMILIES) {
      if (!entersNormalizedList(occ, family)) continue;
      const nid = normalizedIdOf(this.deps.normalizers, family, occ.rawId);
      await this.appendToList(family, kind, nid, occ.unit.position);
    }
    const wasException =
      before !== undefined && isKimiException(occ.rawId, before);
    if (!wasException && isKimiException(occ.rawId, after)) {
      this.addException(occ.rawId);
    }
  }

  private async appendToList(
    family: NormalizedFamily,
    kind: OccurrenceKind,
    normalizedId: string,
    position: UnitPosition,
  ): Promise<void> {
    const count = await this.queries.normalizedCount(
      family,
      kind,
      normalizedId,
    );
    this.put(
      family,
      normalizedKey(kind, count + 1, normalizedId),
      encodeUnitPositionValue(position),
    );
    this.put(
      family,
      normalizedKey(kind, 0, normalizedId),
      encodeCountValue(count + 1),
    );
  }

  private addException(rawId: string): void {
    const factHash = this.deps.hasher(ID_NS.fact, fact0Key(rawId));
    this.put(
      ID_NS.kimiException,
      kimiExceptionKey(this.exceptions),
      encodeHashValue(factHash),
    );
    this.exceptions += 1;
  }

  /** Namespace 3: `mappedId` is taken in `slot` by the raw id (Mistral). */
  markMistralUsed(slot: number, mappedId: string, rawId: string): void {
    this.put(
      ID_NS.mistralUsed,
      mistralUsedKey(slot, mappedId),
      encodeHashValue(this.deps.hasher(ID_NS.fact, fact0Key(rawId))),
    );
  }

  /** Points the fact of `rawId` at the `VALUE` record that holds its mapped ids. */
  async setMappedRef(rawId: string, valueOffset: number): Promise<void> {
    const fact = await this.queries.fact(rawId);
    if (fact === undefined) {
      throw new JournalFormatError(
        `Id ${JSON.stringify(rawId)} has no fact to hold a mapped reference`,
      );
    }
    this.put(
      ID_NS.fact,
      fact0Key(rawId),
      encodeIdFact({ ...fact, mappedRef: valueOffset }),
    );
  }

  /** Namespace 6: the record at `oldOffset` in the file being replaced is at `newOffset` here. */
  recordRelocation(oldOffset: number, newOffset: number): void {
    this.put(
      ID_NS.relocation,
      relocationKey(oldOffset),
      encodeRelocationValue(newOffset),
    );
  }

  /** The pending writes in ascending hash order, which is the order a bulk build takes. */
  sortedUpdates(): IdEntry[] {
    return [...this.pending.values()].sort((left, right) =>
      compareIdHashes(left.hash, right.hash),
    );
  }

  /** Merges the group's writes into the trie as part of the current group. */
  async commit(appender: RecordAppender): Promise<FactCommit> {
    const root = await mergeIdTrie(
      appender,
      this.reader,
      this.root,
      this.sortedUpdates(),
    );
    return { root, exceptionCount: this.exceptions };
  }
}

/**
 * The trie of a whole history built from nothing, for a rebuild: the update
 * rule is applied to every block in position order, so the facts are the ones
 * an incremental append of the same blocks gives, and the sorted facts go to
 * the bulk builder. The facts of one history wait in memory here; a rebuild of
 * a history too large for that feeds `bulkBuildIdTrie` from an external sort
 * of the same entries.
 */
export async function bulkBuildFacts(
  appender: RecordAppender,
  occurrences: Iterable<IdOccurrence>,
  deps: IdFactDeps,
): Promise<FactCommit> {
  const batch = new IdFactBatch(undefined, 0, deps, 0);
  for (const occ of occurrences) await batch.apply(occ);
  const root = await bulkBuildIdTrie(appender, batch.sortedUpdates());
  return { root, exceptionCount: batch.exceptionCount };
}
