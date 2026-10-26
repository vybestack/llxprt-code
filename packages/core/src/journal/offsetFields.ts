/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { ChunkManifest, ChunkBlock } from './chunk-row.js';
import type {
  TranscriptHead,
  TranscriptMembership,
} from './transcript-head.js';
import type {
  TranscriptEntry,
  TranscriptChild,
  TranscriptNode,
} from './transcript-tree.js';
import type { Aggregate, SlotStamp } from './aggregate.js';
import type { CheckpointDescriptor } from './checkpointDescriptor.js';
import type { BlockPosition, EligibleCall, IdFact } from './idFactCodec.js';
import type { OccurrenceEntry, UnitPosition } from './idEntryCodecs.js';
import type { IdEntry, InternalIdNode, LeafIdNode } from './idTrieNode.js';
import type { RowEntry, EntryMedia } from './rowEntry.js';
import type { RowBlockEntry, RowHeader, RowIdTuple } from './rowRecord.js';
import type { ChildSlot, InternalNode, LeafNode } from './rowTreeNode.js';
import type { FamilySlot, FormatSlot, SlotTable } from './slotTable.js';
import type { TrailerHeader } from './trailerRecord.js';

/**
 * Every record field that holds a file offset, and what a copy does with it
 * (design 4.8). Clone, compaction and the offset audit read this one table, so
 * a field cannot join a record codec without a rule: the declarations of
 * `RECORD_FIELDS` are typed `Record<keyof Record, ...>`, which the compiler
 * checks against the codec's own types, and the audit test checks them
 * against what the decoders return.
 */

/** The record kind an offset points at. */
export type PointsAt =
  | 'ROW'
  | 'PIECE'
  | 'RTNODE'
  | 'TNODE'
  | 'ITNODE'
  | 'LENS'
  | 'VALUE'
  | 'TRAILER';

/**
 * What a copy does with the field.
 * - `copyNode`: the structure below it is copied (children first) and the field takes the new offset.
 * - `copyRecord`: the record is copied byte for byte and the field takes the new offset.
 * - `lastRow`: the new offset of the copy of the last live `ROW`.
 * - `ownTrailer`: the start or end of the trailer being written.
 * - `retainedTrailer`: the new trailer of a retained version, found through the relocation trie.
 * - `zero`: 0; a copied version starts a lineage.
 * - `scratch`: the field belongs to the relocation trie, which no trailer names, so a copy never meets one.
 */
export type OffsetRule =
  | 'copyNode'
  | 'copyRecord'
  | 'lastRow'
  | 'ownTrailer'
  | 'retainedTrailer'
  | 'zero'
  | 'scratch';

/** The decoded shapes in which a field can sit, named as the codec names them. */
export type RecordName =
  | 'TrailerHeader'
  | 'Aggregate'
  | 'SlotStamp'
  | 'SlotTable'
  | 'FormatSlot'
  | 'FamilySlot'
  | 'ChildSlot'
  | 'InternalNode'
  | 'LeafNode'
  | 'RowEntry'
  | 'EntryMedia'
  | 'InternalIdNode'
  | 'LeafIdNode'
  | 'IdEntry'
  | 'IdFact'
  | 'BlockPosition'
  | 'EligibleCall'
  | 'UnitPosition'
  | 'OccurrenceEntry'
  | 'RowHeader'
  | 'RowBlockEntry'
  | 'RowIdTuple'
  | 'MetaMapEntry'
  | 'StateMapEntry'
  | 'CheckpointDescriptor'
  | 'RelocationValue'
  | 'TranscriptHead'
  | 'TranscriptMembership'
  | 'TranscriptEntry'
  | 'TranscriptChild'
  | 'TranscriptNode'
  | 'ChunkManifest'
  | 'ChunkBlock'
  | 'ChunkPieceEntry'
  | 'ChunkBlockEntry';

export interface OffsetField {
  readonly record: RecordName;
  readonly field: string;
  readonly points: PointsAt;
  readonly rule: OffsetRule;
  /** 0 means "none" and stays 0 in a copy. */
  readonly optional: boolean;
}

function offsetField(
  record: RecordName,
  name: string,
  points: PointsAt,
  rule: OffsetRule,
  optional = false,
): OffsetField {
  return { record, field: name, points, rule, optional };
}

/** The table, by name, so the copier asks for the rule of the field it is remapping. */
export const OFFSET = {
  chunkBlocks: offsetField(
    'ChunkManifest',
    'blocksRoot',
    'TNODE',
    'copyNode',
    true,
  ),
  chunkMeta: offsetField('ChunkManifest', 'metaRef', 'VALUE', 'copyRecord'),
  blockPieces: offsetField(
    'ChunkBlock',
    'piecesRoot',
    'TNODE',
    'copyNode',
    true,
  ),
  blockDescriptor: offsetField(
    'ChunkBlockEntry',
    'rowRef',
    'VALUE',
    'copyRecord',
  ),
  pieceRecord: offsetField('ChunkPieceEntry', 'rowRef', 'PIECE', 'copyRecord'),
  transcriptRoot: offsetField(
    'TranscriptHead',
    'root',
    'TNODE',
    'copyNode',
    true,
  ),
  transcriptOpen: offsetField(
    'TranscriptHead',
    'openRoot',
    'TNODE',
    'copyNode',
    true,
  ),
  transcriptRow: offsetField(
    'TranscriptEntry',
    'rowRef',
    'ROW',
    'copyRecord',
    true,
  ),
  transcriptAttempt: offsetField(
    'TranscriptEntry',
    'attemptRef',
    'VALUE',
    'copyRecord',
    true,
  ),
  transcriptPresentation: offsetField(
    'TranscriptEntry',
    'presentationRef',
    'VALUE',
    'copyRecord',
    true,
  ),
  transcriptChild: offsetField('TranscriptChild', 'ref', 'TNODE', 'copyNode'),
  membershipRow: offsetField(
    'TranscriptMembership',
    'rowRef',
    'ROW',
    'copyRecord',
    true,
  ),
  membershipRoot: offsetField(
    'TranscriptMembership',
    'occurrencesRoot',
    'TNODE',
    'copyNode',
    true,
  ),
  trailerSelf: offsetField(
    'TrailerHeader',
    'selfOffset',
    'TRAILER',
    'ownTrailer',
  ),
  trailerEnd: offsetField(
    'TrailerHeader',
    'durableEnd',
    'TRAILER',
    'ownTrailer',
  ),
  trailerParent: offsetField(
    'TrailerHeader',
    'parent',
    'TRAILER',
    'zero',
    true,
  ),
  trailerSkip: offsetField('TrailerHeader', 'skip', 'TRAILER', 'zero', true),
  trailerRowRoot: offsetField(
    'TrailerHeader',
    'rowRoot',
    'RTNODE',
    'copyNode',
    true,
  ),
  trailerIdRoot: offsetField(
    'TrailerHeader',
    'idRoot',
    'ITNODE',
    'copyNode',
    true,
  ),
  trailerMetaRoot: offsetField(
    'TrailerHeader',
    'metaRoot',
    'ITNODE',
    'copyNode',
    true,
  ),
  trailerStateRoot: offsetField(
    'TrailerHeader',
    'stateRoot',
    'ITNODE',
    'copyNode',
    true,
  ),
  trailerLastRow: offsetField(
    'TrailerHeader',
    'lastRowOffset',
    'ROW',
    'lastRow',
    true,
  ),
  rowTreeChild: offsetField('ChildSlot', 'childOffset', 'RTNODE', 'copyNode'),
  rowTreeRecord: offsetField('RowEntry', 'recordOffset', 'ROW', 'copyRecord'),
  rowTreeLens: offsetField('RowEntry', 'lensRef', 'LENS', 'copyRecord', true),
  idTrieChild: offsetField('InternalIdNode', 'children', 'ITNODE', 'copyNode'),
  idFactMapped: offsetField('IdFact', 'mappedRef', 'VALUE', 'copyRecord', true),
  metaValue: offsetField('MetaMapEntry', 'valueRef', 'VALUE', 'copyRecord'),
  stateValue: offsetField('StateMapEntry', 'valueRef', 'VALUE', 'copyRecord'),
  checkpointTrailer: offsetField(
    'CheckpointDescriptor',
    'trailerOffset',
    'TRAILER',
    'retainedTrailer',
  ),
  relocationNew: offsetField(
    'RelocationValue',
    'newOffset',
    'VALUE',
    'scratch',
  ),
} as const satisfies Record<string, OffsetField>;

export const OFFSET_FIELDS: readonly OffsetField[] = Object.values(OFFSET);

/** What a field that holds no offset holds. */
export type PlainClass =
  | 'label'
  | 'sequence'
  | 'count'
  | 'size'
  | 'hash'
  | 'flags'
  | 'code'
  | 'marker'
  | 'bytes'
  | 'text'
  | 'time'
  | 'relative'
  | 'derived'
  | 'nested';

/** A field is plain (holds no offset) or one of the offset fields above. */
export type FieldDecl = PlainClass | OffsetField;

const TRAILER: Record<keyof TrailerHeader, FieldDecl> = {
  selfOffset: OFFSET.trailerSelf,
  commitSeq: 'sequence',
  parent: OFFSET.trailerParent,
  skip: OFFSET.trailerSkip,
  lineage: 'sequence',
  lineageDepth: 'count',
  mutation: 'code',
  groupTag: 'sequence',
  mutationArg0: 'label',
  mutationArg1: 'label',
  rowRoot: OFFSET.trailerRowRoot,
  idRoot: OFFSET.trailerIdRoot,
  metaRoot: OFFSET.trailerMetaRoot,
  stateRoot: OFFSET.trailerStateRoot,
  nextLabel: 'label',
  firstLabel: 'label',
  lastRowOffset: OFFSET.trailerLastRow,
  lastOwner: 'code',
  ckptBytes: 'size',
  rootAggregate: 'nested',
  slots: 'nested',
  durableEnd: OFFSET.trailerEnd,
  syncMarker: 'marker',
};

const AGGREGATE: Record<keyof Aggregate, FieldDecl> = {
  rows: 'count',
  curated: 'count',
  units: 'count',
  tokens: 'count',
  tokensMissing: 'count',
  liveBytes: 'size',
  mediaChars: 'size',
  imageChars: 'size',
  pdfBytes: 'size',
  imageRows: 'count',
  mediaContribRows: 'count',
  thinkingRows: 'count',
  callRows: 'count',
  reconRows: 'count',
  pairSensitiveRows: 'count',
  imageContribRows: 'count',
  callBlocks: 'count',
  unmappedBlocks: 'count',
  humanRows: 'count',
  aiRows: 'count',
  toolCallBlocks: 'count',
  responseBlocks: 'count',
  noChronologyRows: 'count',
  firstSeq: 'sequence',
  lastSeq: 'sequence',
  lastHuman: 'label',
  lastAi: 'label',
  lastTool: 'label',
  lastThinking: 'label',
  lastInvalidate: 'label',
  lastCacheable: 'label',
  firstAnchor: 'label',
  firstImage: 'label',
  ownerBloom: 'flags',
  missingBase: 'count',
  missingImg: 'count',
  stamp: 'nested',
  summaries: 'bytes',
};

const ROW_ENTRY: Record<keyof RowEntry, FieldDecl> = {
  transcriptId: 'sequence',
  label: 'label',
  recordOffset: OFFSET.rowTreeRecord,
  recordLength: 'size',
  speaker: 'code',
  flags: 'flags',
  reconBlocks: 'count',
  answered: 'count',
  chronologySeq: 'sequence',
  chronologyUserTurn: 'count',
  chronologyStep: 'count',
  chronologyRecordedAt: 'time',
  owner: 'code',
  callBlocks: 'count',
  unmappedBlocks: 'count',
  toolCallBlocks: 'count',
  responseBlocks: 'count',
  lensRef: OFFSET.rowTreeLens,
  summary: 'bytes',
  media: 'nested',
  tokens: 'count',
  stamp: 'nested',
};

const ID_FACT: Record<keyof IdFact, FieldDecl> = {
  firstCall: 'nested',
  firstAiCall: 'nested',
  firstResponse: 'nested',
  firstToolResponse: 'nested',
  best: 'nested',
  bestScore: 'count',
  callCount: 'count',
  respCount: 'count',
  lastEligibleCall: 'nested',
  aiWire: 'count',
  unnamed: 'count',
  nonAiElig: 'count',
  mappedRef: OFFSET.idFactMapped,
};

const ROW_HEADER: Record<keyof RowHeader, FieldDecl> = {
  label: 'label',
  owner: 'code',
  speaker: 'code',
  flags: 'flags',
  idsLen: 'size',
  metaLen: 'size',
  chronologySeq: 'sequence',
  chronologyUserTurn: 'count',
  chronologyStep: 'count',
  chronologyRecordedAt: 'time',
  parentEndpoint: 'hash',
  blocks: 'nested',
  ids: 'nested',
  chunk: 'nested',
};

/**
 * Every field of every decoded record shape the format has. Each one is
 * either a declared offset field (a member of `OFFSET_FIELDS`) or plain.
 */
export const RECORD_FIELDS: Record<RecordName, Record<string, FieldDecl>> = {
  ChunkManifest: {
    transcriptId: 'sequence',
    blocksRoot: OFFSET.chunkBlocks,
    metaRef: OFFSET.chunkMeta,
    blockCount: 'count',
  } satisfies Record<keyof ChunkManifest, FieldDecl>,
  ChunkBlock: {
    piecesRoot: OFFSET.blockPieces,
    length: 'size',
    type: 'code',
    ended: 'flags',
    named: 'flags',
    snapshot: 'nested',
  } satisfies Record<keyof ChunkBlock, FieldDecl>,
  ChunkPieceEntry: { rowRef: OFFSET.pieceRecord },
  ChunkBlockEntry: { rowRef: OFFSET.blockDescriptor },
  TranscriptHead: {
    root: OFFSET.transcriptRoot,
    count: 'count',
    nextId: 'sequence',
    openRoot: OFFSET.transcriptOpen,
    reachableBytes: 'size',
  } satisfies Record<keyof TranscriptHead, FieldDecl>,
  TranscriptMembership: {
    count: 'count',
    label: 'label',
    rowRef: OFFSET.membershipRow,
    occurrencesRoot: OFFSET.membershipRoot,
  } satisfies Record<keyof TranscriptMembership, FieldDecl>,
  TranscriptEntry: {
    transcriptId: 'sequence',
    rowRef: OFFSET.transcriptRow,
    recordLength: 'size',
    label: 'label',
    revision: 'count',
    audience: 'code',
    status: 'code',
    attemptRef: OFFSET.transcriptAttempt,
    supersedesId: 'sequence',
    presentationRef: OFFSET.transcriptPresentation,
  } satisfies Record<keyof TranscriptEntry, FieldDecl>,
  TranscriptChild: {
    maxId: 'sequence',
    maxRowRef: 'derived',
    ref: OFFSET.transcriptChild,
    count: 'count',
  } satisfies Record<keyof TranscriptChild, FieldDecl>,
  TranscriptNode: {
    mode: 'code',
    level: 'count',
    entries: 'nested',
    children: 'nested',
  } satisfies Record<keyof TranscriptNode, FieldDecl>,
  TrailerHeader: TRAILER,
  Aggregate: AGGREGATE,
  SlotStamp: { gen: 'count', imageGen: 'count' } satisfies Record<
    keyof SlotStamp,
    FieldDecl
  >,
  SlotTable: { formatSlots: 'nested', familySlots: 'nested' } satisfies Record<
    keyof SlotTable,
    FieldDecl
  >,
  FormatSlot: {
    formatKeyHash: 'hash',
    formatRev: 'count',
    gen: 'count',
    imageKeyHash: 'hash',
    imageGen: 'count',
    summaryKind: 'code',
    filledThrough: 'count',
  } satisfies Record<keyof FormatSlot, FieldDecl>,
  FamilySlot: {
    familyKeyHash: 'hash',
    estimatorRev: 'count',
    gen: 'count',
  } satisfies Record<keyof FamilySlot, FieldDecl>,
  ChildSlot: {
    childOffset: OFFSET.rowTreeChild,
    maxLabel: 'label',
    count: 'count',
    aggregate: 'nested',
  } satisfies Record<keyof ChildSlot, FieldDecl>,
  InternalNode: {
    kind: 'code',
    level: 'count',
    slots: 'nested',
  } satisfies Record<keyof InternalNode, FieldDecl>,
  LeafNode: { kind: 'code', entries: 'nested' } satisfies Record<
    keyof LeafNode,
    FieldDecl
  >,
  RowEntry: ROW_ENTRY,
  EntryMedia: {
    mediaChars: 'size',
    imageChars: 'size',
    pdfBytes: 'size',
  } satisfies Record<keyof EntryMedia, FieldDecl>,
  InternalIdNode: {
    kind: 'code',
    bitmap: 'flags',
    children: OFFSET.idTrieChild,
  } satisfies Record<keyof InternalIdNode, FieldDecl>,
  LeafIdNode: { kind: 'code', entries: 'nested' } satisfies Record<
    keyof LeafIdNode,
    FieldDecl
  >,
  IdEntry: { hash: 'hash', value: 'bytes' } satisfies Record<
    keyof IdEntry,
    FieldDecl
  >,
  IdFact: ID_FACT,
  BlockPosition: {
    label: 'label',
    part: 'code',
    block: 'count',
  } satisfies Record<keyof BlockPosition, FieldDecl>,
  EligibleCall: { at: 'nested', nameLen: 'size' } satisfies Record<
    keyof EligibleCall,
    FieldDecl
  >,
  UnitPosition: {
    label: 'label',
    part: 'code',
    unit: 'count',
  } satisfies Record<keyof UnitPosition, FieldDecl>,
  OccurrenceEntry: {
    at: 'nested',
    eligible: 'flags',
    ai: 'flags',
  } satisfies Record<keyof OccurrenceEntry, FieldDecl>,
  RowHeader: ROW_HEADER,
  RowBlockEntry: {
    offset: 'relative',
    length: 'size',
    type: 'code',
  } satisfies Record<keyof RowBlockEntry, FieldDecl>,
  RowIdTuple: {
    idHash: 'hash',
    kind: 'code',
    block: 'count',
    score: 'count',
    nameLen: 'size',
  } satisfies Record<keyof RowIdTuple, FieldDecl>,
  MetaMapEntry: { valueRef: OFFSET.metaValue },
  StateMapEntry: { valueRef: OFFSET.stateValue },
  CheckpointDescriptor: {
    name: 'text',
    trailerOffset: OFFSET.checkpointTrailer,
    commitSeq: 'sequence',
    createdAtMs: 'time',
    liveBytes: 'size',
  } satisfies Record<keyof CheckpointDescriptor, FieldDecl>,
  RelocationValue: { newOffset: OFFSET.relocationNew },
};

/**
 * What is wrong with a pair of tables, as messages: a field that a record
 * shape has and the table does not classify (a new field with no rule), a
 * declared offset field that is missing from `offsetFields`, and an entry of
 * `offsetFields` that no record shape declares.
 */
export function auditFieldTables(
  fields: Record<string, Record<string, FieldDecl | undefined> | undefined>,
  offsetFields: readonly OffsetField[],
  observed: Record<string, readonly string[]>,
): string[] {
  const problems: string[] = [];
  const known = new Set(offsetFields);
  for (const [record, names] of Object.entries(observed)) {
    for (const name of names) {
      const decl = fields[record]?.[name];
      if (decl === undefined) {
        problems.push(`${record}.${name} is not classified`);
      } else if (typeof decl !== 'string' && !known.has(decl)) {
        problems.push(`${record}.${name} is an offset field not in the table`);
      }
    }
  }
  for (const entry of offsetFields) {
    if (fields[entry.record]?.[entry.field] !== entry) {
      problems.push(
        `${entry.record}.${entry.field} is in the table but unused`,
      );
    }
  }
  return problems;
}
