/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type {
  AnthropicSummary,
  ChatSummary,
  ChatVariant,
  ResponsesSummary,
  SlotSummary,
  SummaryKind,
  TransferTable,
} from '../../slotSummary.js';
import type { AffineTable } from '../../summaryComposition.js';
import { CHAT_MEDIA_PENDING_MASK } from '../../summaryComposition.js';
import type { SeededRandom } from './seededRandom.js';

/** Sums of 10,000 of these stay far below 2^32 counts and 2^53 byte totals. */
const BYTE_BITS = 20;
const COUNT_LIMIT = 100;

const STATES = { anthropic: 10, chat: 6, responses: 2 } as const;

function list<T>(count: number, make: (index: number) => T): T[] {
  return Array.from({ length: count }, (_, index) => make(index));
}

export function randomTable(random: SeededRandom, states: number) {
  return {
    bytes: list(states, () => random.bits(BYTE_BITS)),
    count: list(states, () => random.int(COUNT_LIMIT)),
    out: list(states, () => random.int(states)),
  } satisfies TransferTable;
}

function hasState(mask: number, state: number): boolean {
  return (mask & (1 << state)) !== 0;
}

/**
 * A table with the affine part of a summary a real unit stream can produce:
 * pending bytes survive a node (`carry`) only from a state with media pending
 * into a state with media pending, and a node adds pending bytes only when it
 * ends with media pending.
 */
export function randomAffineTable(
  random: SeededRandom,
  states: number,
  pendingMask: number,
): AffineTable {
  const table = randomTable(random, states);
  let carry = 0;
  const p = table.out.map((out, state) => {
    const pendingBoth =
      hasState(pendingMask, state) && hasState(pendingMask, out);
    if (pendingBoth && random.int(2) === 1) carry |= 1 << state;
    return hasState(pendingMask, out) ? random.bits(BYTE_BITS) : 0;
  });
  return { ...table, p, carry };
}

function randomChatVariant(random: SeededRandom): ChatVariant {
  return randomAffineTable(random, STATES.chat, CHAT_MEDIA_PENDING_MASK);
}

/** A summary of `kind` that composes the way summaries of real units do. */
export function randomValidSummary(
  random: SeededRandom,
  kind: SummaryKind,
): SlotSummary {
  if (kind === 'anthropic') {
    const summary: AnthropicSummary = {
      kind,
      variants: [
        randomTable(random, STATES.anthropic),
        randomTable(random, STATES.anthropic),
      ],
      cOut: [random.int(2), random.int(2)],
      lastL: [BigInt(random.int(1000)), BigInt(random.int(1000))],
    };
    return summary;
  }
  if (kind === 'chat') {
    const summary: ChatSummary = {
      kind,
      variants: [randomChatVariant(random), randomChatVariant(random)],
    };
    return summary;
  }
  const responses = () => ({
    ...randomTable(random, STATES.responses),
    r: random.int(COUNT_LIMIT),
  });
  const summary: ResponsesSummary = {
    kind,
    variants: [responses(), responses()],
  };
  return summary;
}
