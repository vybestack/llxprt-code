/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { afterAll, describe, expect, it } from 'bun:test';
import { encoding_for_model } from '@dqbd/tiktoken';
import { NeutralTextStream } from './neutral-text-stream.js';
import { countSimpleTextStream } from './simple-text-stream.js';
import { simpleTokenEstimateForText } from '../services/history/historyTokenEstimation.js';

const oracle = encoding_for_model('gpt-4o');
function streamed(text: string, size: number): number {
  const stream = new NeutralTextStream();
  const bytes = Buffer.from(text);
  for (let offset = 0; offset < bytes.length; offset += size)
    stream.append(bytes.subarray(offset, offset + size));
  return stream.finish();
}

describe('bounded neutral text tokenization', () => {
  afterAll(() => oracle.free());
  it('preserves the core heuristic over split whitespace and UTF-8', async () => {
    for (const text of [
      '',
      '  one two  ',
      '雪\u{1f600}',
      String.fromCharCode(32, 9, 13, 10),
      'word '.repeat(2000),
    ]) {
      async function* parts(): AsyncGenerator<Uint8Array> {
        for (const byte of Buffer.from(text)) yield Uint8Array.of(byte);
      }
      expect(await countSimpleTextStream(parts())).toBe(
        simpleTokenEstimateForText(text),
      );
    }
  });
  it('matches the whole-text oracle across Unicode and grammar boundaries', () => {
    const cases = [
      '',
      'hello world',
      'AAAAbbbbCCCdddd',
      "we're I'LL snow's don't I'D",
      '雪ABC 雪ABCdef 雪ABC 雪',
      ' \t  word',
      ' \t 123',
      ' \t !!',
      '\n   word',
      ' \n \t \n    X',
      '\r\n/\r /',
      '\ufeff\u0085 snow',
      '😀é中e\u0301ABC\u0301DEf',
      '<|endoftext|> <|endofprompt|>',
      JSON.stringify({
        name: 'shell',
        parameters: { command: 'echo 雪', n: 1234567 },
      }),
      ...['a', 'XYZ', '雪', ' ', '\t', '!/', '\n '].map((unit) =>
        unit.repeat(2049),
      ),
      '雪' + 'ABC'.repeat(2049),
      '\n' + ' '.repeat(2049) + 'word',
    ];
    for (const text of cases)
      for (const size of [1, 2, 3, 7, 64, 65536])
        expect(streamed(text, size)).toBe(oracle.encode(text, [], []).length);
  });

  it('preserves accepted prefixes when long alternatives stop or backtrack', () => {
    for (const length of [63, 64, 65, 511, 512, 513, 2049])
      for (const suffix of [
        "'RE next",
        String.fromCharCode(10, 32, 9) + ' word',
        '雪ABCdef',
        '123 /',
      ]) {
        const text = 'a'.repeat(length) + suffix;
        const expected = oracle.encode(text, [], []).length;
        for (const size of [1, 128, 65536])
          expect(streamed(text, size)).toBe(expected);
      }
  });

  it('matches generated mixed-category corpora at every byte-sized seam', () => {
    const fragments = [
      'abc',
      'XYZ',
      '雪',
      '😀',
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
    let seed = 854;
    for (let sample = 0; sample < 80; sample++) {
      let text = '';
      for (let index = 0; index < 50; index++) {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        text += fragments[seed % fragments.length];
      }
      const expected = oracle.encode(text, [], []).length;
      for (const size of [1, 3, 17])
        expect(streamed(text, size)).toBe(expected);
    }
  });
});
