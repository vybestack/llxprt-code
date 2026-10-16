/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import {
  encodeCheckpointDescriptor,
  parseCheckpointDescriptor,
} from './checkpointDescriptor.js';
import {
  decodeOccurrenceValue,
  decodeUnitPositionValue,
  encodeOccurrenceValue,
  encodeUnitPositionValue,
} from './idEntryCodecs.js';
import { decodeIdFact, encodeIdFact } from './idFactCodec.js';
import { decodeIdTrieNode, encodeIdTrieNode } from './idTrieNode.js';
import {
  OFFSET_FIELDS,
  RECORD_FIELDS,
  auditFieldTables,
  type FieldDecl,
  type OffsetField,
  type OffsetRule,
  type PointsAt,
} from './offsetFields.js';
import { decodeRowHeader, encodeRowHeader } from './rowRecord.js';
import { decodeRowTreeNode, encodeRowTreeNode } from './rowTreeNode.js';
import { decodeTrailerHeader, encodeTrailerHeader } from './trailerRecord.js';
import {
  randomAggregate,
  randomTrailer,
} from './__tests__/support/randomRecords.js';
import {
  TEST_KINDS,
  syntheticEntry,
} from './__tests__/support/rowTreeFixtures.js';
import { SeededRandom } from './__tests__/support/seededRandom.js';

/** The record kinds each rule can apply to. */
const RULE_TARGETS: Record<OffsetRule, readonly PointsAt[]> = {
  copyNode: ['RTNODE', 'ITNODE'],
  copyRecord: ['ROW', 'LENS', 'VALUE'],
  lastRow: ['ROW'],
  ownTrailer: ['TRAILER'],
  retainedTrailer: ['TRAILER'],
  zero: ['TRAILER'],
  scratch: ['VALUE'],
};

const KEYS = (value: object): string[] => Object.keys(value);

/** Every field of every record shape, as the decoders of the codecs return them. */
function observedFields(): Record<string, string[]> {
  const random = new SeededRandom(7);
  const trailer = decodeTrailerHeader(
    encodeTrailerHeader(randomTrailer(random, 4096, new Uint8Array(8))),
  );
  const aggregate = randomAggregate(random);
  const slot = {
    childOffset: 8192,
    maxLabel: 5000n,
    count: aggregate.rows,
    aggregate,
  };
  const internal = decodeRowTreeNode(
    encodeRowTreeNode({ kind: 'internal', level: 1, slots: [slot] }).kindHeader,
  );
  const leaf = decodeRowTreeNode(
    encodeRowTreeNode({
      kind: 'leaf',
      entries: [syntheticEntry(random, 0, TEST_KINDS)],
    }).kindHeader,
  );
  if (internal.kind !== 'internal' || leaf.kind !== 'leaf') {
    throw new Error('the samples decode as the shape they were built as');
  }
  const idInternal = decodeIdTrieNode(
    encodeIdTrieNode({ kind: 'internal', bitmap: 0b11, children: [96, 128] })
      .kindHeader,
  );
  const idLeaf = decodeIdTrieNode(
    encodeIdTrieNode({
      kind: 'leaf',
      entries: [{ hash: random.bytes(16), value: random.bytes(5) }],
    }).kindHeader,
  );
  if (idLeaf.kind !== 'leaf') throw new Error('a leaf decodes as a leaf');
  const position = { label: 1000n, part: 0, block: 1 };
  const fact = decodeIdFact(
    encodeIdFact({
      firstCall: position,
      firstAiCall: position,
      firstResponse: position,
      firstToolResponse: position,
      best: position,
      bestScore: 1,
      callCount: 1,
      respCount: 1,
      lastEligibleCall: { at: position, nameLen: 3 },
      aiWire: 1,
      unnamed: 0,
      nonAiElig: 0,
      mappedRef: 300,
    }),
  );
  const row = decodeRowHeader(
    encodeRowHeader({
      label: 1000n,
      owner: 1,
      speaker: 1,
      flags: 0,
      idsLen: 0,
      metaLen: 0,
      chronologySeq: 0n,
      chronologyUserTurn: 0,
      chronologyStep: 0,
      chronologyRecordedAt: 0,
      parentEndpoint: 0n,
      blocks: [{ offset: 0, length: 1, type: 0 }],
      ids: [
        { idHash: random.bytes(16), kind: 0, block: 0, score: 0, nameLen: 0 },
      ],
    }),
  );
  const checkpoint = parseCheckpointDescriptor(
    encodeCheckpointDescriptor({
      name: 'n',
      trailerOffset: 4096,
      commitSeq: 3,
      createdAtMs: 9,
      liveBytes: 10,
    }),
  );
  return {
    TrailerHeader: KEYS(trailer),
    Aggregate: KEYS(trailer.rootAggregate),
    SlotStamp: KEYS(trailer.rootAggregate.stamp[0]),
    SlotTable: KEYS(trailer.slots),
    FormatSlot: KEYS(trailer.slots.formatSlots[0]),
    FamilySlot: KEYS(trailer.slots.familySlots[0]),
    ChildSlot: KEYS(internal.slots[0]),
    InternalNode: KEYS(internal),
    LeafNode: KEYS(leaf),
    RowEntry: KEYS(leaf.entries[0]),
    EntryMedia: KEYS(leaf.entries[0].media),
    InternalIdNode: KEYS(idInternal),
    LeafIdNode: KEYS(idLeaf),
    IdEntry: KEYS(idLeaf.entries[0]),
    IdFact: KEYS(fact),
    BlockPosition: KEYS(fact.firstCall ?? {}),
    EligibleCall: KEYS(fact.lastEligibleCall ?? {}),
    UnitPosition: KEYS(
      decodeUnitPositionValue(
        encodeUnitPositionValue({ label: 1000n, part: 0, unit: 2 }),
      ),
    ),
    OccurrenceEntry: KEYS(
      decodeOccurrenceValue(
        encodeOccurrenceValue({ at: position, eligible: true, ai: false }),
      ),
    ),
    RowHeader: KEYS(row),
    RowBlockEntry: KEYS(row.blocks[0]),
    RowIdTuple: KEYS(row.ids[0]),
    CheckpointDescriptor: KEYS(checkpoint),
    // A map entry and a relocation entry are a single 8-byte offset, which their codecs return as a bare number.
    MetaMapEntry: ['valueRef'],
    StateMapEntry: ['valueRef'],
    RelocationValue: ['newOffset'],
  };
}

describe('the offset table (design 4.8, 13.6)', () => {
  const observed = observedFields();

  it('classifies every field of every record shape the codecs return, as an offset field or as plain', () => {
    expect(
      auditFieldTables(RECORD_FIELDS, OFFSET_FIELDS, observed),
    ).toStrictEqual([]);
  });

  it('gives each offset field one rule, the record kind it points at, and its place in the record shape that declares it', () => {
    const seen = new Set<string>();
    for (const entry of OFFSET_FIELDS) {
      const id = `${entry.record}.${entry.field}`;
      expect(seen.has(id)).toBe(false);
      seen.add(id);
      expect(RECORD_FIELDS[entry.record][entry.field]).toBe(entry);
      expect(RULE_TARGETS[entry.rule]).toContain(entry.points);
    }
    const declared = Object.values(RECORD_FIELDS)
      .flatMap((fields) => Object.values(fields))
      .filter((decl): decl is OffsetField => typeof decl !== 'string');
    expect(new Set(declared)).toStrictEqual(new Set(OFFSET_FIELDS));
  });

  it('control: a table that lacks any one offset entry is reported, naming the field', () => {
    for (const missing of OFFSET_FIELDS) {
      const without = OFFSET_FIELDS.filter((entry) => entry !== missing);
      const fields: Record<string, Record<string, FieldDecl | undefined>> = {
        ...RECORD_FIELDS,
        [missing.record]: {
          ...RECORD_FIELDS[missing.record],
          [missing.field]: undefined,
        },
      };
      const problems = auditFieldTables(fields, without, observed);
      expect(problems.join('\n')).toContain(
        `${missing.record}.${missing.field}`,
      );
    }
  });

  it('control: a declared offset field that the offset table has dropped is reported', () => {
    for (const missing of OFFSET_FIELDS) {
      const without = OFFSET_FIELDS.filter((entry) => entry !== missing);
      const problems = auditFieldTables(RECORD_FIELDS, without, observed);
      expect(problems).toContain(
        `${missing.record}.${missing.field} is an offset field not in the table`,
      );
    }
  });

  it('control: a field a codec gains and the table does not classify is reported', () => {
    const grown = {
      ...observed,
      TrailerHeader: [...observed.TrailerHeader, 'snapshotOffset'],
      IdFact: [...observed.IdFact, 'valueRef2'],
    };
    expect(auditFieldTables(RECORD_FIELDS, OFFSET_FIELDS, grown)).toStrictEqual(
      [
        'TrailerHeader.snapshotOffset is not classified',
        'IdFact.valueRef2 is not classified',
      ],
    );
  });
});
