/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import {
  assertAllZero,
  assertLength,
  getU64,
  getU64Big,
  putU8,
  putU32,
  putU64,
  putU64Big,
  viewOf,
  type Pair,
} from './bytes.js';
import { JournalFormatError } from './errors.js';

/** Every aggregate slot is sized for the largest summary (design 2.5). */
export const SLOT_SUMMARY_BYTES = 296;

export type SummaryKind = 'anthropic' | 'chat' | 'responses';

/**
 * The code each format slot of the slot table stores for the summary it holds
 * (design 2.7). 0 is a slot that has not been assigned a format yet.
 */
export const SUMMARY_KIND_CODE = {
  anthropic: 1,
  chat: 2,
  responses: 3,
} as const satisfies Record<SummaryKind, number>;

/** Per incoming boundary state: bytes written, run or message or item count, outgoing state. */
export interface TransferTable {
  readonly bytes: readonly number[];
  readonly count: readonly number[];
  readonly out: readonly number[];
}

export interface ChatVariant extends TransferTable {
  readonly p: readonly number[];
  /** Bit mask of the 0/1 coefficient, one bit per state. */
  readonly carry: number;
}

export interface ResponsesVariant extends TransferTable {
  /** Reasoning items without a genuine `rs` id (additive). */
  readonly r: number;
}

export interface AnthropicSummary {
  readonly kind: 'anthropic';
  readonly variants: Pair<TransferTable>;
  readonly cOut: Pair<number>;
  readonly lastL: Pair<bigint>;
}

export interface ChatSummary {
  readonly kind: 'chat';
  readonly variants: Pair<ChatVariant>;
  readonly tokens?: Pair<number>;
  readonly thinkingRank?: { readonly units: number; readonly last: number };
}

export interface ResponsesSummary {
  readonly kind: 'responses';
  readonly variants: Pair<ResponsesVariant>;
}

export type SlotSummary = AnthropicSummary | ChatSummary | ResponsesSummary;

/**
 * Offsets inside one 296-byte slot. Each variant starts at `variants[i]`; the
 * table offsets are relative to the variant. `p` and `r` and `carry` follow the
 * `out` table without alignment, as the design table lists them.
 */
export const SLOT_SUMMARY_LAYOUT = {
  anthropic: {
    states: 10,
    variantBytes: 136,
    variants: [0, 136],
    bytes: 0,
    count: 80,
    out: 120,
    cOut: 272,
    lastL: 280,
    /** Byte ranges the format leaves zero. */
    padding: [
      [130, 136],
      [266, 272],
      [274, 280],
    ],
  },
  chat: {
    states: 6,
    variantBytes: 128,
    variants: [0, 128],
    bytes: 0,
    count: 48,
    out: 72,
    p: 78,
    carry: 126,
    padding: [
      [127, 128],
      [255, 256],
      [272, 296],
    ],
  },
  responses: {
    states: 2,
    variantBytes: 32,
    variants: [0, 32],
    bytes: 0,
    count: 16,
    out: 24,
    r: 26,
    padding: [
      [30, 32],
      [62, 64],
      [64, 296],
    ],
  },
} as const;

type TableLayout = {
  readonly states: number;
  readonly bytes: number;
  readonly count: number;
  readonly out: number;
};

function assertStates(
  name: string,
  values: readonly number[],
  states: number,
): void {
  if (values.length !== states) {
    throw new JournalFormatError(
      `${name} needs ${states} entries, got ${values.length}`,
    );
  }
}

function encodeTable(
  view: DataView,
  base: number,
  layout: TableLayout,
  table: TransferTable,
): void {
  assertStates('bytes', table.bytes, layout.states);
  assertStates('count', table.count, layout.states);
  assertStates('out', table.out, layout.states);
  for (let state = 0; state < layout.states; state++) {
    if (table.out[state] >= layout.states) {
      throw new JournalFormatError(
        `out[${state}] ${table.out[state]} is not one of ${layout.states} states`,
      );
    }
    putU64(view, base + layout.bytes + 8 * state, 'bytes', table.bytes[state]);
    putU32(view, base + layout.count + 4 * state, 'count', table.count[state]);
    putU8(view, base + layout.out + state, 'out', table.out[state]);
  }
}

function decodeTable(
  view: DataView,
  base: number,
  layout: TableLayout,
): TransferTable {
  const bytes: number[] = [];
  const count: number[] = [];
  const out: number[] = [];
  for (let state = 0; state < layout.states; state++) {
    const next = view.getUint8(base + layout.out + state);
    if (next >= layout.states) {
      throw new JournalFormatError(
        `out[${state}] ${next} is not one of ${layout.states} states`,
      );
    }
    bytes.push(getU64(view, base + layout.bytes + 8 * state, 'bytes'));
    count.push(view.getUint32(base + layout.count + 4 * state, true));
    out.push(next);
  }
  return { bytes, count, out };
}

function encodeAnthropic(view: DataView, summary: AnthropicSummary): void {
  const at = SLOT_SUMMARY_LAYOUT.anthropic;
  for (const index of [0, 1] as const) {
    encodeTable(view, at.variants[index], at, summary.variants[index]);
    putU8(view, at.cOut + index, 'cOut', summary.cOut[index]);
    putU64Big(view, at.lastL + 8 * index, 'lastL', summary.lastL[index]);
  }
}

function decodeAnthropic(view: DataView): AnthropicSummary {
  const at = SLOT_SUMMARY_LAYOUT.anthropic;
  return {
    kind: 'anthropic',
    variants: [
      decodeTable(view, at.variants[0], at),
      decodeTable(view, at.variants[1], at),
    ],
    cOut: [view.getUint8(at.cOut), view.getUint8(at.cOut + 1)],
    lastL: [getU64Big(view, at.lastL), getU64Big(view, at.lastL + 8)],
  };
}

function encodeChat(view: DataView, summary: ChatSummary): void {
  const at = SLOT_SUMMARY_LAYOUT.chat;
  putU64(view, 256, 'Chat kept tokens', summary.tokens?.[0] ?? 0);
  putU64(view, 264, 'Chat stripped tokens', summary.tokens?.[1] ?? 0);
  if (summary.thinkingRank !== undefined) {
    putU32(view, 272, 'Chat thinking rank revision', 1);
    putU32(view, 276, 'Chat units', summary.thinkingRank.units);
    putU32(view, 280, 'Chat last thinking', summary.thinkingRank.last);
  }
  for (const index of [0, 1] as const) {
    const base = at.variants[index];
    const variant = summary.variants[index];
    encodeTable(view, base, at, variant);
    assertStates('p', variant.p, at.states);
    if (variant.carry >= 1 << at.states) {
      throw new JournalFormatError(
        `carry mask ${variant.carry} has bits beyond its ${at.states} states`,
      );
    }
    variant.p.forEach((offset, state) =>
      putU64(view, base + at.p + 8 * state, 'p', offset),
    );
    putU8(view, base + at.carry, 'carry', variant.carry);
  }
}

function decodeChatVariant(view: DataView, base: number): ChatVariant {
  const at = SLOT_SUMMARY_LAYOUT.chat;
  const carry = view.getUint8(base + at.carry);
  if (carry >= 1 << at.states) {
    throw new JournalFormatError(
      `carry mask ${carry} has bits beyond its ${at.states} states`,
    );
  }
  const p: number[] = [];
  for (let state = 0; state < at.states; state++) {
    p.push(getU64(view, base + at.p + 8 * state, 'p'));
  }
  return { ...decodeTable(view, base, at), p, carry };
}

function encodeResponses(view: DataView, summary: ResponsesSummary): void {
  const at = SLOT_SUMMARY_LAYOUT.responses;
  for (const index of [0, 1] as const) {
    const base = at.variants[index];
    encodeTable(view, base, at, summary.variants[index]);
    putU32(view, base + at.r, 'r', summary.variants[index].r);
  }
}

function decodeResponsesVariant(
  view: DataView,
  base: number,
): ResponsesVariant {
  const at = SLOT_SUMMARY_LAYOUT.responses;
  return {
    ...decodeTable(view, base, at),
    r: view.getUint32(base + at.r, true),
  };
}

export function encodeSlotSummary(summary: SlotSummary): Uint8Array {
  const bytes = new Uint8Array(SLOT_SUMMARY_BYTES);
  const view = viewOf(bytes);
  if (summary.kind === 'anthropic') encodeAnthropic(view, summary);
  else if (summary.kind === 'chat') encodeChat(view, summary);
  else encodeResponses(view, summary);
  return bytes;
}

/**
 * The kind comes from the slot table entry that owns these bytes. A kind that
 * does not match what the slot holds is caught when the bytes use more than
 * the claimed layout (nonzero padding or tail, a state number out of range).
 */
export function decodeSlotSummary(
  bytes: Uint8Array,
  slot: { readonly summaryKind: SummaryKind | null },
): SlotSummary {
  const kind = slot.summaryKind;
  if (kind === null) {
    throw new JournalFormatError(
      'Slot summary belongs to an unassigned format slot',
    );
  }
  assertLength(bytes, SLOT_SUMMARY_BYTES, 'Slot summary');
  const view = viewOf(bytes);
  const ranked = kind === 'chat' && view.getUint32(272, true) === 1;
  for (const [start, end] of SLOT_SUMMARY_LAYOUT[kind].padding) {
    assertAllZero(
      bytes,
      ranked && start === 272 ? 284 : start,
      end,
      `Slot summary ${kind} padding`,
    );
  }
  if (
    ranked &&
    (view.getUint32(276, true) === 0 ||
      view.getUint32(280, true) > view.getUint32(276, true))
  )
    throw new JournalFormatError('Invalid Chat thinking rank');
  if (kind === 'anthropic') return decodeAnthropic(view);
  if (kind === 'chat') {
    const at = SLOT_SUMMARY_LAYOUT.chat;
    return {
      kind,
      ...(ranked
        ? {
            thinkingRank: {
              units: view.getUint32(276, true),
              last: view.getUint32(280, true),
            },
          }
        : {}),
      ...(getU64(view, 256, 'tokens') === 0 && getU64(view, 264, 'tokens') === 0
        ? {}
        : {
            tokens: [
              getU64(view, 256, 'tokens'),
              getU64(view, 264, 'tokens'),
            ] as const,
          }),
      variants: [
        decodeChatVariant(view, at.variants[0]),
        decodeChatVariant(view, at.variants[1]),
      ],
    };
  }
  const at = SLOT_SUMMARY_LAYOUT.responses;
  return {
    kind,
    variants: [
      decodeResponsesVariant(view, at.variants[0]),
      decodeResponsesVariant(view, at.variants[1]),
    ],
  };
}
