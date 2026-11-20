/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { afterAll, describe, expect, it } from 'bun:test';
import { observeMergeWork } from './merge-work-test-helpers.js';
import { get_encoding } from '@dqbd/tiktoken';
import { countO200kBaseTokens } from './o200kBaseCounter.js';
import { OpenAITokenizer } from './OpenAITokenizer.js';
import { TiktokenRuntime } from './official/tiktokenRuntime.js';
import { AssetLoader } from './official/assetLoader.js';
import {
  GlmTokenizer,
  GLM_MANIFEST,
  GLM_PAT_STR,
} from './official/glmTokenizer.js';
import {
  KimiK3Tokenizer,
  KIMI_K3_MANIFEST,
  KIMI_K3_PAT_STR,
} from './official/kimiK3Tokenizer.js';
import {
  MinimaxTokenizer,
  MINIMAX_MANIFEST,
  MINIMAX_PAT_STR,
} from './official/minimaxTokenizer.js';

const oracle = get_encoding('o200k_base');
function* adversarialInputs(): Generator<string> {
  for (const length of [513, 1025, 2049, 4097]) {
    for (const unit of [
      'x',
      'a',
      'xy',
      'AAAAbbbb',
      '雪',
      '\u{1f600}',
      'e\u0301',
      'abCD09+/',
    ]) {
      const text = unit
        .repeat(Math.ceil(length / unit.length))
        .slice(0, length);
      yield text;
      yield ` {"text":"${text}"} 's\n\u0085\ufeff${text}`;
    }
  }
  const fragments = [
    'abc',
    'XYZ',
    '雪',
    '\u{1f600}',
    'e\u0301',
    ' ',
    '\t',
    '\r\n',
    '\u0085',
    '\ufeff',
    "'S",
    "'RE",
    '/',
    '12345',
    '\u1100\u1161',
    '©',
    '_',
  ];
  let state = 12345;
  for (let sample = 0; sample < 160; sample++) {
    let text = '';
    for (let index = 0; index < 300; index++) {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      text += fragments[state % fragments.length];
    }
    yield text;
    yield Buffer.from(text).toString('base64');
  }
}

const openai = new OpenAITokenizer();
const loader = new AssetLoader();
const official = [
  {
    model: 'glm-5.2',
    manifest: GLM_MANIFEST,
    patStr: GLM_PAT_STR,
    counter: new GlmTokenizer(),
    normalize: (text: string): string => text,
  },
  {
    model: 'kimi-k3',
    manifest: KIMI_K3_MANIFEST,
    patStr: KIMI_K3_PAT_STR,
    counter: new KimiK3Tokenizer(),
    normalize: (text: string): string => text,
  },
  {
    model: 'minimax-m3',
    manifest: MINIMAX_MANIFEST,
    patStr: MINIMAX_PAT_STR,
    counter: new MinimaxTokenizer(),
    normalize: (text: string): string => text.normalize('NFC'),
  },
];
const counters = [
  {
    name: 'o200k',
    count: (text: string): number => countO200kBaseTokens(oracle, text),
    whole: (text: string): number => oracle.encode(text, [], []).length,
  },
  {
    name: 'OpenAI',
    count: (text: string): Promise<number> =>
      openai.countTokens(text, 'gpt-4o'),
    whole: (text: string): number => oracle.encode(text, [], []).length,
  },
  ...official.map(({ model, counter, normalize }) => ({
    name: model,
    count: (text: string): number => counter.countTokens(text),
    whole: (text: string): number => {
      // Public asset configurations supply the exact upstream regex to the oracle.
      const runtime = runtimes.get(model);
      if (runtime === undefined) throw new Error('Missing tokenizer oracle');
      return runtime.encodeOrdinary(normalize(text)).length;
    },
  })),
];
const runtimes = new Map<string, TiktokenRuntime>();
// Keep the oracle on the unchunked WASM path.
for (const { model, manifest, patStr } of official) {
  runtimes.set(
    model,
    new TiktokenRuntime({
      model,
      bpeRanks: loader.loadBpe(model, manifest),
      patStr,
      specialTokens: {},
    }),
  );
}

describe('provider exact linear token counts', () => {
  afterAll(() => {
    oracle.free();
    openai.dispose();
    for (const { counter } of official) counter.dispose();
    for (const runtime of runtimes.values()) runtime.dispose();
  });
  for (const { name, count, whole } of counters) {
    it(`${name} matches the unchunked adversarial oracle`, async () => {
      for (const value of adversarialInputs())
        expect(await count(value)).toBe(whole(value));
    });
    it(`${name} counts 64 KiB and 1 MiB runs with linear work`, async () => {
      const expected = whole('x'.repeat(4096));
      await count('x'.repeat(4096));
      const work: number[] = [];
      for (const size of [65536, 1048576]) {
        const measurement = observeMergeWork();
        const start = performance.now();
        try {
          expect(await count('x'.repeat(size))).toBe(expected * (size / 4096));
          const operations = measurement.operations();
          expect(operations).toBeLessThanOrEqual(size * 8 + 64);
          work.push(operations);
          process.stdout.write(
            JSON.stringify({
              name,
              size,
              operations,
              elapsed: performance.now() - start,
            }) + '\n',
          );
        } finally {
          measurement.restore();
        }
      }
      expect(work[1]).toBeLessThanOrEqual((work[0] + 64) * 16);
    });
  }
  it('rejects whole-prefix rescanning under the merge-work bound with exact final tokens', async () => {
    const size = 4096;
    const expected = oracle.encode('x'.repeat(size), [], []).length;
    const measurement = observeMergeWork();
    try {
      let count = 0;
      for (let end = 256; end <= size; end += 256)
        count = await openai.countTokens('x'.repeat(end), 'gpt-4o');
      const operations = measurement.operations();
      expect(count).toBe(expected);
      expect(operations <= size * 8 + 64).toBe(false);
    } finally {
      measurement.restore();
    }
  });
});
