/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { get_encoding } from '@dqbd/tiktoken';
import { countPiece } from './o200k-disk-bpe.js';
import { countPieceInMemory, MAX_HEAP_PIECE_BYTES } from './o200k-heap-bpe.js';
import { countO200kBaseTokens } from './o200kBaseCounter.js';

const encoder = get_encoding('o200k_base');
let root: string;
let counter = 0;

function random(seed: number): () => number {
  let state = seed;
  return () => (state = (state * 1664525 + 1013904223) >>> 0) / 2 ** 32;
}

function randomString(
  next: () => number,
  length: number,
  alphabet: string[],
): string {
  let text = '';
  for (let index = 0; index < length; index++)
    text += alphabet[Math.floor(next() * alphabet.length)];
  return text;
}

async function onDisk(bytes: Buffer): Promise<number> {
  const path = join(root, `piece-${counter++}`);
  writeFileSync(path, bytes);
  return countPiece(path, root, 0, bytes.length);
}

describe('o200k in-memory heap BPE', () => {
  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'o200k-heap-bpe-test-'));
  });
  afterAll(() => {
    encoder.free();
    rmSync(root, { recursive: true, force: true });
  });

  const letters = [...'abcdefghijklmnopqrstuvwxyz'];
  const accented = [...'abcdeéèüñßçαβγдлжя'];
  const cjk = [...'雪日本語の한국어中文字符漢'];
  const alphabets: Array<[string, string[]]> = [
    ['ASCII letters', letters],
    ['two letters', ['a', 'b']],
    ['accented letters', accented],
    ['CJK letters', cjk],
  ];

  it.each([0, 1, 2, 3, 7, 127, 128, 129, 130, 1000, 4096, 16384, 65536])(
    'repeated letter run of %i bytes equals the WASM encoder',
    (size) => {
      const text = 'a'.repeat(size);
      expect(countPieceInMemory(Buffer.from(text))).toBe(
        countO200kBaseTokens(encoder, text),
      );
    },
  );

  for (const [name, alphabet] of alphabets) {
    it.each([1, 5, 33, 400, 5000])(
      `${name}: random pieces of %i characters equal the WASM encoder`,
      (length) => {
        const next = random(length * 31 + alphabet.length);
        for (let round = 0; round < 20; round++) {
          const text = randomString(next, length, alphabet);
          expect(countPieceInMemory(Buffer.from(text))).toBe(
            countO200kBaseTokens(encoder, text),
          );
        }
      },
    );
  }

  it('equals the disk BPE on arbitrary bytes that are not valid UTF-8', async () => {
    const next = random(99);
    for (const size of [1, 2, 9, 200, 3000]) {
      const bytes = Buffer.alloc(size);
      for (let index = 0; index < size; index++)
        bytes[index] = Math.floor(next() * 256);
      expect(countPieceInMemory(bytes)).toBe(await onDisk(bytes));
    }
  });

  it('equals the disk BPE on a piece beyond the WASM piece bound', async () => {
    const next = random(5);
    const text = randomString(next, 40_000, ['a', 'b', 'c', 'ab', 'é', '雪']);
    const bytes = Buffer.from(text);
    expect(countPieceInMemory(bytes)).toBe(await onDisk(bytes));
  });

  it('counts a 64 KiB single-character piece far faster than the disk BPE could', () => {
    const bytes = Buffer.from('a'.repeat(65536));
    const started = performance.now();
    const count = countPieceInMemory(bytes);
    const elapsed = performance.now() - started;
    expect(count).toBe(countO200kBaseTokens(encoder, 'a'.repeat(65536)));
    expect(elapsed).toBeLessThan(500);
  });

  it('rejects a piece beyond the index bound instead of miscounting', () => {
    expect(() =>
      countPieceInMemory(Buffer.alloc(MAX_HEAP_PIECE_BYTES + 1)),
    ).toThrow(RangeError);
  });
});
