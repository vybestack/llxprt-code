/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { JournalFormatError } from './errors.js';
import {
  SLOT_SUMMARY_LAYOUT,
  type AnthropicSummary,
  type ChatSummary,
  type ChatVariant,
  type ResponsesSummary,
  type ResponsesVariant,
  type SlotSummary,
  type SummaryKind,
  type TransferTable,
} from './slotSummary.js';

/**
 * Composition of transfer summaries (design 8.2 and 8.3). A summary is a total
 * function from the incoming boundary state to the outgoing state, with the
 * bytes and the count the range writes from that state. The second summary is
 * applied to the outgoing state of the first, and bytes and counts add.
 * Composition is function composition, so it is associative, and the identity
 * leaves every state alone and writes nothing. Nothing here knows how a
 * provider measures a unit: that is the leaf computation of phases 5 and 6.
 */

/** The P part of the chat summary: pending media bytes and a bit mask of the 0/1 coefficient. */
export interface AffinePart {
  readonly p: readonly number[];
  /** One bit per incoming state: 1 when pending media entering the node survives it. */
  readonly carry: number;
}

export type AffineTable = TransferTable & AffinePart;

/**
 * The chat boundary states are numbered `sep * 3 + media`, with `media` 0 for
 * none, 1 for images only and 2 for a video (the committed chat length model).
 * The states with media pending are 1, 2, 4 and 5. A node that leaves such a
 * state without carrying the pending bytes on flushes them, which charges them
 * to the node that comes after.
 */
export const CHAT_MEDIA_PENDING_MASK = 0b110110;

function stateCount(table: TransferTable): number {
  return table.out.length;
}

function assertSameShape(left: TransferTable, right: TransferTable): void {
  const states = stateCount(left);
  const tables = [left, right];
  const sameShape = tables.every(
    (table) =>
      table.out.length === states &&
      table.bytes.length === states &&
      table.count.length === states,
  );
  if (!sameShape) {
    throw new JournalFormatError(
      `Cannot compose summaries of ${states} and ${stateCount(right)} states`,
    );
  }
}

export function identityTable(states: number): TransferTable {
  return {
    bytes: new Array<number>(states).fill(0),
    count: new Array<number>(states).fill(0),
    out: Array.from({ length: states }, (_, state) => state),
  };
}

export function composeTables(
  left: TransferTable,
  right: TransferTable,
): TransferTable {
  assertSameShape(left, right);
  const states = stateCount(left);
  const bytes: number[] = [];
  const count: number[] = [];
  const out: number[] = [];
  for (let state = 0; state < states; state++) {
    const middle = left.out[state];
    bytes.push(left.bytes[state] + right.bytes[middle]);
    count.push(left.count[state] + right.count[middle]);
    out.push(right.out[middle]);
  }
  return { bytes, count, out };
}

function hasBit(mask: number, state: number): boolean {
  return (mask & (1 << state)) !== 0;
}

export function identityAffineTable(
  states: number,
  pendingMask: number,
): AffineTable {
  return {
    ...identityTable(states),
    p: new Array<number>(states).fill(0),
    carry: pendingMask,
  };
}

/**
 * Entries are affine in the incoming pending bytes P, which is zero unless the
 * incoming state has media pending: `bytes' = bytes + (1 - carry) * P` and
 * `P_out = carry * P + p`. The flush of the pending bytes that the left node
 * leaves behind is owed by the right node when it does not carry them on.
 *
 * Associativity and the identity hold for summaries of real unit streams,
 * where `carry` is set only from a pending state into a pending state and `p`
 * is nonzero only when the node ends with media pending.
 */
export function composeAffineTables(
  left: AffineTable,
  right: AffineTable,
  pendingMask: number,
): AffineTable {
  const table = composeTables(left, right);
  const bytes: number[] = [];
  const p: number[] = [];
  let carry = 0;
  for (let state = 0; state < stateCount(left); state++) {
    const middle = left.out[state];
    const carried = hasBit(right.carry, middle);
    const owed = hasBit(pendingMask, middle) && !carried;
    bytes.push(table.bytes[state] + (owed ? left.p[state] : 0));
    p.push((carried ? left.p[state] : 0) + right.p[middle]);
    if (hasBit(left.carry, state) && carried) carry |= 1 << state;
  }
  return { ...table, bytes, p, carry };
}

const ANTHROPIC = SLOT_SUMMARY_LAYOUT.anthropic.states;
const CHAT = SLOT_SUMMARY_LAYOUT.chat.states;
const RESPONSES = SLOT_SUMMARY_LAYOUT.responses.states;

export function identitySlotSummary(kind: SummaryKind): SlotSummary {
  if (kind === 'anthropic') {
    return {
      kind,
      variants: [identityTable(ANTHROPIC), identityTable(ANTHROPIC)],
      cOut: [0, 1],
      lastL: [0n, 0n],
    };
  }
  if (kind === 'chat') {
    const variant = identityAffineTable(CHAT, CHAT_MEDIA_PENDING_MASK);
    return { kind, variants: [variant, variant] };
  }
  const variant = { ...identityTable(RESPONSES), r: 0 };
  return { kind, variants: [variant, variant] };
}

function composeAnthropic(
  left: AnthropicSummary,
  right: AnthropicSummary,
): AnthropicSummary {
  const through = (chain: 0 | 1): bigint => {
    const viaRight = right.lastL[left.cOut[chain]];
    return viaRight !== 0n ? viaRight : left.lastL[chain];
  };
  return {
    kind: 'anthropic',
    variants: [
      composeTables(left.variants[0], right.variants[0]),
      composeTables(left.variants[1], right.variants[1]),
    ],
    cOut: [right.cOut[left.cOut[0]], right.cOut[left.cOut[1]]],
    lastL: [through(0), through(1)],
  };
}

function composeChatVariant(
  left: ChatVariant,
  right: ChatVariant,
): ChatVariant {
  return composeAffineTables(left, right, CHAT_MEDIA_PENDING_MASK);
}

function composeChat(left: ChatSummary, right: ChatSummary): ChatSummary {
  return {
    ...(left.tokens === undefined && right.tokens === undefined
      ? {}
      : {
          tokens: [
            (left.tokens?.[0] ?? 0) + (right.tokens?.[0] ?? 0),
            (left.tokens?.[1] ?? 0) + (right.tokens?.[1] ?? 0),
          ] as const,
        }),
    kind: 'chat',
    variants: [
      composeChatVariant(left.variants[0], right.variants[0]),
      composeChatVariant(left.variants[1], right.variants[1]),
    ],
  };
}

function composeResponsesVariant(
  left: ResponsesVariant,
  right: ResponsesVariant,
): ResponsesVariant {
  return { ...composeTables(left, right), r: left.r + right.r };
}

function composeResponses(
  left: ResponsesSummary,
  right: ResponsesSummary,
): ResponsesSummary {
  return {
    kind: 'responses',
    variants: [
      composeResponsesVariant(left.variants[0], right.variants[0]),
      composeResponsesVariant(left.variants[1], right.variants[1]),
    ],
  };
}

export function composeSlotSummaries(
  left: SlotSummary,
  right: SlotSummary,
): SlotSummary {
  if (left.kind === 'anthropic' && right.kind === 'anthropic') {
    return composeAnthropic(left, right);
  }
  if (left.kind === 'chat' && right.kind === 'chat') {
    return composeChat(left, right);
  }
  if (left.kind === 'responses' && right.kind === 'responses') {
    return composeResponses(left, right);
  }
  throw new JournalFormatError(
    `Cannot compose a ${left.kind} summary with a ${right.kind} summary`,
  );
}
