/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { afterAll, describe, expect, it } from 'bun:test';
import { encoding_for_model } from '@dqbd/tiktoken';
import { NeutralMergeQueue } from './neutral-merge-queue.js';
import { estimateTokens } from './toolOutputLimiter.js';
import { countBpePiece, countLongNeutralText } from './neutral-long-piece.js';

class ObservedRanks extends Map<string, number> {
  reads = 0;
  override get(key: string): number | undefined {
    this.reads++;
    return super.get(key);
  }
}

const oracle = encoding_for_model('gpt-4o');

describe('neutral token counting', () => {
  afterAll(() => oracle.free());
  it('reuses token-pair ranks with linear work across large-row counts', () => {
    const results = [16, 32].map((rows) => {
      const ranks = new ObservedRanks([
        ['x', 0],
        ['xx', 1],
        ['xxxx', 2],
        ['xxxxxxxx', 3],
      ]);
      let tokens = 0;
      for (let index = 0; index < rows; index++)
        tokens += countBpePiece(Buffer.from('x'.repeat(65536)), ranks);
      expect(tokens).toBe(rows * 8192);
      expect(ranks.reads).toBeLessThan(rows * 64);
      return ranks.reads;
    });
    expect(results[1]).toBe(results[0] * 2);
  });

  it('batches short pieces into one encoder call at exact boundaries', () => {
    const text = 'cold payload 雪 '.repeat(1800);
    let calls = 0;
    const count = countLongNeutralText(text, (piece) => {
      calls++;
      return oracle.encode(piece).length;
    });
    expect(count).toBe(oracle.encode(text).length);
    expect(calls).toBe(1);
  });
  it('matches the whole encoder on adversarial pieces and boundaries', () => {
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
        for (const value of [
          text,
          ` {"text":"${text}"} 's\n\u0085\ufeff${text}`,
        ])
          expect(estimateTokens(value)).toBe(oracle.encode(value).length);
      }
    }
  });

  it('matches generated mixed runs, base64 and Unicode boundaries', () => {
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
      const base64 = Buffer.from(text).toString('base64');
      expect(estimateTokens(text)).toBe(oracle.encode(text).length);
      expect(estimateTokens(base64)).toBe(oracle.encode(base64).length);
    }
    for (const special of ['<|endoftext|>', '<|endofprompt|>']) {
      const text = 'x'.repeat(1024) + special;
      expect(estimateTokens(text)).toBe(Math.ceil(text.length / 3));
    }
  });

  it('orders newly discovered lower ranks and leftmost ties exactly', () => {
    const queue = new NeutralMergeQueue();
    const keys = Array.from({ length: 4096 }, (_, index) => ({
      rank: 1 + ((index * 7919) % 199998),
      position: (index * 104729) >>> 0,
    }));
    for (const { rank, position } of keys) queue.add(rank, position);
    const expected = keys
      .map(({ rank, position }) => rank * 0x1_0000_0000 + position)
      .sort((a, b) => a - b);
    for (const key of expected) {
      queue.add(0, 0);
      expect(queue.take()).toBe(0);
      expect(queue.take()).toBe(key);
    }
    expect(queue.take()).toBeUndefined();
  });

  it('counts 64 KiB runs exactly with linear scaling', () => {
    estimateTokens('x'.repeat(4096));
    const start = performance.now();
    let total = 0;
    for (let repeat = 0; repeat < 8; repeat++)
      total += estimateTokens('x'.repeat(65536));
    const elapsed = performance.now() - start;
    expect(total).toBe(8 * 8192);
    expect(elapsed).toBeLessThan(1500);
  });
});
