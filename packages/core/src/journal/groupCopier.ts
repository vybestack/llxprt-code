/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import {
  readTranscriptNode,
  type TranscriptTreeMode,
  type TranscriptNode,
} from './transcript-tree.js';
import { copyTranscriptValue } from './transcript-transfer.js';
import { isNeutralRowFact } from './neutral-row-fact-codec.js';
import { JournalFormatError } from './errors.js';
import { frameLength, type FrameHead } from './frame.js';
import type { GroupRecord, VectoredRecordAppender } from './groupAppender.js';
import {
  decodeIdFact,
  encodeIdFact,
  ID_FACT_MIN_BYTES,
} from './idFactCodec.js';
import type { IdNodeCache } from './idTrieCache.js';
import {
  encodeIdTrieNode,
  type IdEntry,
  type IdTrieNode,
} from './idTrieNode.js';
import { IdTrieReader } from './idTrieReader.js';
import { decodeMapRef, encodeMapRef } from './keyedMap.js';
import { OFFSET, type PointsAt } from './offsetFields.js';
import type { RecordAccess } from './recordAccess.js';
import {
  appendSourceRecord,
  isWholeRecord,
  readSourceHead,
  remapOffset,
  type CopyStats,
} from './recordTransfer.js';
import type { RelocationIndex } from './relocationIndex.js';
import type { RowEntry } from './rowEntry.js';
import { readRowTreeNode } from './rowTreeReader.js';
import {
  encodeRowTreeNode,
  type ChildSlot,
  type RowTreeNode,
} from './rowTreeNode.js';
import { TOOL_RANK_NODE_BYTES } from './tool-ranking-tree.js';

/** What a copy of one version shares with the copies of the others. */
export interface CopyShared {
  readonly source: RecordAccess;
  readonly relocation: RelocationIndex;
  readonly stats: CopyStats;
  /** The source's id trie, meta map and state map nodes share one capped cache. */
  readonly sourceCache: IdNodeCache;
  /** A node an earlier version wrote to the new file, read back from it. */
  readonly readCopiedNode: (offset: number) => Promise<IdTrieNode>;
  readonly copiedAccess: (end: number) => RecordAccess;
}

/**
 * Copies the records of one version into the group being written. A record
 * that an earlier version already put in the new file is found in the
 * relocation index and not read again, and a node that is found is not
 * descended into, because everything below it was copied with it. Children
 * are written before their parent, so the parent's fields can name the new
 * offsets.
 */
export class GroupCopier {
  private readonly ids: IdTrieReader;
  private lastRow: { readonly old: number; readonly next: number } | undefined;

  constructor(
    private readonly shared: CopyShared,
    readonly appender: VectoredRecordAppender,
    /** Whether a later version may look the records of this one up. */
    private readonly recording: boolean,
  ) {
    this.ids = new IdTrieReader(shared.source, shared.sourceCache);
  }

  get source(): RecordAccess {
    return this.shared.source;
  }

  /** Whether a later version may look the records of this one up. */
  get records(): boolean {
    return this.recording;
  }

  /** The node a version of an earlier group wrote to the new file, read back from it. */
  readCopiedNode(offset: number): Promise<IdTrieNode> {
    return this.shared.readCopiedNode(offset);
  }

  async readCopiedTranscript(
    offset: number,
    mode: TranscriptTreeMode,
  ): Promise<TranscriptNode> {
    await this.appender.drain();
    return readTranscriptNode(
      this.shared.copiedAccess(this.appender.nextOffset),
      offset,
      mode,
    );
  }

  /** Looks `oldOffset` up in the index; a hit is counted. */
  async known(oldOffset: number): Promise<number | undefined> {
    const next = await this.shared.relocation.lookup(oldOffset);
    if (next !== undefined) this.shared.stats.memoHits += 1;
    return next;
  }

  /** Appends a record the copier built, and counts it as `kind`. */
  async append(record: GroupRecord, kind: PointsAt): Promise<number> {
    const offset = await this.appender.append(record);
    this.shared.stats.copied[kind] += 1;
    this.shared.stats.bytes += frameLength(
      record.kindHeader.length,
      record.body?.length ?? 0,
    );
    return offset;
  }

  async remember(oldOffset: number, newOffset: number): Promise<void> {
    this.shared.relocation.attach(this.appender);
    await this.shared.relocation.record(oldOffset, newOffset);
  }

  /** The record at `oldOffset` (a `ROW`, `LENS` or `VALUE`), copied unless an earlier version did. */
  async copyRecord(
    oldOffset: number,
    points: PointsAt,
    knownHead?: FrameHead,
  ): Promise<number> {
    if (!isWholeRecord(points)) {
      throw new JournalFormatError(`${points} records are not copied whole`);
    }
    const earlier = await this.known(oldOffset);
    if (earlier !== undefined) return earlier;
    const head =
      knownHead ?? (await readSourceHead(this.source, oldOffset, points));
    if (points === 'VALUE') {
      const transcript = await copyTranscriptValue(this, oldOffset, head);
      if (transcript !== undefined) return transcript;
    }
    const written = await appendSourceRecord(
      this.source,
      this.appender,
      head,
      points,
    );
    this.shared.stats.copied[points] += 1;
    this.shared.stats.bytes += written.bytes;
    if (points === 'ROW')
      this.lastRow = { old: oldOffset, next: written.offset };
    await this.remember(oldOffset, written.offset);
    return written.offset;
  }

  /** The new offset of the last live row: the last one this copy wrote, or one an earlier version wrote. */
  async resolveLastRow(oldOffset: number): Promise<number> {
    if (this.lastRow?.old === oldOffset) return this.lastRow.next;
    const earlier = await this.shared.relocation.lookup(oldOffset);
    if (earlier === undefined) {
      throw new JournalFormatError(
        `The last row, at offset ${oldOffset}, was not copied`,
      );
    }
    return earlier;
  }

  /** The new trailer of a retained version, which must already be in the new file. */
  async retainedTrailer(oldOffset: number): Promise<number> {
    const earlier = await this.shared.relocation.lookup(oldOffset);
    if (earlier === undefined) {
      throw new JournalFormatError(
        `The checkpoint trailer at offset ${oldOffset} was not copied`,
      );
    }
    return earlier;
  }

  /** The row tree below `oldOffset`. */
  async copyRowNode(oldOffset: number): Promise<number> {
    const earlier = await this.known(oldOffset);
    if (earlier !== undefined) return earlier;
    const node = await readRowTreeNode(this.source, oldOffset);
    const copy =
      node.kind === 'leaf'
        ? await this.copyLeaf(node.entries)
        : await this.copySlots(node.level, node.slots);
    const offset = await this.append(encodeRowTreeNode(copy), 'RTNODE');
    await this.remember(oldOffset, offset);
    return offset;
  }

  private async copySlots(
    level: number,
    slots: readonly ChildSlot[],
  ): Promise<RowTreeNode> {
    const copied: ChildSlot[] = [];
    for (const slot of slots) {
      const childOffset = await remapOffset(
        OFFSET.rowTreeChild,
        slot.childOffset,
        (old) => this.copyRowNode(old),
      );
      copied.push({ ...slot, childOffset });
    }
    return { kind: 'internal', level, slots: copied };
  }

  private async copyLeaf(entries: readonly RowEntry[]): Promise<RowTreeNode> {
    const copied: RowEntry[] = [];
    for (const entry of entries) {
      const recordOffset = await remapOffset(
        OFFSET.rowTreeRecord,
        entry.recordOffset,
        (old) => this.copyRecord(old, OFFSET.rowTreeRecord.points),
      );
      const lens: number[] = [];
      for (const ref of entry.lensRef) {
        lens.push(
          await remapOffset(OFFSET.rowTreeLens, ref, (old) =>
            this.copyRecord(old, OFFSET.rowTreeLens.points),
          ),
        );
      }
      copied.push({
        ...entry,
        recordOffset,
        lensRef: [lens[0], lens[1], lens[2]],
      });
    }
    return { kind: 'leaf', entries: copied };
  }

  /**
   * The trie below `oldOffset`, with `remapValue` applied to every leaf value.
   * The id trie and the meta map are the same node kind, and they differ only
   * in what their values hold.
   */
  async copyIdNode(
    oldOffset: number,
    remapValue: (value: Uint8Array) => Promise<Uint8Array>,
  ): Promise<number> {
    const earlier = await this.known(oldOffset);
    if (earlier !== undefined) return earlier;
    // Retained versions share paths at scattered offsets, even during a full copy.
    const node = await this.ids.readNode(oldOffset, undefined, false);
    const copy: IdTrieNode =
      node.kind === 'leaf'
        ? await this.copyFacts(node.entries, remapValue)
        : await this.copyChildren(node.bitmap, node.children, remapValue);
    const offset = await this.append(encodeIdTrieNode(copy), 'ITNODE');
    await this.remember(oldOffset, offset);
    return offset;
  }

  private async copyFacts(
    entries: readonly IdEntry[],
    remapValue: (value: Uint8Array) => Promise<Uint8Array>,
  ): Promise<IdTrieNode> {
    const copied: IdEntry[] = [];
    for (const entry of entries) {
      copied.push({ hash: entry.hash, value: await remapValue(entry.value) });
    }
    return { kind: 'leaf', entries: copied };
  }

  private async copyChildren(
    bitmap: number,
    children: readonly number[],
    remapValue: (value: Uint8Array) => Promise<Uint8Array>,
  ): Promise<IdTrieNode> {
    const copied: number[] = [];
    for (const child of children) {
      copied.push(
        await remapOffset(OFFSET.idTrieChild, child, (old) =>
          this.copyIdNode(old, remapValue),
        ),
      );
    }
    return { kind: 'internal', bitmap, children: copied };
  }

  /**
   * A value of the id trie. Only an `IdFact` holds an offset, `mappedRef`; the
   * trie does not say which namespace a value is in. Other values are shorter
   * than the smallest fact, except the distinct-width ranking node.
   */
  readonly factValue = async (value: Uint8Array): Promise<Uint8Array> => {
    if (isNeutralRowFact(value)) return value;
    if (
      value.length < ID_FACT_MIN_BYTES ||
      value.length === TOOL_RANK_NODE_BYTES
    )
      return value;
    const fact = decodeIdFact(value);
    if (fact.mappedRef === 0) return value;
    const mappedRef = await remapOffset(
      OFFSET.idFactMapped,
      fact.mappedRef,
      (old) => this.copyRecord(old, OFFSET.idFactMapped.points),
    );
    return encodeIdFact({ ...fact, mappedRef });
  };

  /** A value of the meta map: the offset of its `VALUE` record. */
  readonly metaValue = async (value: Uint8Array): Promise<Uint8Array> => {
    const ref = await remapOffset(
      OFFSET.metaValue,
      decodeMapRef(value),
      (old) => this.copyRecord(old, OFFSET.metaValue.points),
    );
    return encodeMapRef(ref);
  };
}
