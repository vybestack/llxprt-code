/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { IdOccurrence } from '../../idFactUpdate.js';
import type { IdFact } from '../../idFactCodec.js';
import { EMPTY_ID_FACT } from '../../idFactCodec.js';
import type { OccurrenceEntry, UnitPosition } from '../../idEntryCodecs.js';
import {
  ID_NS,
  OCCURRENCE_KIND,
  type NormalizedFamily,
  type OccurrenceKind,
} from '../../idKeys.js';
import { ROW_SPEAKER } from '../../rowRecord.js';
import { SeededRandom } from './seededRandom.js';

/**
 * A small seeded history generator ported from the r2 prototype generators
 * (`idfacts.ts` sweepHistory, `mistral17.ts` history): rows of text, tool
 * calls and tool responses over id shapes that collide under normalization.
 */
export interface ModelBlock {
  readonly type: 'text' | 'call' | 'response';
  readonly id: string;
  readonly name: string;
  readonly score: number;
}

export interface ModelRow {
  readonly label: bigint;
  readonly speaker: number;
  readonly blocks: readonly ModelBlock[];
}

/** Raw id shapes that collapse under one or both normalizers, and the empty id. */
export const ID_SHAPES = [
  'X',
  'toolu_X',
  'hist_tool_X',
  'call_X',
  'empty',
  '',
  'toolu_empty',
  'a b',
  'a-b',
  'toolu_a-b',
  'call_a!b',
  'hist_tool_a b',
  'toolu_',
  'call_',
  'Y',
  'hist_tool_Y',
] as const;

const RECONSTRUCTED_NAME = 'unknown_tool';

function pick<T>(random: SeededRandom, items: readonly T[]): T {
  return items[random.int(items.length)];
}

function call(random: SeededRandom): ModelBlock {
  const named = random.int(4) !== 0;
  return {
    type: 'call',
    id: pick(random, ID_SHAPES),
    name: named ? pick(random, ['read_file', 'ls', 'grep_search_tool']) : '',
    score: 0,
  };
}

function response(random: SeededRandom): ModelBlock {
  return {
    type: 'response',
    id: pick(random, ID_SHAPES),
    name: '',
    score: random.int(4),
  };
}

const TEXT: ModelBlock = { type: 'text', id: '', name: '', score: 0 };

function blocksFor(random: SeededRandom, kind: number): [number, ModelBlock[]] {
  const many = (make: () => ModelBlock): ModelBlock[] =>
    Array.from({ length: 1 + random.int(3) }, make);
  switch (kind) {
    case 0:
    case 1:
      return [ROW_SPEAKER.human, [TEXT]];
    case 2:
      return [ROW_SPEAKER.human, [TEXT, ...many(() => response(random))]];
    case 3:
      return [ROW_SPEAKER.human, [TEXT, call(random)]];
    case 4:
      return [ROW_SPEAKER.ai, [TEXT]];
    case 5:
    case 6:
      return [ROW_SPEAKER.ai, many(() => call(random))];
    case 7:
    case 8:
      return [ROW_SPEAKER.tool, many(() => response(random))];
    default:
      return [ROW_SPEAKER.tool, [call(random), response(random)]];
  }
}

/** Every third history opens with a tool row that answers the empty id, which nothing reconstructs: a leading tool unit. */
const LEADING_TOOL_ROW: Pick<ModelRow, 'speaker' | 'blocks'> = {
  speaker: ROW_SPEAKER.tool,
  blocks: [{ type: 'response', id: '', name: '', score: 1 }],
};

export function randomRows(seed: number, rowCount: number): ModelRow[] {
  const random = new SeededRandom(seed * 977 + 5);
  const rows = Array.from({ length: rowCount }, (_, index) => {
    const [speaker, blocks] = blocksFor(random, random.int(10));
    return { label: BigInt(index + 1) * 1000n, speaker, blocks };
  });
  return seed % 3 === 0
    ? [{ ...rows[0], ...LEADING_TOOL_ROW }, ...rows.slice(1)]
    : rows;
}

interface Part {
  readonly index: number;
  readonly speaker: number;
  readonly blocks: readonly ModelBlock[];
}

/** A tool row that carries calls splits into an ai part of the calls and a tool part of the rest (6.1). */
function partsOf(row: ModelRow): Part[] {
  if (
    row.speaker !== ROW_SPEAKER.tool ||
    !row.blocks.some((b) => b.type === 'call')
  ) {
    return [{ index: 0, speaker: row.speaker, blocks: row.blocks }];
  }
  return [
    {
      index: 0,
      speaker: ROW_SPEAKER.ai,
      blocks: row.blocks.filter((b) => b.type === 'call'),
    },
    {
      index: 1,
      speaker: ROW_SPEAKER.tool,
      blocks: row.blocks.filter((b) => b.type !== 'call'),
    },
  ];
}

/**
 * The occurrences of a history in position order, with a deliberately simple
 * unit model: every part emits one unit of its own speaker (unit 1 when
 * reconstructed calls precede it, which take unit 0), and a block is
 * emitted where it sits. It is a stand-in for the normalizer of phase 5, which
 * decides unit positions in production; the index only records what it is given.
 */
export function occurrencesOf(rows: readonly ModelRow[]): IdOccurrence[] {
  const out: IdOccurrence[] = [];
  const calledBefore = new Set<string>();
  const toolAnswered = new Set<string>();
  let nonToolSeen = false;
  for (const row of rows) {
    for (const part of partsOf(row)) {
      const reconstructed = reconstructedFor(part, calledBefore, toolAnswered);
      for (const [block, entry] of reconstructed) {
        out.push({
          rawId: entry.id,
          kind: OCCURRENCE_KIND.call,
          at: { label: row.label, part: part.index, block },
          partSpeaker: ROW_SPEAKER.ai,
          unit: {
            position: { label: row.label, part: part.index, unit: 0 },
            speaker: ROW_SPEAKER.ai,
            leadingTool: false,
          },
          score: 0,
          nameLen: new TextEncoder().encode(RECONSTRUCTED_NAME).length,
          reconstructed: true,
        });
      }
      if (reconstructed.length > 0) nonToolSeen = true;
      const unit = {
        position: {
          label: row.label,
          part: part.index,
          unit: reconstructed.length > 0 ? 1 : 0,
        },
        speaker: part.speaker,
        leadingTool: part.speaker === ROW_SPEAKER.tool && !nonToolSeen,
      };
      part.blocks.forEach((block, index) => {
        if (block.type === 'text') return;
        out.push(realOccurrence(row, part, block, index, unit));
        if (block.type === 'call') calledBefore.add(block.id);
      });
      markToolAnswered(part, toolAnswered);
      if (part.speaker !== ROW_SPEAKER.tool) nonToolSeen = true;
    }
  }
  return out;
}

function markToolAnswered(part: Part, answered: Set<string>): void {
  if (part.speaker !== ROW_SPEAKER.tool) return;
  for (const block of part.blocks) {
    if (block.type === 'response') answered.add(block.id);
  }
}

function reconstructedFor(
  part: Part,
  calledBefore: ReadonlySet<string>,
  toolAnswered: ReadonlySet<string>,
): Array<[number, ModelBlock]> {
  if (part.speaker !== ROW_SPEAKER.tool) return [];
  const found: Array<[number, ModelBlock]> = [];
  part.blocks.forEach((block, index) => {
    if (
      block.type === 'response' &&
      block.id !== '' &&
      !calledBefore.has(block.id) &&
      !toolAnswered.has(block.id)
    ) {
      found.push([index, block]);
    }
  });
  return found;
}

function realOccurrence(
  row: ModelRow,
  part: Part,
  block: ModelBlock,
  index: number,
  unit: IdOccurrence['unit'],
): IdOccurrence {
  return {
    rawId: block.id,
    kind:
      block.type === 'call' ? OCCURRENCE_KIND.call : OCCURRENCE_KIND.response,
    at: { label: row.label, part: part.index, block: index },
    partSpeaker: part.speaker,
    unit,
    score: block.score,
    nameLen: new TextEncoder().encode(block.name).length,
    reconstructed: false,
  };
}

export interface NaiveIdState {
  readonly facts: Map<string, IdFact>;
  /** `${kind}:${rawId}` to the occurrences in order. */
  readonly chains: Map<string, OccurrenceEntry[]>;
  /** `${family}:${kind}:${normalizedId}` to the unit positions in order. */
  readonly normalized: Map<string, UnitPosition[]>;
  /** Raw ids in the order they became Kimi exception ids. */
  readonly exceptions: string[];
}

const AI = ROW_SPEAKER.ai;
const TOOL = ROW_SPEAKER.tool;

function eligible(occ: IdOccurrence): boolean {
  return (
    occ.kind === OCCURRENCE_KIND.call && occ.rawId !== '' && occ.nameLen > 0
  );
}

/** Whether the occurrence enters the list of `family` and `kind` (design 3.3 table). */
export function entersList(
  occ: IdOccurrence,
  family: NormalizedFamily,
): boolean {
  if (occ.kind === OCCURRENCE_KIND.call) return occ.unit.speaker === AI;
  if (family === ID_NS.openai) return occ.unit.speaker === TOOL;
  return !(occ.unit.speaker === TOOL && occ.unit.leadingTool);
}

function naiveFact(list: readonly IdOccurrence[]): IdFact {
  const calls = list.filter((o) => o.kind === OCCURRENCE_KIND.call);
  const resps = list.filter((o) => o.kind === OCCURRENCE_KIND.response);
  const real = calls.filter((o) => !o.reconstructed);
  const truthyResps = resps.filter((o) => o.rawId !== '');
  let best: IdOccurrence | undefined;
  for (const resp of truthyResps) {
    if (best === undefined || resp.score > best.score) best = resp;
  }
  const lastEligible = [...calls].reverse().find(eligible);
  return {
    ...EMPTY_ID_FACT,
    firstCall: real[0]?.at,
    firstAiCall: real.find((o) => o.partSpeaker === AI)?.at,
    firstResponse: truthyResps[0]?.at,
    firstToolResponse: resps.find((o) => o.partSpeaker === TOOL)?.at,
    best: best?.at,
    bestScore: best?.score ?? 0,
    callCount: calls.length,
    respCount: resps.length,
    lastEligibleCall:
      lastEligible === undefined
        ? undefined
        : { at: lastEligible.at, nameLen: lastEligible.nameLen },
    aiWire: calls.filter((o) => o.unit.speaker === AI).length,
    unnamed: calls.filter((o) => o.nameLen === 0).length,
    nonAiElig: calls.filter((o) => eligible(o) && o.unit.speaker !== AI).length,
  };
}

/** The Kimi exception rule recomputed from scratch for a prefix of one id's occurrences. */
function naiveIsException(
  rawId: string,
  list: readonly IdOccurrence[],
): boolean {
  const fact = naiveFact(list);
  if (fact.callCount === 0) return false;
  const single = fact.callCount === 1 && fact.aiWire === 1;
  const plain = fact.unnamed === 0 && fact.nonAiElig === 0;
  return !(rawId !== '' && single && plain);
}

export function naiveState(
  occurrences: readonly IdOccurrence[],
  normalize: (family: NormalizedFamily, rawId: string) => string,
): NaiveIdState {
  const byId = new Map<string, IdOccurrence[]>();
  const exceptions: string[] = [];
  const normalized = new Map<string, UnitPosition[]>();
  const chains = new Map<string, OccurrenceEntry[]>();
  for (const occ of occurrences) {
    const prefix = [...(byId.get(occ.rawId) ?? []), occ];
    const wasException = naiveIsException(occ.rawId, prefix.slice(0, -1));
    byId.set(occ.rawId, prefix);
    if (!wasException && naiveIsException(occ.rawId, prefix)) {
      exceptions.push(occ.rawId);
    }
    const chainKey = `${occ.kind}:${occ.rawId}`;
    chains.set(chainKey, [
      ...(chains.get(chainKey) ?? []),
      { at: occ.at, eligible: eligible(occ), ai: occ.unit.speaker === AI },
    ]);
    for (const family of [ID_NS.openai, ID_NS.anthropic] as const) {
      if (!entersList(occ, family)) continue;
      const key = listKey(family, occ.kind, normalize(family, occ.rawId));
      normalized.set(key, [...(normalized.get(key) ?? []), occ.unit.position]);
    }
  }
  const facts = new Map<string, IdFact>();
  for (const [rawId, list] of byId) facts.set(rawId, naiveFact(list));
  return { facts, chains, normalized, exceptions };
}

export function listKey(
  family: NormalizedFamily,
  kind: OccurrenceKind,
  normalizedId: string,
): string {
  return `${family}:${kind}:${normalizedId}`;
}

export function comparePositions(
  left: UnitPosition,
  right: UnitPosition,
): number {
  if (left.label !== right.label) return left.label < right.label ? -1 : 1;
  if (left.part !== right.part) return left.part - right.part;
  return left.unit - right.unit;
}
