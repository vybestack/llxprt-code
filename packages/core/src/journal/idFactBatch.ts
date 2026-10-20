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
import { BoundedIdNodeCache } from './idTrieCache.js';
import { mergeIdTrie } from './idTrieMerge.js';
import { compareIdHashes, type IdEntry } from './idTrieNode.js';
import { IdTrieReader } from './idTrieReader.js';
import { replaceNormalizedRow } from './normalizedListEdit.js';
import type { RecordAccess } from './recordAccess.js';

const FAMILIES: readonly NormalizedFamily[] = [ID_NS.openai, ID_NS.anthropic];

function pendingKey(hash: Uint8Array): string {
  return Buffer.from(hash).toString('hex');
}

/**
 * What the pending writes of a batch may charge before they are merged into
 * the trie: 64 KiB. It bounds the heap one rebuild holds for id facts, so it
 * sits well inside the 1 MiB memory proof bound together with the group
 * appender's 256 KiB batch and the node caches.
 */
export const ID_BATCH_CAP_BYTES = 64 * 1024;
/**
 * What one pending write costs beyond its hash and value: the two typed
 * arrays, the entry object, the hex key and the map slot. Measured at about
 * 500 bytes per write on a 24-byte payload (3.5 KB per id, seven writes per
 * id), so the cap counts the heap and not just the payload.
 */
export const ID_BATCH_ENTRY_OVERHEAD_BYTES = 480;

function chargeOf(entry: IdEntry): number {
  return entry.hash.length + entry.value.length + ID_BATCH_ENTRY_OVERHEAD_BYTES;
}

/** Reads of a file the current group has partly written. */
export type ReadGroup = (writtenEnd: number) => RecordAccess;

/**
 * Where a rebuild group lets a batch merge its writes before `commit`: into
 * the group's own trie, through the group's appender.
 */
export interface SpillOptions {
  /** Reads back nodes the group has appended, up to `writtenEnd`. */
  readonly readGroup: ReadGroup;
  /** Pending writes that charge more than this are merged. */
  readonly capBytes?: number;
}

export interface BatchSpill extends SpillOptions {
  readonly appender: RecordAppender;
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
 * later block of the group sees an earlier one. A batch without a `spill`
 * writes nothing until `commit`, which merges the writes in one path-copying
 * pass and so writes each node on a changed path once. A batch with one merges
 * the writes into the group's trie whenever they charge more than the cap, so
 * a rebuild holds one chunk of facts and not the facts of its whole history;
 * the nodes a later chunk supersedes stay in the file as garbage for
 * compaction.
 */
export class IdFactBatch {
  private readonly pending = new Map<string, IdEntry>();
  private pendingBytes = 0;
  private exceptions: number;
  /** The trie the pending writes lie over: the committed one until a chunk is merged. */
  private workingRoot: number;
  private workingReader: IdTrieReader | undefined;
  private readonly readback = new BoundedIdNodeCache();
  /** Reads through the pending writes. */
  readonly queries: IdFactQueries;

  constructor(
    reader: IdTrieReader | undefined,
    root: number,
    private readonly deps: IdFactDeps,
    exceptionCount: number,
    private readonly spill?: BatchSpill,
  ) {
    if (root !== 0 && reader === undefined) {
      throw new JournalFormatError(
        'A batch over an existing trie needs a reader',
      );
    }
    this.exceptions = exceptionCount;
    this.workingRoot = root;
    this.workingReader = reader;
    const committed: IdEntryView = {
      get: (hash) =>
        this.workingReader === undefined
          ? Promise.resolve(undefined)
          : this.workingReader.lookup(this.workingRoot, hash),
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
    const entry = { hash, value };
    const id = pendingKey(hash);
    const replaced = this.pending.get(id);
    if (replaced !== undefined) this.pendingBytes -= chargeOf(replaced);
    this.pending.set(id, entry);
    this.pendingBytes += chargeOf(entry);
  }

  /**
   * Merges the pending writes into the group's trie once they charge more than
   * the cap. It runs between the blocks of a group and not inside `put`, so a
   * block's writes are never split across chunks and `put` stays synchronous.
   */
  private async spillWhenFull(): Promise<void> {
    const { spill } = this;
    if (spill === undefined) return;
    if (this.pendingBytes <= (spill.capBytes ?? ID_BATCH_CAP_BYTES)) return;
    await this.flush(spill);
  }

  private async flush(spill: BatchSpill): Promise<void> {
    const { appender } = spill;
    this.workingRoot = await mergeIdTrie(
      appender,
      this.workingReader,
      this.workingRoot,
      this.sortedUpdates(),
    );
    // The nodes just appended are read by the next lookup and the next merge.
    await appender.drain();
    this.workingReader = new IdTrieReader(
      spill.readGroup(appender.nextOffset),
      this.readback,
    );
    this.pending.clear();
    this.pendingBytes = 0;
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
      if (
        this.deps.occurrenceSpace !== 'normalized' ||
        !entersNormalizedList(occ, family)
      )
        continue;
      const nid = normalizedIdOf(this.deps.normalizers, family, occ.rawId);
      await this.appendToList(family, kind, nid, occ.unit.position);
    }
    const wasException =
      before !== undefined && isKimiException(occ.rawId, before);
    if (
      this.deps.occurrenceSpace === 'normalized' &&
      !wasException &&
      isKimiException(occ.rawId, after)
    ) {
      this.addException(occ.rawId);
    }
    await this.spillWhenFull();
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

  async replaceNormalizedRow(
    family: NormalizedFamily,
    kind: OccurrenceKind,
    id: string,
    label: bigint,
    positions: readonly UnitPosition[],
    spill: BatchSpill,
  ): Promise<void> {
    await replaceNormalizedRow(
      this.queries,
      { family, kind, id, label, positions },
      {
        freeze: async () => {
          await this.flush(spill);
          const reader = this.workingReader;
          const root = this.workingRoot;
          return new IdFactQueries(
            {
              get: (hash) =>
                reader === undefined
                  ? Promise.resolve(undefined)
                  : reader.lookup(root, hash),
            },
            this.deps,
          );
        },
        position: async (ordinal, at) => {
          this.put(
            family,
            normalizedKey(kind, ordinal, id),
            encodeUnitPositionValue(at),
          );
          if (this.pendingBytes > (spill.capBytes ?? ID_BATCH_CAP_BYTES))
            await this.flush(spill);
        },
        count: (count) =>
          this.put(family, normalizedKey(kind, 0, id), encodeCountValue(count)),
      },
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
    await this.spillWhenFull();
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

  /** Merges the writes still pending into the trie as part of the current group. */
  async commit(appender: RecordAppender): Promise<FactCommit> {
    const root = await mergeIdTrie(
      appender,
      this.workingReader,
      this.workingRoot,
      this.sortedUpdates(),
    );
    return { root, exceptionCount: this.exceptions };
  }
}

/**
 * The trie of a whole history built from nothing, for a rebuild: the update
 * rule is applied to every block in position order, so the facts are the ones
 * an incremental append of the same blocks gives. With `spill` the facts are
 * merged into the trie in chunks as they accumulate, so a history of any
 * length holds one chunk; without it they all wait for a single bulk build.
 */
export async function bulkBuildFacts(
  appender: RecordAppender,
  occurrences: Iterable<IdOccurrence>,
  deps: IdFactDeps,
  spill?: SpillOptions,
): Promise<FactCommit> {
  const batch = new IdFactBatch(
    undefined,
    0,
    deps,
    0,
    spill === undefined ? undefined : { ...spill, appender },
  );
  for (const occ of occurrences) await batch.apply(occ);
  return batch.commit(appender);
}
