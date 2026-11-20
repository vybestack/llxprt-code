/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Issue #854 (review F9): chunked counting of the official tokenizers must
 * equal the whole-string count, over generated text that puts every kind of
 * boundary next to every other.
 */
import { afterAll, describe, expect, it } from 'bun:test';
import { GlmTokenizer } from './glmTokenizer.js';
import { KimiK3Tokenizer } from './kimiK3Tokenizer.js';
import { MinimaxTokenizer } from './minimaxTokenizer.js';
import {
  countAtSafeBoundaries,
  lastSafeCut,
  type SegmentChunkTuning,
} from './official-segment-chunking.js';

interface Counter {
  countTokens(content: unknown): number;
  dispose(): void;
}

const counters: Record<string, Counter> = {
  'glm-5.2': new GlmTokenizer(),
  'minimax-m3': new MinimaxTokenizer(),
  'kimi-k3': new KimiK3Tokenizer(),
};

/** Fragments chosen so each rule's neighbours (and its exceptions) collide. */
const FRAGMENTS = [
  'hello',
  'World',
  'CamelCaseWord',
  "it's",
  "'re",
  "can't",
  "'S",
  ' ',
  '  ',
  '\t',
  '\n',
  '\r\n',
  '\n\n',
  ' \n ',
  '/',
  '//',
  '\n/',
  '!',
  '"',
  '","',
  '{"a":',
  '123',
  '4567890',
  '٣٤٥',
  '²',
  '.',
  '...',
  '雪',
  '你好世界',
  '，',
  '。',
  'こんにちは',
  'カタカナ',
  '안녕',
  '\u1100\u1161\u11a8',
  '\ud55c',
  'é',
  'e\u0301',
  'a\u0323\u0301',
  '\u0301',
  '\u0915\u093c',
  '\u00a0',
  '\u0085',
  '\ufeff',
  '\u200d',
  '\ufe0f',
  '😀',
  '👩\u200d👩',
  '𝒜',
  '\u2000',
  '\u212b',
  '_',
  '-',
  '$',
];

/** Deterministic PRNG so failures reproduce. */
function random(seed: number): () => number {
  let state = Math.max(1, seed >>> 0);
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function corpus(seed: number, fragments: number): string {
  const next = random(seed);
  let text = '';
  for (let i = 0; i < fragments; i++)
    text += FRAGMENTS[Math.floor(next() * FRAGMENTS.length)];
  return text;
}

/** Splits arbitrarily, including inside surrogate pairs, like no real reader. */
async function* randomPieces(
  text: string,
  seed: number,
): AsyncGenerator<string> {
  const next = random(seed);
  for (let at = 0; at < text.length; ) {
    const size = 1 + Math.floor(next() * 40);
    yield text.slice(at, at + size);
    at += size;
  }
}

const SMALL: SegmentChunkTuning = {
  chunkChars: 24,
  maxUnsplittableChars: 1_000_000,
};

describe('official tokenizer chunking is exact (issue #854 F9)', () => {
  afterAll(() => {
    for (const counter of Object.values(counters)) counter.dispose();
  });

  for (const [model, counter] of Object.entries(counters)) {
    it(`${model}: chunked count equals the whole-string count on 250 generated texts`, async () => {
      let chunksCounted = 0;
      for (let seed = 1; seed <= 250; seed++) {
        const text = corpus(seed, 40 + (seed % 90));
        const expected = counter.countTokens(text);
        const actual = await countAtSafeBoundaries(
          randomPieces(text, seed * 7),
          (chunk) => {
            chunksCounted++;
            return counter.countTokens(chunk);
          },
          SMALL,
        );
        expect(actual).toBe(expected);
      }
      // Not vacuous: the corpus is actually cut into many chunks.
      expect(chunksCounted).toBeGreaterThan(1500);
    });

    it(`${model}: control, cutting at arbitrary offsets changes the count`, async () => {
      let mismatches = 0;
      for (let seed = 1; seed <= 40; seed++) {
        const text = corpus(seed, 80);
        const whole = counter.countTokens(text);
        let split = 0;
        for (let at = 0; at < text.length; at += 7)
          split += counter.countTokens(text.slice(at, at + 7));
        if (split !== whole) mismatches++;
      }
      expect(mismatches).toBeGreaterThan(20);
    });

    it(`${model}: long runs without a boundary and CJK prose count exactly`, async () => {
      const options: SegmentChunkTuning = {
        chunkChars: 1024,
        maxUnsplittableChars: 1_000_000,
      };
      for (const text of [
        'a'.repeat(6000),
        '雪'.repeat(6000),
        '😀'.repeat(3000),
        'e\u0301'.repeat(3000),
        '你好世界，这是一个测试。'.repeat(3000),
        `${'x'.repeat(3000)}\n${'y'.repeat(3000)}`,
        'word '.repeat(8000),
      ]) {
        const actual = await countAtSafeBoundaries(
          randomPieces(text, 3),
          (chunk) => counter.countTokens(chunk),
          options,
        );
        expect(actual).toBe(counter.countTokens(text));
      }
    });
  }

  it('cuts long text into bounded chunks and holds only the pending tail', async () => {
    const text = `${'The quick brown fox, 12345 jumps. '.repeat(8000)}`;
    const sizes: number[] = [];
    const total = await countAtSafeBoundaries(
      randomPieces(text, 5),
      (chunk) => {
        sizes.push(chunk.length);
        return chunk.length;
      },
      { chunkChars: 4096, maxUnsplittableChars: 100_000 },
    );
    expect(total).toBe(text.length);
    expect(Math.max(...sizes)).toBeLessThan(4096 + 100);
    expect(sizes.length).toBeGreaterThan(50);
  });
  it('awaits asynchronous counters for full chunks and the final tail', async () => {
    const text = 'word 123, 雪. '.repeat(2000);
    let calls = 0;
    const total = await countAtSafeBoundaries(
      randomPieces(text, 5),
      async (chunk) => {
        await Promise.resolve();
        calls++;
        return chunk.length;
      },
      { chunkChars: 4096, maxUnsplittableChars: 100_000 },
    );
    expect(total).toBe(text.length);
    expect(calls).toBeGreaterThan(1);
  });

  it('fails fast on a run with no exact boundary beyond the limit', async () => {
    await expect(
      countAtSafeBoundaries(randomPieces('a'.repeat(5000), 1), () => 1, {
        chunkChars: 100,
        maxUnsplittableChars: 1000,
      }),
    ).rejects.toThrow('no exact split point');
  });

  it('never cuts between a letter and a mark, a space and a word, or inside a pair', () => {
    expect(lastSafeCut('abc\u0301d')).toBe(-1);
    expect(lastSafeCut('ab\ud835')).toBe(-1);
    expect(lastSafeCut('ab cd')).toBe(2);
    expect(lastSafeCut('ab\u0301')).toBe(-1);
    expect(lastSafeCut('a"b')).toBe(1);
    expect(lastSafeCut('"b')).toBe(-1);
    expect(lastSafeCut("it's")).toBe(-1);
    expect(lastSafeCut('\n/')).toBe(-1);
    expect(lastSafeCut('1😀')).toBe(1);
    expect(lastSafeCut('a😀')).toBe(1);
  });
});
