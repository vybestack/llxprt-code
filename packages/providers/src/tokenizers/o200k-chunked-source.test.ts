/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { get_encoding } from '@dqbd/tiktoken';
import {
  countO200kBaseTokensChunked,
  DEFAULT_CHUNKED_TUNING,
  type ChunkedCountTuning,
} from './o200k-chunked-source.js';
import { countO200kBaseTokens } from './o200kBaseCounter.js';

const encoder = get_encoding('o200k_base');
let root: string;
let workspace: string;
let counter = 0;

describe('o200k chunked source counting', () => {
  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'o200k-chunked-test-'));
    workspace = join(root, 'workspace');
    mkdirSync(workspace);
  });
  afterAll(() => {
    encoder.free();
    rmSync(root, { recursive: true, force: true });
  });

  function tuned(overrides: Partial<ChunkedCountTuning>): ChunkedCountTuning {
    return { ...DEFAULT_CHUNKED_TUNING, ...overrides };
  }

  async function chunked(
    text: string,
    tuning: ChunkedCountTuning,
    encoding: 'utf8' | 'utf16le' = 'utf8',
  ): Promise<number> {
    const path = join(root, `source-${counter++}`);
    writeFileSync(path, Buffer.from(text, encoding));
    return countO200kBaseTokensChunked(
      { path, encoding },
      encoder,
      {
        workspaceDirectory: workspace,
      },
      tuning,
    );
  }

  function randomCodePoint(next: () => number): number {
    const pool = next();
    if (pool < 0.5) return 32 + Math.floor(next() * 95);
    if (pool < 0.8) return Math.floor(next() * 0x3000);
    return 0x10000 + Math.floor(next() * 0x2000);
  }

  function random(seed: number): () => number {
    let state = seed;
    return () => (state = (state * 1664525 + 1013904223) >>> 0) / 2 ** 32;
  }

  function mixedText(length: number, seed = 7): string {
    const next = random(seed);
    const fragments = [
      'The quick brown fox jumps over the lazy dog. ',
      "don't We'LL it's I'M you're\u017F",
      '{"id":12345,"name":"item_7","tags":["a","b"],"ok":true}\n',
      'export async function load(key: string): Promise<void> {\n  return;\n}\n',
      '日本語のテキストと한국어 и русский текст ',
      '😀👩‍👩‍👧‍👦🇯🇵 \ud83d\ude00 ',
      '          \n\n\n   \t \u00a0\u2003 ',
      '1234567890 3.14159 0x7fffffff ',
      '!!! ---- ==== //// ',
      '\u0301\u0e01\u0e33 Ünïcödé ǅ ℌ ',
      '\r\n\r\n ',
    ];
    let text = '';
    while (text.length < length)
      text += fragments[Math.floor(next() * fragments.length)];
    return text.slice(0, length);
  }

  const corpora: Array<[string, string]> = [
    ['mixed prose, code and JSON', mixedText(40_000)],
    ['multi-byte and emoji', '雪の日😀👩‍👩‍👧‍👦 héllo wörld 🇯🇵 '.repeat(500)],
    [
      'long whitespace runs',
      `a${' '.repeat(3000)}b${'\n'.repeat(900)}\t \r\n  c`,
    ],
    ['digits', '0123456789'.repeat(2000)],
    ['code', 'const x = (a: number) => a * 31 + 7;\n'.repeat(800)],
    [
      'json',
      JSON.stringify(
        Array.from({ length: 400 }, (_, i) => ({ id: i, s: `v${i}` })),
      ),
    ],
    [
      'contractions',
      "I'm you're we'll they've it's he'd can't WON'T ".repeat(300),
    ],
    ['lone surrogates', 'x\ud800y\udc00z \ud83d '.repeat(300)],
  ];

  describe('chunked o200k exactness', () => {
    const sizes = [1, 2, 7, 64, 1000, 64 * 1024];
    for (const [name, text] of corpora) {
      const expected = countO200kBaseTokens(encoder, text);
      it.each(sizes)(
        `${name}: chunk of %i chars equals the whole-string count`,
        async (chunkChars) => {
          expect(
            await chunked(text, tuned({ chunkChars, wasmPieceChars: 1 << 20 })),
          ).toBe(expected);
        },
      );
      it.each([1, 3, 13, 4096])(
        `${name}: read blocks of %i bytes equal the whole-string count`,
        async (blockBytes) => {
          expect(
            await chunked(
              text,
              tuned({ chunkChars: 97, blockBytes, wasmPieceChars: 1 << 20 }),
            ),
          ).toBe(expected);
        },
      );
      it(`${name}: utf16le sources equal the whole-string count`, async () => {
        expect(
          await chunked(
            text,
            tuned({ chunkChars: 101, blockBytes: 5, wasmPieceChars: 1 << 20 }),
            'utf16le',
          ),
        ).toBe(expected);
      });
    }

    it('cuts on both sides of every surrogate pair and combining mark', async () => {
      const base = mixedText(3000, 11);
      for (let offset = 0; offset < 24; offset++) {
        const text = `${'x'.repeat(offset)}😀👩\u0301${base}`;
        expect(
          await chunked(
            text,
            tuned({ chunkChars: 8, blockBytes: 5, wasmPieceChars: 1 << 20 }),
          ),
        ).toBe(countO200kBaseTokens(encoder, text));
      }
    });

    it('counts random code point soup like the whole string', async () => {
      const next = random(99);
      let text = '';
      for (let index = 0; index < 20_000; index++) {
        const point = randomCodePoint(next);
        text +=
          point >= 0xd800 && point <= 0xdfff
            ? ' '
            : String.fromCodePoint(point);
      }
      expect(
        await chunked(
          text,
          tuned({ chunkChars: 61, blockBytes: 17, wasmPieceChars: 1 << 20 }),
        ),
      ).toBe(countO200kBaseTokens(encoder, text));
    });

    it('counts a piece beyond the WASM piece bound in memory with the same result and no workspace I/O', async () => {
      const text = `${mixedText(500, 3)} ${'a'.repeat(900)} ${mixedText(500, 4)}`;
      const count = await chunked(text, tuned({ wasmPieceChars: 64 }));
      expect(count).toBe(countO200kBaseTokens(encoder, text));
      expect(readdirSync(workspace)).toStrictEqual([]);
    });

    it('counts a piece beyond the heap piece bound on disk with the same result', async () => {
      const text = `${mixedText(500, 3)} ${'a'.repeat(900)} ${mixedText(500, 4)}`;
      const count = await chunked(
        text,
        tuned({ wasmPieceChars: 64, heapPieceBytes: 128 }),
      );
      expect(count).toBe(countO200kBaseTokens(encoder, text));
      expect(readdirSync(workspace)).toStrictEqual([]);
    });

    it('falls back to the disk counter for an undecided tail beyond the memory bound', async () => {
      const text = `${mixedText(300, 5)}${'b'.repeat(700)} tail`;
      const count = await chunked(
        text,
        tuned({ blockBytes: 64, pendingChars: 128 }),
      );
      expect(count).toBe(countO200kBaseTokens(encoder, text));
      expect(readdirSync(workspace)).toStrictEqual([]);
    });

    it('counts an empty source as zero', async () => {
      expect(await chunked('', DEFAULT_CHUNKED_TUNING)).toBe(0);
    });

    it('rejects when the signal is already aborted', async () => {
      const path = join(root, 'aborted');
      writeFileSync(path, 'text');
      await expect(
        countO200kBaseTokensChunked({ path }, encoder, {
          workspaceDirectory: workspace,
          signal: AbortSignal.abort(),
        }),
      ).rejects.toThrow('aborted');
    });
  });

  describe('chunked o200k speed', () => {
    it('estimates 1 MiB of mixed text within the speed floor', async () => {
      const text = mixedText(1024 * 1024, 21);
      const started = performance.now();
      const count = await chunked(text, DEFAULT_CHUNKED_TUNING);
      const elapsed = performance.now() - started;
      expect(count).toBe(countO200kBaseTokens(encoder, text));
      expect(elapsed).toBeLessThan(2000);
    }, 60000);
  });
});
