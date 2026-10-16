/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { JournalFormatError } from './errors.js';
import {
  SLOT_SUMMARY_BYTES,
  SLOT_SUMMARY_LAYOUT,
  decodeSlotSummary,
  encodeSlotSummary,
  type SlotSummary,
  type SummaryKind,
} from './slotSummary.js';
import { randomSlotSummary } from './__tests__/support/randomRecords.js';
import { SeededRandom } from './__tests__/support/seededRandom.js';

const KINDS: readonly SummaryKind[] = ['anthropic', 'chat', 'responses'];

function viewOf(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

/** Bytes a summary of this kind may use before the zero tail of the 296-byte slot. */
const USED_BYTES: Record<SummaryKind, number> = {
  anthropic: 296,
  chat: 256,
  responses: 64,
};

describe('slot summary', () => {
  it('always occupies the 296 bytes of a slot', () => {
    const random = new SeededRandom(1);
    for (const kind of KINDS) {
      expect(encodeSlotSummary(randomSlotSummary(random, kind)).length).toBe(
        296,
      );
    }
    expect(SLOT_SUMMARY_BYTES).toBe(296);
  });

  it('sizes one variant 136, 128 and 32 bytes and two variants 272, 256 and 64', () => {
    expect(SLOT_SUMMARY_LAYOUT.anthropic.variantBytes).toBe(136);
    expect(SLOT_SUMMARY_LAYOUT.chat.variantBytes).toBe(128);
    expect(SLOT_SUMMARY_LAYOUT.responses.variantBytes).toBe(32);
    expect(2 * SLOT_SUMMARY_LAYOUT.anthropic.variantBytes).toBe(272);
    expect(2 * SLOT_SUMMARY_LAYOUT.chat.variantBytes).toBe(256);
    expect(2 * SLOT_SUMMARY_LAYOUT.responses.variantBytes).toBe(64);
  });

  it('leaves the tail of the slot zero for the smaller formats', () => {
    const random = new SeededRandom(2);
    for (const kind of KINDS) {
      const bytes = encodeSlotSummary(randomSlotSummary(random, kind));
      expect(
        Array.from(bytes.subarray(USED_BYTES[kind])).every((b) => b === 0),
      ).toBe(true);
    }
  });

  it('round-trips randomized summaries of every kind', () => {
    const random = new SeededRandom(3);
    for (let round = 0; round < 200; round++) {
      for (const kind of KINDS) {
        const summary = randomSlotSummary(random, kind);
        expect(
          decodeSlotSummary(encodeSlotSummary(summary), kind),
        ).toStrictEqual(summary);
      }
    }
  });

  it('puts the Anthropic tables at the offsets of the design table', () => {
    const summary = randomSlotSummary(new SeededRandom(4), 'anthropic');
    if (summary.kind !== 'anthropic') throw new Error('kind');
    const bytes = encodeSlotSummary(summary);
    const view = viewOf(bytes);

    for (const [index, base] of [0, 136].entries()) {
      const variant = summary.variants[index];
      for (let state = 0; state < 10; state++) {
        expect(Number(view.getBigUint64(base + 8 * state, true))).toBe(
          variant.bytes[state],
        );
        expect(view.getUint32(base + 80 + 4 * state, true)).toBe(
          variant.count[state],
        );
        expect(bytes[base + 120 + state]).toBe(variant.out[state]);
      }
      expect(Array.from(bytes.subarray(base + 130, base + 136))).toStrictEqual([
        0, 0, 0, 0, 0, 0,
      ]);
    }
    expect(bytes[272]).toBe(summary.cOut[0]);
    expect(bytes[273]).toBe(summary.cOut[1]);
    expect(Array.from(bytes.subarray(274, 280))).toStrictEqual([
      0, 0, 0, 0, 0, 0,
    ]);
    expect(view.getBigUint64(280, true)).toBe(summary.lastL[0]);
    expect(view.getBigUint64(288, true)).toBe(summary.lastL[1]);
  });

  it('puts the chat tables, P offsets and carry mask at the offsets of the design table', () => {
    const summary = randomSlotSummary(new SeededRandom(5), 'chat');
    if (summary.kind !== 'chat') throw new Error('kind');
    const bytes = encodeSlotSummary(summary);
    const view = viewOf(bytes);

    for (const [index, base] of [0, 128].entries()) {
      const variant = summary.variants[index];
      for (let state = 0; state < 6; state++) {
        expect(Number(view.getBigUint64(base + 8 * state, true))).toBe(
          variant.bytes[state],
        );
        expect(view.getUint32(base + 48 + 4 * state, true)).toBe(
          variant.count[state],
        );
        expect(bytes[base + 72 + state]).toBe(variant.out[state]);
        expect(Number(view.getBigUint64(base + 78 + 8 * state, true))).toBe(
          variant.p[state],
        );
      }
      expect(bytes[base + 126]).toBe(variant.carry);
      expect(bytes[base + 127]).toBe(0);
    }
  });

  it('puts the Responses tables and reasoning count at the offsets of the design table', () => {
    const summary = randomSlotSummary(new SeededRandom(6), 'responses');
    if (summary.kind !== 'responses') throw new Error('kind');
    const bytes = encodeSlotSummary(summary);
    const view = viewOf(bytes);

    for (const [index, base] of [0, 32].entries()) {
      const variant = summary.variants[index];
      for (let state = 0; state < 2; state++) {
        expect(Number(view.getBigUint64(base + 8 * state, true))).toBe(
          variant.bytes[state],
        );
        expect(view.getUint32(base + 16 + 4 * state, true)).toBe(
          variant.count[state],
        );
        expect(bytes[base + 24 + state]).toBe(variant.out[state]);
      }
      expect(view.getUint32(base + 26, true)).toBe(variant.r);
      expect(Array.from(bytes.subarray(base + 30, base + 32))).toStrictEqual([
        0, 0,
      ]);
    }
  });

  it('refuses a table with the wrong number of states', () => {
    const summary = randomSlotSummary(new SeededRandom(7), 'responses');
    if (summary.kind !== 'responses') throw new Error('kind');
    const short: SlotSummary = {
      ...summary,
      variants: [{ ...summary.variants[0], bytes: [1] }, summary.variants[1]],
    };

    expect(() => encodeSlotSummary(short)).toThrow(JournalFormatError);
  });

  it('refuses out-of-range state numbers and carry masks', () => {
    const chat = randomSlotSummary(new SeededRandom(8), 'chat');
    if (chat.kind !== 'chat') throw new Error('kind');

    expect(() =>
      encodeSlotSummary({
        ...chat,
        variants: [
          { ...chat.variants[0], out: [0, 0, 0, 0, 0, 6] },
          chat.variants[1],
        ],
      }),
    ).toThrow(/out/);
    expect(() =>
      encodeSlotSummary({
        ...chat,
        variants: [{ ...chat.variants[0], carry: 64 }, chat.variants[1]],
      }),
    ).toThrow(/carry/);
  });

  it('rejects a slot of the wrong length and bytes the format leaves zero', () => {
    const random = new SeededRandom(9);
    const bytes = encodeSlotSummary(randomSlotSummary(random, 'responses'));
    const dirty = bytes.slice();
    dirty[100] = 1;
    const paddingDirty = bytes.slice();
    paddingDirty[30] = 1;

    expect(() =>
      decodeSlotSummary(bytes.subarray(0, 295), 'responses'),
    ).toThrow(/296/);
    expect(() => decodeSlotSummary(dirty, 'responses')).toThrow(/zero/);
    expect(() => decodeSlotSummary(paddingDirty, 'responses')).toThrow(/zero/);
  });
});
