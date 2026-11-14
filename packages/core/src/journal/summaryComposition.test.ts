/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { JournalFormatError } from './errors.js';
import {
  decodeSlotSummary,
  encodeSlotSummary,
  type SlotSummary,
  type SummaryKind,
} from './slotSummary.js';
import {
  CHAT_MEDIA_PENDING_MASK,
  composeAffineTables,
  composeSlotSummaries,
  composeTables,
  identityAffineTable,
  identitySlotSummary,
  identityTable,
  type AffineTable,
} from './summaryComposition.js';
import { SeededRandom } from './__tests__/support/seededRandom.js';
import {
  randomAffineTable,
  randomTable,
  randomValidSummary,
} from './__tests__/support/validSummaries.js';

const CASES = 400;
const STATE_COUNTS = [10, 6, 2] as const;
const KINDS: readonly SummaryKind[] = ['anthropic', 'chat', 'responses'];

/** A pending-media mask for each state count: about half of the states have media pending. */
const MASKS: Record<number, number> = {
  10: 0b1101101101,
  6: CHAT_MEDIA_PENDING_MASK,
  2: 0b10,
};

describe('transfer composition without the affine part', () => {
  for (const states of STATE_COUNTS) {
    it(`is associative with an identity for K=${states} on random tables`, () => {
      const random = new SeededRandom(1000 + states);
      const identity = identityTable(states);
      for (let index = 0; index < CASES; index++) {
        const a = randomTable(random, states);
        const b = randomTable(random, states);
        const c = randomTable(random, states);

        expect(composeTables(composeTables(a, b), c)).toStrictEqual(
          composeTables(a, composeTables(b, c)),
        );
        expect(composeTables(identity, a)).toStrictEqual(a);
        expect(composeTables(a, identity)).toStrictEqual(a);
      }
    });
  }

  it('applies the second table to the outgoing state of the first and adds bytes and counts', () => {
    const left = { bytes: [10, 20], count: [1, 2], out: [1, 0] };
    const right = { bytes: [100, 200], count: [5, 6], out: [0, 0] };

    expect(composeTables(left, right)).toStrictEqual({
      bytes: [210, 120],
      count: [7, 7],
      out: [0, 0],
    });
  });

  it('is not commutative, so a swapped order is detectable', () => {
    const random = new SeededRandom(7);
    const a = randomTable(random, 6);
    const b = randomTable(random, 6);

    expect(composeTables(a, b)).not.toStrictEqual(composeTables(b, a));
  });

  it('refuses tables with different state counts', () => {
    expect(() => composeTables(identityTable(6), identityTable(10))).toThrow(
      JournalFormatError,
    );
  });
});

describe('transfer composition with the affine part', () => {
  for (const states of STATE_COUNTS) {
    it(`is associative with an identity for K=${states} with P on random valid tables`, () => {
      const random = new SeededRandom(2000 + states);
      const mask = MASKS[states];
      const identity = identityAffineTable(states, mask);
      const compose = (left: AffineTable, right: AffineTable) =>
        composeAffineTables(left, right, mask);
      for (let index = 0; index < CASES; index++) {
        const a = randomAffineTable(random, states, mask);
        const b = randomAffineTable(random, states, mask);
        const c = randomAffineTable(random, states, mask);

        expect(compose(compose(a, b), c)).toStrictEqual(
          compose(a, compose(b, c)),
        );
        expect(compose(identity, a)).toStrictEqual(a);
        expect(compose(a, identity)).toStrictEqual(a);
      }
    });
  }

  it('charges the pending bytes of the left node to the right node when it does not carry them on', () => {
    // States 0 (no media pending) and 1 (media pending); the mask names state 1.
    const mask = 0b10;
    const toolMedia: AffineTable = {
      bytes: [0, 0],
      count: [0, 0],
      out: [1, 1],
      p: [50, 50],
      carry: 0b10,
    };
    const flush: AffineTable = {
      bytes: [7, 7],
      count: [1, 1],
      out: [0, 0],
      p: [0, 0],
      carry: 0,
    };

    const composed = composeAffineTables(toolMedia, flush, mask);

    expect(composed.bytes).toStrictEqual([57, 57]);
    expect(composed.count).toStrictEqual([1, 1]);
    expect(composed.out).toStrictEqual([0, 0]);
    expect(composed.p).toStrictEqual([0, 0]);
    expect(composed.carry).toBe(0);
  });

  it('keeps the pending bytes for a later flush when the right node carries them on', () => {
    const mask = 0b10;
    const toolMedia: AffineTable = {
      bytes: [0, 0],
      count: [0, 0],
      out: [1, 1],
      p: [50, 50],
      carry: 0b10,
    };

    const composed = composeAffineTables(toolMedia, toolMedia, mask);

    expect(composed.bytes).toStrictEqual([0, 0]);
    expect(composed.p).toStrictEqual([100, 100]);
    expect(composed.carry).toBe(0b10);
  });
});

describe('slot summaries', () => {
  for (const kind of KINDS) {
    it(`composes ${kind} summaries associatively, with an identity, through the codec`, () => {
      const random = new SeededRandom(3000 + kind.length);
      const identity = identitySlotSummary(kind);
      for (let index = 0; index < CASES; index++) {
        const a = randomValidSummary(random, kind);
        const b = randomValidSummary(random, kind);
        const c = randomValidSummary(random, kind);

        expect(
          composeSlotSummaries(composeSlotSummaries(a, b), c),
        ).toStrictEqual(composeSlotSummaries(a, composeSlotSummaries(b, c)));
        expect(composeSlotSummaries(identity, a)).toStrictEqual(a);
        expect(composeSlotSummaries(a, identity)).toStrictEqual(a);
        expect(roundTrip(composeSlotSummaries(a, b))).toStrictEqual(
          composeSlotSummaries(a, b),
        );
      }
    });
  }

  it('threads the Anthropic chain state and the last thinking label through both operands', () => {
    const base = identitySlotSummary('anthropic');
    if (base.kind !== 'anthropic') throw new Error('expected anthropic');
    const left: SlotSummary = { ...base, cOut: [1, 1], lastL: [5n, 0n] };
    const right: SlotSummary = { ...base, cOut: [0, 1], lastL: [0n, 9n] };

    const composed = composeSlotSummaries(left, right);

    if (composed.kind !== 'anthropic') throw new Error('expected anthropic');
    expect(composed.cOut).toStrictEqual([1, 1]);
    // From chain state 0 the left operand leaves state 1, where the right one saw label 9.
    expect(composed.lastL).toStrictEqual([9n, 9n]);
  });

  it('keeps the left label when the right operand saw none', () => {
    const base = identitySlotSummary('anthropic');
    if (base.kind !== 'anthropic') throw new Error('expected anthropic');
    const left: SlotSummary = { ...base, lastL: [5n, 6n] };

    const composed = composeSlotSummaries(left, base);

    if (composed.kind !== 'anthropic') throw new Error('expected anthropic');
    expect(composed.lastL).toStrictEqual([5n, 6n]);
  });

  it('adds the Responses reasoning-id counts', () => {
    const random = new SeededRandom(11);
    const a = randomValidSummary(random, 'responses');
    const b = randomValidSummary(random, 'responses');
    if (a.kind !== 'responses' || b.kind !== 'responses') throw new Error();

    const composed = composeSlotSummaries(a, b);

    if (composed.kind !== 'responses') throw new Error('expected responses');
    expect(composed.variants[0].r).toBe(a.variants[0].r + b.variants[0].r);
    expect(composed.variants[1].r).toBe(a.variants[1].r + b.variants[1].r);
  });

  it('refuses to compose summaries of different kinds', () => {
    expect(() =>
      composeSlotSummaries(
        identitySlotSummary('chat'),
        identitySlotSummary('responses'),
      ),
    ).toThrow(JournalFormatError);
  });
});

function roundTrip(summary: SlotSummary): SlotSummary {
  return decodeSlotSummary(encodeSlotSummary(summary), {
    summaryKind: summary.kind,
  });
}
