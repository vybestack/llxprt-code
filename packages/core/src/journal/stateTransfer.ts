/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import {
  CHECKPOINT_KEY_PREFIX,
  MIRROR_KEY_PREFIX,
  RELEASE_KEY_PREFIX,
  encodeCheckpointDescriptor,
  parseCheckpointEntry,
} from './checkpointDescriptor.js';
import type { GroupCopier } from './groupCopier.js';
import type { IdNodeCache } from './idTrieCache.js';
import {
  ID_TRIE_FANOUT,
  ID_TRIE_LEAF_CAPACITY,
  encodeIdTrieNode,
  type IdEntry,
} from './idTrieNode.js';
import { IdTrieReader } from './idTrieReader.js';
import { encodeMapRef } from './keyedMap.js';
import { readMapEntry, readValueBody, type MapEntry } from './mapEntries.js';
import { OFFSET } from './offsetFields.js';
import { remapOffset } from './recordTransfer.js';
import { RECORD_KIND } from './recordKinds.js';

/**
 * Which state entries a copy carries.
 * - `portable`: a clone, and a retained checkpoint version. The owner
 *   dictionary, start metadata, title, name and fork metadata go along. The
 *   checkpoints, the mirror link and the release queue belong to the file the
 *   version lives in and do not.
 * - `retained`: the current version of a compaction. It keeps its checkpoints,
 *   each pointing at the new trailer of its version, and its mirror link; the
 *   release queue is empty when compaction runs (design 4.11).
 */
export type StatePolicy = 'portable' | 'retained';

export interface CopiedState {
  readonly root: number;
  /** The `liveBytes` of the checkpoints the state keeps. */
  readonly ckptBytes: number;
}

type Treatment = 'copy' | 'checkpoint' | 'drop';

function treatmentOf(key: string, policy: StatePolicy): Treatment {
  if (key.startsWith(RELEASE_KEY_PREFIX)) return 'drop';
  if (key.startsWith(CHECKPOINT_KEY_PREFIX)) {
    return policy === 'retained' ? 'checkpoint' : 'drop';
  }
  if (key.startsWith(MIRROR_KEY_PREFIX)) {
    return policy === 'retained' ? 'copy' : 'drop';
  }
  return 'copy';
}

/**
 * The checkpoint's descriptor with its trailer offset taken from the copy of
 * the version it names, written as a new `VALUE` under the same key. A
 * deleted checkpoint's entry is dropped (design 4.11 step 4): undefined.
 */
async function rewriteCheckpoint(
  copier: GroupCopier,
  entry: MapEntry,
  liveBytes: { total: number },
): Promise<number | undefined> {
  const descriptor = parseCheckpointEntry(
    await readValueBody(copier.source, entry.head),
  );
  if (descriptor === undefined) return undefined;
  const trailerOffset = await remapOffset(
    OFFSET.checkpointTrailer,
    descriptor.trailerOffset,
    (old) => copier.retainedTrailer(old),
  );
  liveBytes.total += descriptor.liveBytes;
  const body = encodeCheckpointDescriptor({ ...descriptor, trailerOffset });
  return copier.append(
    {
      kind: RECORD_KIND.VALUE,
      kindHeader: entry.head.kindHeader,
      body: { length: body.length, chunks: [body] },
    },
    'VALUE',
  );
}

/**
 * What copying a subtree of the source state map leaves in the new one. The
 * shape of a trie is a function of its key set (a subtree of 8 or fewer keys
 * is a leaf, a larger one an internal node), and dropping keys changes the
 * key set, so a parent cannot be built until its children are known.
 */
type Piece =
  | { readonly kind: 'empty' }
  /** One to eight entries, not yet a node; `offset` is a leaf already written with exactly these. */
  | {
      readonly kind: 'few';
      readonly entries: readonly IdEntry[];
      readonly offset?: number;
    }
  /** More than eight entries, in an internal node that is written. */
  | { readonly kind: 'node'; readonly offset: number };

const EMPTY: Piece = { kind: 'empty' };

/**
 * Copies a state map node by node (design 4.8, several versions). A portable
 * copy is a function of the source subtree alone, so the copy of each
 * internal node is recorded in the relocation index, and a version that
 * reaches the same source node again reuses it without reading below it.
 * Versions of one session share all but the nodes on the paths of the entries
 * that changed, so a version costs its changed paths and not the whole map. A
 * node whose keys were all dropped is recorded as offset 0. A retained copy
 * differs by policy, so it never reads or writes these records.
 */
class StateMapWalk {
  readonly liveBytes = { total: 0 };
  private readonly trie: IdTrieReader;
  private readonly memoizes: boolean;

  constructor(
    private readonly copier: GroupCopier,
    private readonly policy: StatePolicy,
    cache: IdNodeCache,
  ) {
    this.trie = new IdTrieReader(copier.source, cache);
    this.memoizes = policy === 'portable';
  }

  async copyRoot(root: number): Promise<number> {
    if (root === 0) return 0;
    return this.offsetOf(await this.copyNode(root));
  }

  private async copyNode(oldOffset: number): Promise<Piece> {
    if (this.memoizes) {
      const earlier = await this.copier.known(oldOffset);
      if (earlier !== undefined) return this.pieceAt(earlier);
    }
    const node = await this.trie.readNode(oldOffset);
    if (node.kind === 'leaf') return this.copyLeaf(node.entries);
    const pieces: Piece[] = [];
    for (const child of node.children) pieces.push(await this.copyNode(child));
    return this.remember(oldOffset, await this.combine(node.bitmap, pieces));
  }

  /** What an earlier version wrote for a node: nothing, a leaf, or an internal node. */
  private async pieceAt(offset: number): Promise<Piece> {
    if (offset === 0) return EMPTY;
    const node = await this.copier.readCopiedNode(offset);
    if (node.kind === 'internal') return { kind: 'node', offset };
    return {
      kind: 'few',
      offset,
      entries: node.entries.map((entry) => ({
        hash: entry.hash.slice(),
        value: entry.value.slice(),
      })),
    };
  }

  /** The new `VALUE` of an entry, or undefined when the copy leaves the entry out. */
  private copiedValue(
    entry: MapEntry,
    treatment: Treatment,
  ): Promise<number | undefined> {
    if (treatment === 'drop') return Promise.resolve(undefined);
    if (treatment === 'checkpoint') {
      return rewriteCheckpoint(this.copier, entry, this.liveBytes);
    }
    return remapOffset(OFFSET.stateValue, entry.valueOffset, (old) =>
      this.copier.copyRecord(old, OFFSET.stateValue.points, entry.head),
    );
  }

  private async copyLeaf(entries: readonly IdEntry[]): Promise<Piece> {
    const kept: IdEntry[] = [];
    for (const fact of entries) {
      const entry = await readMapEntry(this.copier.source, fact);
      const valueOffset = await this.copiedValue(
        entry,
        treatmentOf(entry.key, this.policy),
      );
      if (valueOffset !== undefined) {
        kept.push({
          hash: entry.hash.slice(),
          value: encodeMapRef(valueOffset),
        });
      }
    }
    return kept.length === 0 ? EMPTY : { kind: 'few', entries: kept };
  }

  /** The node for the children of an internal node of the source, with the empty ones left out. */
  private async combine(
    bitmap: number,
    pieces: readonly Piece[],
  ): Promise<Piece> {
    const nibbles: number[] = [];
    for (let nibble = 0; nibble < ID_TRIE_FANOUT; nibble++) {
      if ((bitmap & (1 << nibble)) !== 0) nibbles.push(nibble);
    }
    let kept = 0;
    const present: Piece[] = [];
    pieces.forEach((piece, slot) => {
      if (piece.kind === 'empty') return;
      kept |= 1 << nibbles[slot];
      present.push(piece);
    });
    if (present.length === 0) return EMPTY;
    const entries = present.flatMap((piece) =>
      piece.kind === 'few' ? piece.entries : [],
    );
    const allFew = present.every((piece) => piece.kind === 'few');
    if (allFew && entries.length <= ID_TRIE_LEAF_CAPACITY) {
      return { kind: 'few', entries };
    }
    const children: number[] = [];
    for (const piece of present) children.push(await this.offsetOf(piece));
    const offset = await this.copier.append(
      encodeIdTrieNode({ kind: 'internal', bitmap: kept, children }),
      'ITNODE',
    );
    return { kind: 'node', offset };
  }

  /** The offset of the node for a piece, writing the leaf of a few entries that no node holds yet. */
  private async offsetOf(piece: Piece): Promise<number> {
    if (piece.kind === 'empty') return 0;
    if (piece.kind === 'node') return piece.offset;
    return piece.offset ?? this.writeLeaf(piece.entries);
  }

  private writeLeaf(entries: readonly IdEntry[]): Promise<number> {
    return this.copier.append(
      encodeIdTrieNode({ kind: 'leaf', entries }),
      'ITNODE',
    );
  }

  /**
   * Notes the copy of an internal source node for the versions after it. A
   * small result is written as a leaf for that, which stays behind as garbage
   * if the parent holds the entries itself.
   */
  private async remember(oldOffset: number, piece: Piece): Promise<Piece> {
    if (!this.memoizes || !this.copier.records) return piece;
    const stored =
      piece.kind === 'few' && piece.offset === undefined
        ? { ...piece, offset: await this.writeLeaf(piece.entries) }
        : piece;
    await this.copier.remember(oldOffset, await this.offsetOf(stored));
    return stored;
  }
}

/**
 * Builds the state map of a copied version from the state map of the source
 * version: the keys keep their hashes, so the result is the trie of the
 * surviving keys, in the shape a build from those keys gives. Memory is the
 * path of nodes being copied and their entries.
 */
export async function copyStateMap(
  copier: GroupCopier,
  stateRoot: number,
  policy: StatePolicy,
  cache: IdNodeCache,
): Promise<CopiedState> {
  const walk = new StateMapWalk(copier, policy, cache);
  const root = await walk.copyRoot(stateRoot);
  return { root, ckptBytes: walk.liveBytes.total };
}
