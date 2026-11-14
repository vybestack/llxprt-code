/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */

/**
 * Issue #854 phase 0: the normalized unit stream as a function of per-id
 * facts (section 6 of the design), checked against core normalization.
 *
 * The facts, over the valid parts of the rows (a tool row that carries calls
 * splits into an AI part of the calls and a tool part of the rest):
 *
 * - `firstCall(X)`     the first part with a call of X, any speaker
 * - `firstAiCall(X)`   the first AI-speaker part with a call of X
 * - `answered(X)`      some response with this truthy call id exists anywhere
 * - `firstToolAnswer(X)` the first tool-speaker part answering X
 *
 * Rules: (R1) a tool part answering X before any call of X gets a
 * reconstructed call unit before it; (R3) an AI part holding the first AI
 * call of an unanswered X gets a synthetic cancelled response after it; (R4)
 * the responses collected for a part that holds calls are emitted in a tool
 * unit after it, whatever the speaker of that part; (R7) a part's own unit
 * has its responses and media removed.
 *
 * The id maps are STAND-INS for id-trie facts; they are heap maps here and
 * stay test-only.
 */

import type {
  ContentBlock,
  IContent,
  ToolResponseBlock,
} from '@vybestack/llxprt-code-core/services/history/IContent.js';

/** `design` readings are the controls; the others are what core does. */
export interface EmissionRules {
  /** (R3) which part owns the synthetic response of an unanswered call. */
  readonly orphanOwner: 'firstAiCall' | 'firstCall';
  /** (R4) which parts may carry the responses collected for their calls. */
  readonly adjacentUnit: 'everyCallPart' | 'aiPartsOnly';
}

export const CORE_RULES: EmissionRules = {
  orphanOwner: 'firstAiCall',
  adjacentUnit: 'everyCallPart',
};

export interface UnitKey {
  readonly speaker: string;
  readonly blocks: readonly string[];
}

function blockKey(block: ContentBlock): string {
  switch (block.type) {
    case 'tool_call':
      return `call:${block.id}`;
    case 'tool_response':
      return `resp:${block.callId}:${String(block.result)}`;
    case 'text':
      return `text:${block.text}`;
    case 'media':
      return `media:${'data' in block ? String(block.data) : ''}`;
    default:
      return block.type;
  }
}

export function unitKeyOf(unit: {
  speaker: string;
  blocks: readonly ContentBlock[];
}): UnitKey {
  return { speaker: unit.speaker, blocks: unit.blocks.map(blockKey) };
}

interface Part {
  readonly speaker: IContent['speaker'];
  readonly blocks: readonly ContentBlock[];
  readonly valid: boolean;
}

interface Row {
  readonly part: Part;
}

const isCall = (block: ContentBlock): boolean => block.type === 'tool_call';

/** Stage 0: a tool row that carries calls splits into an AI part and a tool part. */
function splitParts(rows: readonly IContent[]): Part[] {
  const parts: Part[] = [];
  for (const row of rows) {
    const valid = row.blocks.length > 0;
    if (row.speaker === 'tool' && valid && row.blocks.some(isCall)) {
      parts.push({ speaker: 'ai', blocks: row.blocks.filter(isCall), valid });
      const rest = row.blocks.filter((block) => !isCall(block));
      if (rest.length > 0) parts.push({ speaker: 'tool', blocks: rest, valid });
    } else {
      parts.push({ speaker: row.speaker, blocks: row.blocks, valid });
    }
  }
  return parts;
}

interface IdFacts {
  readonly firstCall: ReadonlyMap<string, number>;
  readonly firstAiCall: ReadonlyMap<string, number>;
  readonly answered: ReadonlySet<string>;
  readonly firstToolAnswer: ReadonlyMap<string, number>;
}

function idFactsOf(parts: readonly Part[]): IdFacts {
  const firstCall = new Map<string, number>();
  const firstAiCall = new Map<string, number>();
  const answered = new Set<string>();
  const firstToolAnswer = new Map<string, number>();
  parts.forEach((part, at) => {
    if (!part.valid) return;
    for (const block of part.blocks) {
      if (block.type === 'tool_call') {
        if (!firstCall.has(block.id)) firstCall.set(block.id, at);
        if (part.speaker === 'ai' && !firstAiCall.has(block.id)) {
          firstAiCall.set(block.id, at);
        }
      }
      if (block.type === 'tool_response') {
        if (block.callId) answered.add(block.callId);
        if (part.speaker === 'tool' && !firstToolAnswer.has(block.callId)) {
          firstToolAnswer.set(block.callId, at);
        }
      }
    }
  });
  return { firstCall, firstAiCall, answered, firstToolAnswer };
}

function reconstructedCalls(
  part: Part,
  at: number,
  facts: IdFacts,
): ContentBlock[] {
  return part.blocks.flatMap<ContentBlock>((block) => {
    if (block.type !== 'tool_response') return [];
    const call = facts.firstCall.get(block.callId);
    const firstAnswerHere = facts.firstToolAnswer.get(block.callId) === at;
    const calledBefore = call !== undefined && call <= at;
    if (!firstAnswerHere || calledBefore) return [];
    return [{ type: 'tool_call', id: block.callId, name: 'x', parameters: {} }];
  });
}

function cancelledResponses(
  part: Part,
  at: number,
  facts: IdFacts,
  rules: EmissionRules,
): ContentBlock[] {
  if (part.speaker !== 'ai' || !part.valid) return [];
  const owner =
    rules.orphanOwner === 'firstAiCall' ? facts.firstAiCall : facts.firstCall;
  return part.blocks.flatMap<ContentBlock>((block) => {
    if (block.type !== 'tool_call' || block.id === '') return [];
    if (facts.answered.has(block.id) || owner.get(block.id) !== at) return [];
    return [
      {
        type: 'tool_response',
        callId: block.id,
        toolName: 'x',
        result: null,
        error: 'Tool call interrupted or cancelled',
        isComplete: true,
      },
    ];
  });
}

/** (R1) and (R3): the parts with the reconstructed and cancelled units around them. */
function expandedRows(
  parts: readonly Part[],
  facts: IdFacts,
  rules: EmissionRules,
): Row[] {
  const rows: Row[] = [];
  parts.forEach((part, at) => {
    if (part.speaker === 'tool' && part.valid) {
      const calls = reconstructedCalls(part, at, facts);
      if (calls.length > 0) {
        rows.push({ part: { speaker: 'ai', blocks: calls, valid: true } });
      }
    }
    rows.push({ part });
    const cancelled = cancelledResponses(part, at, facts, rules);
    if (cancelled.length > 0) {
      rows.push({ part: { speaker: 'tool', blocks: cancelled, valid: true } });
    }
  });
  return rows;
}

const scoreOf = (response: ToolResponseBlock): number =>
  (response.isComplete === true ? 2 : 0) -
  (response.error ? 1 : 0) +
  (response.result !== undefined && response.result !== null ? 1 : 0);

interface Collected {
  /** Per target row, the call ids answered there, in first-answer order. */
  readonly slots: ReadonlyMap<number, readonly string[]>;
  readonly best: ReadonlyMap<string, ToolResponseBlock>;
  readonly media: ReadonlyMap<number, readonly ContentBlock[]>;
}

/** (R2) a call's target is the first row that holds it. */
function callTargets(rows: readonly Row[]): Map<string, number> {
  const target = new Map<string, number>();
  rows.forEach((row, at) => {
    if (!row.part.valid) return;
    for (const block of row.part.blocks) {
      if (block.type === 'tool_call' && block.id && !target.has(block.id)) {
        target.set(block.id, at);
      }
    }
  });
  return target;
}

/** Records an answer; true when it is the first answer of its call. */
function recordResponse(
  block: ToolResponseBlock,
  at: number,
  slots: Map<number, string[]>,
  best: Map<string, ToolResponseBlock>,
): boolean {
  const existing = best.get(block.callId);
  if (existing === undefined) {
    best.set(block.callId, block);
    slots.set(at, [...(slots.get(at) ?? []), block.callId]);
    return true;
  }
  if (scoreOf(block) > scoreOf(existing)) best.set(block.callId, block);
  return false;
}

/** The answers in a part whose call has a target row. */
function targetedAnswers(
  part: Part,
  target: ReadonlyMap<string, number>,
): Array<{ block: ToolResponseBlock; at: number }> {
  return part.blocks.flatMap((block) => {
    if (block.type !== 'tool_response' || !block.callId) return [];
    const at = target.get(block.callId);
    return at === undefined ? [] : [{ block, at }];
  });
}

function collectResponses(rows: readonly Row[]): Collected {
  const target = callTargets(rows);
  const slots = new Map<number, string[]>();
  const best = new Map<string, ToolResponseBlock>();
  const media = new Map<number, ContentBlock[]>();
  for (const { part } of rows) {
    if (!part.valid) continue;
    let mediaTarget: number | undefined;
    for (const { block, at } of targetedAnswers(part, target)) {
      if (recordResponse(block, at, slots, best)) mediaTarget ??= at;
    }
    if (mediaTarget !== undefined) {
      const found = part.blocks.filter((block) => block.type === 'media');
      media.set(mediaTarget, [...(media.get(mediaTarget) ?? []), ...found]);
    }
  }
  return { slots, best, media };
}

/** (R7) the part's own unit: without its responses and media; none if nothing is left. */
function ownUnit(part: Part): UnitKey | undefined {
  const hasResponse =
    part.valid && part.blocks.some((block) => block.type === 'tool_response');
  if (!hasResponse) return unitKeyOf(part);
  const kept = part.blocks.filter(
    (block) => block.type !== 'tool_response' && block.type !== 'media',
  );
  if (part.speaker === 'tool' || kept.length === 0) return undefined;
  return unitKeyOf({ speaker: part.speaker, blocks: kept });
}

/** The unit stream core normalization produces, as keys, from per-id facts. */
export function emittedUnits(
  rowsIn: readonly IContent[],
  rules: EmissionRules = CORE_RULES,
): UnitKey[] {
  const parts = splitParts(rowsIn);
  const rows = expandedRows(parts, idFactsOf(parts), rules);
  const collected = collectResponses(rows);
  const out: UnitKey[] = [];
  rows.forEach(({ part }, at) => {
    const own = ownUnit(part);
    if (own !== undefined) out.push(own);
    const ids = collected.slots.get(at) ?? [];
    const carriesCalls = part.valid && part.blocks.some(isCall);
    const mayCarry =
      rules.adjacentUnit === 'everyCallPart' || part.speaker === 'ai';
    if (!mayCarry || !carriesCalls || ids.length === 0) return;
    const blocks: ContentBlock[] = ids.flatMap((id) => {
      const response = collected.best.get(id);
      return response === undefined ? [] : [response];
    });
    blocks.push(...(collected.media.get(at) ?? []));
    out.push(unitKeyOf({ speaker: 'tool', blocks }));
  });
  return out;
}
