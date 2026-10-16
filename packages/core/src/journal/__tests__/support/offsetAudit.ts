/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { expect } from 'bun:test';
import { parseCheckpointDescriptor } from '../../checkpointDescriptor.js';
import { decodeIdFact, ID_FACT_MIN_BYTES } from '../../idFactCodec.js';
import { BoundedIdNodeCache } from '../../idTrieCache.js';
import { IdTrieReader } from '../../idTrieReader.js';
import { decodeMapRef } from '../../keyedMap.js';
import { readMapEntries, readValueBody } from '../../mapEntries.js';
import {
  OFFSET,
  OFFSET_FIELDS,
  type OffsetField,
  type PointsAt,
} from '../../offsetFields.js';
import type { RecordAccess } from '../../recordAccess.js';
import { RECORD_KIND } from '../../recordKinds.js';
import { readRowTreeNode } from '../../rowTreeReader.js';
import { readVersionAt } from '../../trailerAccess.js';
import type { Version } from '../../version.js';

const KIND_OF: Record<PointsAt, number> = {
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

  async walkVersion(version: Version): Promise<void> {
    const { roots } = version;
    await this.check(
      OFFSET.trailerSelf,
      version.selfOffset,
      version.durableEnd,
    );
    expect(version.parent).toBe(0);
    expect(version.skip).toStrictEqual([0, 0, 0]);
    expect(version.lineageDepth).toBe(0);
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
    } else if (values === 'state') {
      await this.check(OFFSET.stateValue, decodeMapRef(value), node);
    } else if (value.length >= ID_FACT_MIN_BYTES) {
      const fact = decodeIdFact(value);
      if (fact.mappedRef !== 0) {
        await this.check(OFFSET.idFactMapped, fact.mappedRef, node);
      }
    }
  }

  /** Every checkpoint the state map names points at a trailer that reads as a version of this file. */
  private async walkCheckpoints(version: Version): Promise<void> {
    for await (const entry of readMapEntries(
      this.access,
      new BoundedIdNodeCache(),
      version.roots.stateRoot,
    )) {
      if (!entry.key.startsWith('ckpt:')) continue;
      const descriptor = parseCheckpointDescriptor(
        await readValueBody(this.access, entry.head),
      );
      await this.check(
        OFFSET.checkpointTrailer,
        descriptor.trailerOffset,
        version.selfOffset,
      );
      const saved = await readVersionAt(this.access, descriptor.trailerOffset);
      expect(saved.commitSeq).toBe(descriptor.commitSeq);
    }
  }
}
