/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { decodeRowHeader } from '../../rowRecord.js';
import { decodeChunkBlock } from '../../chunk-row.js';
import { expect } from 'bun:test';
import { readValueBody } from '../../mapEntries.js';
import {
  decodeTranscriptHead,
  decodeMembership,
  TRANSCRIPT_HEAD_KEY,
} from '../../transcript-head.js';
import {
  readTranscriptNode,
  type TranscriptTreeMode,
} from '../../transcript-tree.js';
import { listCheckpoints } from '../../checkpointList.js';
import { decodeIdFact, ID_FACT_MIN_BYTES } from '../../idFactCodec.js';
import { BoundedIdNodeCache } from '../../idTrieCache.js';
import { IdTrieReader } from '../../idTrieReader.js';
import { decodeMapRef } from '../../keyedMap.js';
import { isNeutralRowFact } from '../../neutral-row-fact-codec.js';
import {
  OFFSET,
  OFFSET_FIELDS,
  type OffsetField,
  type PointsAt,
} from '../../offsetFields.js';
import type { RecordAccess } from '../../recordAccess.js';
import { RECORD_KIND } from '../../recordKinds.js';
import { readRowTreeNode } from '../../rowTreeReader.js';
import { TOOL_RANK_NODE_BYTES } from '../../tool-ranking-tree.js';
import { readVersionAt } from '../../trailerAccess.js';
import type { Version } from '../../version.js';

const KIND_OF: Record<PointsAt, number> = {
  PIECE: RECORD_KIND.PIECE,
  TNODE: RECORD_KIND.TNODE,
  ROW: RECORD_KIND.ROW,
  RTNODE: RECORD_KIND.RTNODE,
  ITNODE: RECORD_KIND.ITNODE,
  LENS: RECORD_KIND.LENS,
  VALUE: RECORD_KIND.VALUE,
  TRAILER: RECORD_KIND.TRAILER,
};

type TrieValues = 'facts' | 'meta' | 'state';

/**
 * Walks a file that holds copied versions and checks every field of
 * `OFFSET_FIELDS` that it meets: it points at the start of a record of the
 * kind the table names, and that record was written earlier in the same file.
 * It reads only the file it is given, so the source can be gone.
 */
export class OffsetAudit {
  /** How many references of each table entry were checked. */
  readonly checked = new Map<OffsetField, number>();
  private readonly visited = new Set<number>();
  private readonly trie: IdTrieReader;

  constructor(private readonly access: RecordAccess) {
    this.trie = new IdTrieReader(access, new BoundedIdNodeCache());
  }

  /** The table entries the walk never met. */
  unmet(): OffsetField[] {
    return OFFSET_FIELDS.filter((entry) => !this.checked.has(entry));
  }

  async check(
    spec: OffsetField,
    target: number,
    referrer: number,
  ): Promise<void> {
    expect(OFFSET_FIELDS).toContain(spec);
    this.checked.set(spec, (this.checked.get(spec) ?? 0) + 1);
    const head = await this.access.readRecordHead(target, spec.points);
    expect({ field: spec.field, kind: head.kind }).toStrictEqual({
      field: spec.field,
      kind: KIND_OF[spec.points],
    });
    expect(target).toBeLessThan(referrer);
  }

  async walkVersion(version: Version, copied = true): Promise<void> {
    const { roots } = version;
    await this.check(
      OFFSET.trailerSelf,
      version.selfOffset,
      version.durableEnd,
    );
    if (copied) {
      expect(version.parent).toBe(0);
      expect(version.skip).toStrictEqual([0, 0, 0]);
      expect(version.lineageDepth).toBe(0);
    } else {
      await this.walkAncestors(version);
    }
    if (roots.rowRoot !== 0) {
      await this.check(
        OFFSET.trailerRowRoot,
        roots.rowRoot,
        version.selfOffset,
      );
      await this.walkRowNode(roots.rowRoot);
    }
    if (roots.idRoot !== 0) {
      await this.check(OFFSET.trailerIdRoot, roots.idRoot, version.selfOffset);
      await this.walkTrie(roots.idRoot, 'facts', version);
    }
    if (roots.metaRoot !== 0) {
      await this.check(
        OFFSET.trailerMetaRoot,
        roots.metaRoot,
        version.selfOffset,
      );
      await this.walkTrie(roots.metaRoot, 'meta', version);
    }
    if (roots.stateRoot !== 0) {
      await this.check(
        OFFSET.trailerStateRoot,
        roots.stateRoot,
        version.selfOffset,
      );
      await this.walkTrie(roots.stateRoot, 'state', version);
      await this.walkCheckpoints(version);
    }
    if (version.lastRowOffset !== 0) {
      await this.check(
        OFFSET.trailerLastRow,
        version.lastRowOffset,
        version.selfOffset,
      );
    }
  }

  private async walkAncestors(version: Version): Promise<void> {
    for (const offset of version.skip) {
      if (offset !== 0)
        await this.check(OFFSET.trailerSkip, offset, version.selfOffset);
    }
    if (version.parent !== 0) {
      await this.check(
        OFFSET.trailerParent,
        version.parent,
        version.selfOffset,
      );
      if (!this.visited.has(version.parent)) {
        this.visited.add(version.parent);
        await this.walkVersion(
          await readVersionAt(this.access, version.parent),
          false,
        );
      }
    }
  }

  private async walkRowNode(offset: number): Promise<void> {
    if (this.visited.has(offset)) return;
    this.visited.add(offset);
    const node = await readRowTreeNode(this.access, offset);
    if (node.kind === 'internal') {
      for (const slot of node.slots) {
        await this.check(OFFSET.rowTreeChild, slot.childOffset, offset);
        await this.walkRowNode(slot.childOffset);
      }
      return;
    }
    for (const entry of node.entries) {
      await this.check(OFFSET.rowTreeRecord, entry.recordOffset, offset);
      await this.walkChunkRow(entry.recordOffset);
      for (const ref of entry.lensRef) {
        if (ref !== 0) await this.check(OFFSET.rowTreeLens, ref, offset);
      }
    }
  }

  private async walkTrie(
    offset: number,
    values: TrieValues,
    version: Version,
  ): Promise<void> {
    if (this.visited.has(offset)) return;
    this.visited.add(offset);
    const node = await this.trie.readNode(offset);
    if (node.kind === 'internal') {
      for (const child of node.children) {
        await this.check(OFFSET.idTrieChild, child, offset);
        await this.walkTrie(child, values, version);
      }
      return;
    }
    for (const entry of node.entries) {
      await this.checkValue(entry.value, values, offset);
    }
  }

  private async checkValue(
    value: Uint8Array,
    values: TrieValues,
    node: number,
  ): Promise<void> {
    if (values === 'meta') {
      await this.check(OFFSET.metaValue, decodeMapRef(value), node);
      await this.walkTranscriptValue(decodeMapRef(value));
    } else if (values === 'state') {
      await this.check(OFFSET.stateValue, decodeMapRef(value), node);
      await this.walkTranscriptValue(decodeMapRef(value));
    } else if (
      !isNeutralRowFact(value) &&
      value.length >= ID_FACT_MIN_BYTES &&
      value.length !== TOOL_RANK_NODE_BYTES
    ) {
      const fact = decodeIdFact(value);
      if (fact.mappedRef !== 0) {
        await this.check(OFFSET.idFactMapped, fact.mappedRef, node);
      }
    }
  }

  private async walkTranscriptValue(offset: number): Promise<void> {
    const head = await this.access.readRecordHead(offset, 'VALUE');
    const key = new TextDecoder().decode(head.kindHeader);
    if (key === TRANSCRIPT_HEAD_KEY) {
      const value = decodeTranscriptHead(
        await readValueBody(this.access, head),
      );
      if (value.root !== 0) {
        await this.check(OFFSET.transcriptRoot, value.root, offset);
        await this.walkTranscript(value.root, 'transcript');
      }
      if (value.openRoot !== 0) {
        await this.check(OFFSET.transcriptOpen, value.openRoot, offset);
        await this.walkTranscript(value.openRoot, 'open');
      }
    } else if (key === 'recording:block') {
      const block = decodeChunkBlock(await readValueBody(this.access, head));
      if (block.piecesRoot !== 0) {
        await this.check(OFFSET.blockPieces, block.piecesRoot, offset);
        await this.walkTranscript(
          block.piecesRoot,
          block.named === true ? 'blocks' : 'pieces',
        );
      }
    } else if (key.startsWith('member:')) {
      const value = decodeMembership(await readValueBody(this.access, head));
      if (value.rowRef !== 0)
        await this.check(OFFSET.membershipRow, value.rowRef, offset);
      if (value.occurrencesRoot !== 0) {
        await this.check(OFFSET.membershipRoot, value.occurrencesRoot, offset);
        await this.walkTranscript(value.occurrencesRoot, 'membership');
      }
    }
  }

  private async walkTranscript(
    offset: number,
    mode: TranscriptTreeMode,
  ): Promise<void> {
    if (this.visited.has(offset)) return;
    this.visited.add(offset);
    const node = await readTranscriptNode(this.access, offset, mode);
    for (const child of node.children) {
      await this.check(OFFSET.transcriptChild, child.ref, offset);
      await this.walkTranscript(child.ref, mode);
    }
    for (const entry of node.entries) {
      if (entry.rowRef !== 0) {
        let spec: OffsetField = OFFSET.transcriptRow;
        if (mode === 'pieces') spec = OFFSET.pieceRecord;
        else if (mode === 'blocks') spec = OFFSET.blockDescriptor;
        await this.check(spec, entry.rowRef, offset);
        if (mode === 'blocks') await this.walkTranscriptValue(entry.rowRef);
        else if (mode !== 'pieces') await this.walkChunkRow(entry.rowRef);
      }
      if (entry.attemptRef !== 0)
        await this.check(OFFSET.transcriptAttempt, entry.attemptRef, offset);
      if (entry.presentationRef !== 0)
        await this.check(
          OFFSET.transcriptPresentation,
          entry.presentationRef,
          offset,
        );
    }
  }

  private async walkChunkRow(ref: number): Promise<void> {
    const head = await this.access.readRecordHead(ref, 'ROW');
    const row = decodeRowHeader(head.kindHeader);
    if (row.chunk === undefined) return;
    await this.check(OFFSET.chunkMeta, row.chunk.metaRef, ref);
    if (row.chunk.blocksRoot !== 0) {
      await this.check(OFFSET.chunkBlocks, row.chunk.blocksRoot, ref);
      await this.walkTranscript(row.chunk.blocksRoot, 'blocks');
    }
  }

  /** Every checkpoint the state map names points at a trailer that reads as a version of this file. */
  private async walkCheckpoints(version: Version): Promise<void> {
    for await (const { descriptor } of listCheckpoints(
      this.access,
      new BoundedIdNodeCache(),
      version.roots.stateRoot,
    )) {
      await this.check(
        OFFSET.checkpointTrailer,
        descriptor.trailerOffset,
        version.selfOffset,
      );
      const saved = await readVersionAt(this.access, descriptor.trailerOffset);
      expect(saved.commitSeq).toBe(descriptor.commitSeq);
      if (!this.visited.has(saved.selfOffset)) {
        this.visited.add(saved.selfOffset);
        await this.walkVersion(saved, false);
      }
    }
  }
}
