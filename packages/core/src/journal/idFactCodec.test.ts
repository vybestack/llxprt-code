/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'bun:test';
import { JournalFormatError } from './errors.js';
import {
  EMPTY_ID_FACT,
  ID_FACT_MAX_BYTES,
  decodeIdFact,
  encodeIdFact,
  type BlockPosition,
  type IdFact,
} from './idFactCodec.js';
import {
  decodeCountValue,
  decodeHashValue,
  decodeOccurrenceValue,
  decodeRelocationValue,
  decodeUnitPositionValue,
  encodeCountValue,
  encodeHashValue,
  encodeOccurrenceValue,
  encodeRelocationValue,
  encodeUnitPositionValue,
} from './idEntryCodecs.js';
import { ID_HASH_BYTES, ID_VALUE_MAX_BYTES } from './idTrieNode.js';
import {
  ID_NS,
  occurrenceKey,
  fact0Key,
  kimiExceptionKey,
  mistralUsedKey,
  normalizedKey,
  relocationKey,
  sha256KeyHash,
} from './idKeys.js';
import { SeededRandom } from './__tests__/support/seededRandom.js';

function position(random: SeededRandom): BlockPosition {
  return {
    label: random.bigBits(40),
    part: random.int(2),
    block: random.int(1000),
  };
}

function randomFact(random: SeededRandom): IdFact {
  const maybe = (): BlockPosition | undefined =>
    random.int(2) === 0 ? undefined : position(random);
  const best = maybe();
  const eligible = maybe();
  return {
    firstCall: maybe(),
    firstAiCall: maybe(),
    firstResponse: maybe(),
    firstToolResponse: maybe(),
    best,
    bestScore: best === undefined ? 0 : random.int(256),
    lastEligibleCall:
      eligible === undefined
        ? undefined
        : { at: eligible, nameLen: random.int(100) },
    callCount: random.int(1000),
    respCount: random.int(1000),
    aiWire: random.int(1000),
    unnamed: random.int(1000),
    nonAiElig: random.int(1000),
    mappedRef: random.int(2) === 0 ? 0 : 1 + random.bits(40),
  };
}

describe('IdFact codec', () => {
  it('round-trips random facts', () => {
    const random = new SeededRandom(21);
    for (let at = 0; at < 300; at++) {
      const fact = randomFact(random);
      expect(decodeIdFact(encodeIdFact(fact))).toStrictEqual(fact);
    }
  });

  it('is 107 bytes at most, with every position, and fits the value bound', () => {
    const random = new SeededRandom(22);
    const full: IdFact = {
      ...EMPTY_ID_FACT,
      firstCall: position(random),
      firstAiCall: position(random),
      firstResponse: position(random),
      firstToolResponse: position(random),
      best: position(random),
      bestScore: 3,
      lastEligibleCall: { at: position(random), nameLen: 9 },
      mappedRef: 77,
    };
    const size = encodeIdFact(full).length;
    expect(size).toBe(2 + 6 * 12 + 1 + 4 + 5 * 4 + 8);
    expect(size).toBe(ID_FACT_MAX_BYTES);
    expect(ID_FACT_MAX_BYTES).toBeLessThanOrEqual(ID_VALUE_MAX_BYTES);
    expect(encodeIdFact(EMPTY_ID_FACT).length).toBe(2 + 5 * 4);
  });

  it('refuses a part above 1, a score without a best, and a missing nameLen', () => {
    const random = new SeededRandom(23);
    expect(() =>
      encodeIdFact({
        ...EMPTY_ID_FACT,
        firstCall: { label: 1n, part: 2, block: 0 },
      }),
    ).toThrow(JournalFormatError);
    expect(() => encodeIdFact({ ...EMPTY_ID_FACT, bestScore: 4 })).toThrow(
      JournalFormatError,
    );
    expect(() =>
      encodeIdFact({
        ...EMPTY_ID_FACT,
        firstCall: position(random),
        mappedRef: -1,
      }),
    ).toThrow(JournalFormatError);
  });

  it('refuses damaged bytes on decode', () => {
    const random = new SeededRandom(24);
    const bytes = encodeIdFact({
      ...randomFact(random),
      firstCall: position(random),
      mappedRef: 0,
    });
    expect(() => decodeIdFact(bytes.subarray(0, bytes.length - 1))).toThrow(
      JournalFormatError,
    );
    expect(() => decodeIdFact(Uint8Array.from([...bytes, 0]))).toThrow(
      JournalFormatError,
    );
    const reserved = bytes.slice();
    reserved[1] |= 0xe0;
    expect(() => decodeIdFact(reserved)).toThrow(JournalFormatError);
    expect(() => decodeIdFact(new Uint8Array(1))).toThrow(JournalFormatError);
  });
});

describe('value codecs of the other namespaces', () => {
  it('round-trips counts, unit positions, occurrences, hashes and relocations', () => {
    const random = new SeededRandom(25);
    expect(decodeCountValue(encodeCountValue(123_456))).toBe(123_456);
    const unit = { label: random.bigBits(50), part: 1, unit: 7 };
    expect(
      decodeUnitPositionValue(encodeUnitPositionValue(unit)),
    ).toStrictEqual(unit);
    const occurrence = {
      at: position(random),
      eligible: true,
      ai: false,
    };
    expect(
      decodeOccurrenceValue(encodeOccurrenceValue(occurrence)),
    ).toStrictEqual(occurrence);
    const hash = random.bytes(ID_HASH_BYTES);
    expect(decodeHashValue(encodeHashValue(hash))).toStrictEqual(hash);
    expect(decodeRelocationValue(encodeRelocationValue(9_876_543_210))).toBe(
      9_876_543_210,
    );
  });

  it('refuses wrong lengths and set reserved bits', () => {
    expect(() => decodeCountValue(new Uint8Array(3))).toThrow(
      JournalFormatError,
    );
    expect(() => decodeUnitPositionValue(new Uint8Array(12))).toThrow(
      JournalFormatError,
    );
    expect(() => decodeOccurrenceValue(new Uint8Array(14).fill(0xff))).toThrow(
      JournalFormatError,
    );
    expect(() => decodeHashValue(new Uint8Array(15))).toThrow(
      JournalFormatError,
    );
    expect(() => decodeRelocationValue(new Uint8Array(7))).toThrow(
      JournalFormatError,
    );
  });
});

describe('trie keys', () => {
  it('numbers the namespaces as design 3.3 does', () => {
    expect(ID_NS).toStrictEqual({
      fact: 0,
      openai: 1,
      anthropic: 2,
      mistralUsed: 3,
      occurrence: 4,
      kimiException: 5,
      relocation: 6,
      mistralScopeMapping: 7,
      mistralScopeUsed: 8,
    });
  });

  it('hashes SHA-256 of the namespace byte then the key bytes, to 128 bits', () => {
    const key = new TextEncoder().encode('call_abc');
    const zero = sha256KeyHash(ID_NS.fact, key);
    const one = sha256KeyHash(ID_NS.openai, key);
    expect(zero.length).toBe(ID_HASH_BYTES);
    expect(Buffer.from(zero).toString('hex')).not.toBe(
      Buffer.from(one).toString('hex'),
    );
    const expected = createHash('sha256')
      .update(Uint8Array.from([0, ...key]))
      .digest()
      .subarray(0, ID_HASH_BYTES);
    expect(Buffer.from(zero).toString('hex')).toBe(
      Buffer.from(expected).toString('hex'),
    );
  });

  it('gives every namespace and every part of a composite key its own bytes', () => {
    const seen = new Set<string>();
    const add = (ns: number, key: Uint8Array): void => {
      seen.add(`${ns}:${Buffer.from(key).toString('hex')}`);
    };
    add(ID_NS.fact, fact0Key('x'));
    add(ID_NS.openai, normalizedKey(0, 0, 'x'));
    add(ID_NS.openai, normalizedKey(1, 0, 'x'));
    add(ID_NS.openai, normalizedKey(0, 1, 'x'));
    add(ID_NS.openai, normalizedKey(0, 0, 'xx'));
    add(ID_NS.occurrence, occurrenceKey(0, 1, 'x'));
    add(ID_NS.occurrence, occurrenceKey(1, 1, 'x'));
    add(ID_NS.occurrence, occurrenceKey(0, 2, 'x'));
    add(ID_NS.mistralUsed, mistralUsedKey(0, 'abcdefghi'));
    add(ID_NS.mistralUsed, mistralUsedKey(1, 'abcdefghi'));
    add(ID_NS.kimiException, kimiExceptionKey(0));
    add(ID_NS.kimiException, kimiExceptionKey(1));
    add(ID_NS.relocation, relocationKey(0));
    add(ID_NS.relocation, relocationKey(1));
    expect(seen.size).toBe(14);
  });

  it('keeps the empty id and call_ distinct raw keys', () => {
    expect(Buffer.from(fact0Key('')).toString('hex')).not.toBe(
      Buffer.from(fact0Key('call_')).toString('hex'),
    );
  });
});
