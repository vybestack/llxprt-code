/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */

/**
 * Issue #854 phase 0: the Kimi id facts of the chat length model.
 *
 * The Kimi mapper writes `functions.<name>:<index>` where the name is that of
 * the LAST eligible call occurrence of the id (id and name both truthy, in
 * any speaker's unit) and the index is that occurrence's ordinal among the
 * eligible occurrences. An id nobody maps takes the next number of a counter
 * that starts after the last eligible ordinal. The stored message lengths
 * leave the digits out (they measure a fixed placeholder and subtract it);
 * the digits are added back from these facts, two ways: by walking every id
 * use (exact), and with the design's closed form plus the exception ids.
 *
 * `KimiFacts` is a STAND-IN for the entries of the on-disk id index (the id
 * trie and occurrence entries). It is a heap map here because the test
 * builds it from the whole history; the product reads index entries. It stays
 * test-only.
 */

import type {
  IContent,
  ToolCallBlock,
  ToolResponseBlock,
} from '@vybestack/llxprt-code-core/services/history/IContent.js';
import {
  digitCount,
  sumDigits,
} from '../../../../__tests__/support/lengthModel/bytes.js';
import type { ChatUnit, IdUse, Variant } from './chatTransducer.js';

/** The rule for the name in a mapped id. Only the first is what the mapper does. */
export type KimiNameRule = 'lastEligible' | 'ownName' | 'lastRawName';

interface CallBlockCounts {
  total: number;
  /** Blocks in an AI unit: the ones the body can write. */
  aiWire: number;
  unnamed: number;
  /** Eligible occurrences in a unit that is not an AI unit. */
  nonAiEligible: number;
}

export interface KimiFacts {
  /** The number of eligible occurrences: where the unmapped counter starts. */
  readonly eligibleCount: number;
  /** Per id, the last eligible occurrence: its name and its ordinal. */
  readonly last: ReadonlyMap<string, { name: string; ordinal: number }>;
  /** Per id, the ordinals of all its eligible occurrences. */
  readonly eligible: ReadonlyMap<string, readonly number[]>;
  readonly callBlocks: ReadonlyMap<string, CallBlockCounts>;
}

function newCounts(): CallBlockCounts {
  return { total: 0, aiWire: 0, unnamed: 0, nonAiEligible: 0 };
}

function* callBlocksOf(
  rows: readonly IContent[],
): Generator<{ speaker: string; call: ToolCallBlock }> {
  for (const row of rows) {
    for (const block of row.blocks) {
      if (block.type === 'tool_call') {
        yield { speaker: row.speaker, call: block };
      }
    }
  }
}

export function kimiFactsOf(
  rows: readonly IContent[],
  rule: KimiNameRule,
): KimiFacts {
  const last = new Map<string, { name: string; ordinal: number }>();
  const eligible = new Map<string, number[]>();
  const callBlocks = new Map<string, CallBlockCounts>();
  let ordinal = 0;
  for (const { speaker, call } of callBlocksOf(rows)) {
    const counts = callBlocks.get(call.id) ?? newCounts();
    callBlocks.set(call.id, counts);
    counts.total += 1;
    if (speaker === 'ai') counts.aiWire += 1;
    if (!call.name) counts.unnamed += 1;
    const known = last.get(call.id);
    if (
      rule === 'lastRawName' &&
      call.id &&
      known !== undefined &&
      !call.name
    ) {
      // The control: "the last occurrence" by call count ignores eligibility.
      last.set(call.id, { name: call.name, ordinal: known.ordinal });
    }
    if (call.id && call.name) {
      last.set(call.id, { name: call.name, ordinal });
      eligible.set(call.id, [...(eligible.get(call.id) ?? []), ordinal]);
      if (speaker !== 'ai') counts.nonAiEligible += 1;
      ordinal += 1;
    }
  }
  return { eligibleCount: ordinal, last, eligible, callBlocks };
}

function lastOf(
  facts: KimiFacts,
  id: string,
): { name: string; ordinal: number } {
  const entry = facts.last.get(id);
  if (entry === undefined) throw new Error(`no eligible occurrence of ${id}`);
  return entry;
}

const hex = (text: string): string => Buffer.from(text, 'utf8').toString('hex');

export interface KimiResolvers {
  call(call: ToolCallBlock): string;
  response(response: ToolResponseBlock): string;
}

/**
 * Resolvers that write a fixed-shape placeholder for the digits and log the
 * use. `counter` is the unmapped counter of one conversion; one conversion
 * per thinking variant, because each variant converts the whole history.
 */
export function kimiResolvers(
  facts: KimiFacts,
  rule: KimiNameRule,
  counter: { next: number },
  log: IdUse[],
): KimiResolvers {
  const mapped = (id: string, ownName: string): string => {
    const token = `~M${hex(id)}~`;
    log.push({ kind: 'mapped', key: id, placeholderBytes: token.length });
    const name = rule === 'ownName' ? ownName : lastOf(facts, id).name;
    return `functions.${name}:${token}`;
  };
  const unmapped = (name: string): string => {
    const token = `~U${counter.next}~`;
    counter.next += 1;
    log.push({ kind: 'unmapped', key: token, placeholderBytes: token.length });
    return `functions.${name}:${token}`;
  };
  return {
    call: (call) =>
      facts.last.has(call.id)
        ? mapped(call.id, call.name)
        : unmapped(call.name),
    response: (response) =>
      facts.last.has(response.callId)
        ? mapped(response.callId, response.toolName)
        : unmapped(response.toolName),
  };
}

export interface UseRecord {
  readonly use: IdUse;
  readonly written: boolean;
}

/** Every id use in conversion order with whether the body writes its message. */
export function idUseRecords(
  units: readonly ChatUnit[],
  variantOfUnit: (index: number) => Variant,
  dropped: ReadonlyArray<ReadonlySet<number>>,
): UseRecord[] {
  const records: UseRecord[] = [];
  for (const unit of units) {
    unit.messages[variantOfUnit(unit.index)].forEach((message, at) => {
      for (const use of message.uses) {
        records.push({ use, written: !dropped[unit.index].has(at) });
      }
    });
  }
  return records;
}

/** Exact: the digits of the ordinal of every written use. */
export function digitsExact(
  records: readonly UseRecord[],
  facts: KimiFacts,
): number {
  let unmappedRank = 0;
  let total = 0;
  for (const { use, written } of records) {
    if (use.kind === 'mapped') {
      if (written) total += digitCount(lastOf(facts, use.key).ordinal);
    } else {
      if (written) total += digitCount(facts.eligibleCount + unmappedRank);
      unmappedRank += 1;
    }
  }
  return total;
}

export interface ExceptionReasons {
  dupEligible: number;
  unnamed: number;
  nonAiEligible: number;
  unmappedTruthy: number;
  falsy: number;
}

interface IdClasses {
  /** One named AI call block and exactly two written mapped uses. */
  readonly clean: ReadonlySet<string>;
  readonly exceptions: ReadonlySet<string>;
  readonly reasons: ExceptionReasons;
}

/** One named AI call block, answered by exactly the two uses a clean id has. */
function isCleanId(id: string, counts: CallBlockCounts): boolean {
  const single = counts.total === 1 && counts.aiWire === 1;
  return (
    id !== '' && single && counts.unnamed === 0 && counts.nonAiEligible === 0
  );
}

function addReasons(
  reasons: ExceptionReasons,
  id: string,
  counts: CallBlockCounts,
  facts: KimiFacts,
): void {
  if (id === '') {
    reasons.falsy += 1;
    return;
  }
  if ((facts.eligible.get(id)?.length ?? 0) >= 2) reasons.dupEligible += 1;
  if (counts.unnamed > 0) reasons.unnamed += 1;
  if (counts.nonAiEligible > 0) reasons.nonAiEligible += 1;
  if (!facts.last.has(id)) reasons.unmappedTruthy += 1;
}

function classifyIds(facts: KimiFacts): IdClasses {
  const clean = new Set<string>();
  const exceptions = new Set<string>();
  const reasons: ExceptionReasons = {
    dupEligible: 0,
    unnamed: 0,
    nonAiEligible: 0,
    unmappedTruthy: 0,
    falsy: 0,
  };
  for (const [id, counts] of facts.callBlocks) {
    if (isCleanId(id, counts)) {
      clean.add(id);
    } else {
      exceptions.add(id);
      addReasons(reasons, id, counts, facts);
    }
  }
  return { clean, exceptions, reasons };
}

export interface ClosedForm {
  readonly digits: number;
  readonly cleanIds: number;
  readonly exceptionIds: number;
  readonly reasons: ExceptionReasons;
  /** Clean ids that did not have exactly two written mapped uses. */
  readonly cleanViolations: number;
  /** Uses the closed form read: exception ids, unmapped uses, the empty id. */
  readonly usesRead: number;
}

/** Per id, how many mapped uses the body writes. */
function writtenMappedCounts(
  records: readonly UseRecord[],
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const { use, written } of records) {
    if (use.kind === 'mapped' && written) {
      counts.set(use.key, (counts.get(use.key) ?? 0) + 1);
    }
  }
  return counts;
}

/** The digits of the unmapped sequence: it numbers from the eligible count. */
function unmappedDigits(
  records: readonly UseRecord[],
  facts: KimiFacts,
): number {
  let rank = 0;
  let total = 0;
  for (const { use, written } of records) {
    if (use.kind !== 'unmapped') continue;
    if (written) total += digitCount(facts.eligibleCount + rank);
    rank += 1;
  }
  return total;
}

/** What the clean ids owe: both written uses carry their own ordinal. */
function cleanDigits(facts: KimiFacts): number {
  return 2 * sumDigits(facts.eligibleCount);
}

/**
 * The design's closed form: `2 * S(N)` for the clean ids, a per-id correction
 * for each exception id, plus the unmapped sequence. The uses of the clean
 * ids are not read to compute it.
 */
export function digitsClosed(
  records: readonly UseRecord[],
  facts: KimiFacts,
): ClosedForm {
  const { clean, exceptions, reasons } = classifyIds(facts);
  const written = writtenMappedCounts(records);
  let digits = cleanDigits(facts) + unmappedDigits(records, facts);
  for (const id of exceptions) {
    const ordinals = facts.eligible.get(id);
    if (ordinals === undefined || !facts.last.has(id)) continue;
    const eligibleDigits = ordinals.reduce(
      (sum, ordinal) => sum + digitCount(ordinal),
      0,
    );
    digits +=
      (written.get(id) ?? 0) * digitCount(lastOf(facts, id).ordinal) -
      2 * eligibleDigits;
  }
  let cleanViolations = 0;
  for (const id of clean) {
    if ((written.get(id) ?? 0) !== 2) cleanViolations += 1;
  }
  const usesRead = records.filter(
    ({ use }) => use.kind === 'unmapped' || !clean.has(use.key),
  ).length;
  return {
    digits,
    cleanIds: clean.size,
    exceptionIds: exceptions.size,
    reasons,
    cleanViolations,
    usesRead,
  };
}

/** The control without the exception list: clean ids and the unmapped counter only. */
export function digitsWithoutExceptions(
  records: readonly UseRecord[],
  facts: KimiFacts,
): number {
  return cleanDigits(facts) + unmappedDigits(records, facts);
}
