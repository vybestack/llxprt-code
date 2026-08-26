/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import { IncrementalSplitScanner } from '../incrementalSplitScanner.js';
import { findLastSafeSplitPoint } from '../../../utils/markdownUtilities.js';

/** Deterministic PRNG so failures are reproducible. */
function createRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function chunk(text: string, random: () => number): string[] {
  const chunks: string[] = [];
  let index = 0;
  while (index < text.length) {
    const size = 1 + Math.floor(random() * 7);
    chunks.push(text.slice(index, index + size));
    index += size;
  }
  return chunks;
}

const CORPUS: ReadonlyArray<readonly [string, string]> = [
  ['plain prose', 'Hello there.\n\nSecond paragraph.\n\nThird paragraph here.'],
  ['no paragraph breaks', 'One single line of prose with no breaks at all.'],
  ['empty', ''],
  [
    'unterminated fence at end',
    'Here is some code:\n\n```ts\nconst a = 1;\n\nconst b = 2;\n',
  ],
  [
    'terminated fence then prose',
    'Intro text.\n\n```js\nconst x = 1;\n```\n\nTrailing prose paragraph.\n\nMore.',
  ],
  [
    'paragraph breaks inside fence only',
    'Lead in.\n\n```\nline\n\nline two\n\nline three\n```',
  ],
  [
    'multiple consecutive fences',
    'a\n\n```\nx\n```\n\nb\n\n```\ny\n```\n\nc\n\n```\nz\n',
  ],
  ['entirely one fence', '```python\nprint(1)\n\nprint(2)\n'],
  ['fence at very start terminated', '```\nq\n```\n\ntail paragraph'],
  ['backtick runs', 'a ```` b ``` c\n\nd `````\n\ne'],
  ['inline backticks only', 'Use `code` and ``double`` here.\n\nNext para.'],
  ['triple newlines', 'a\n\n\nb\n\n\n\nc'],
  ['trailing double newline', 'paragraph one.\n\n'],
  ['leading double newline', '\n\nparagraph one.'],
  ['only newlines', '\n\n\n\n'],
  ['fence marker split friendly', 'text\n\n``\n\nmore text\n\n`'],
  [
    'long mixed document',
    Array.from({ length: 40 }, (_, i) =>
      i % 5 === 3
        ? '```sh\necho "block ' + i + '"\n\necho done\n```'
        : 'Paragraph number ' + i + ' with some words in it.',
    ).join('\n\n'),
  ],
];

describe('IncrementalSplitScanner', () => {
  describe('matches findLastSafeSplitPoint for every chunking', () => {
    for (const [name, text] of CORPUS) {
      it(`agrees on "${name}"`, () => {
        const expected = findLastSafeSplitPoint(text);
        for (let seed = 1; seed <= 25; seed += 1) {
          const scanner = new IncrementalSplitScanner();
          for (const piece of chunk(text, createRandom(seed))) {
            scanner.append(piece);
          }
          expect({ seed, splitPoint: scanner.getSplitPoint() }).toStrictEqual({
            seed,
            splitPoint: expected,
          });
        }
      });
    }
  });

  it('agrees after every single-character prefix of a document', () => {
    const text =
      'Intro.\n\n```ts\nconst a = 1;\n\nconst b = 2;\n```\n\nOutro paragraph.\n\nEnd.';
    const scanner = new IncrementalSplitScanner();
    for (let i = 0; i < text.length; i += 1) {
      scanner.append(text[i]);
      expect({
        prefixLength: i + 1,
        splitPoint: scanner.getSplitPoint(),
      }).toStrictEqual({
        prefixLength: i + 1,
        splitPoint: findLastSafeSplitPoint(text.slice(0, i + 1)),
      });
    }
  });

  it('agrees with the batch function on the remaining tail after consume', () => {
    const text =
      'First paragraph.\n\nSecond paragraph.\n\n```\ncode\n\nmore\n```\n\nThird.\n\n';
    const scanner = new IncrementalSplitScanner();
    scanner.append(text);

    const splitPoint = scanner.getSplitPoint();
    expect(splitPoint).toBe(findLastSafeSplitPoint(text));

    const tail = scanner.consume(splitPoint);
    expect(tail).toBe(text.slice(splitPoint));
    expect(scanner.getSplitPoint()).toBe(findLastSafeSplitPoint(tail));

    const continuation = 'Continued prose.\n\nAnd more prose.';
    scanner.append(continuation);
    expect(scanner.getSplitPoint()).toBe(
      findLastSafeSplitPoint(tail + continuation),
    );
  });

  interface RepeatedConsumeCycleObservation {
    readonly incrementalStates: ReadonlyArray<{
      readonly text: string;
      readonly splitPoint: number;
    }>;
    readonly batchStates: ReadonlyArray<{
      readonly text: string;
      readonly splitPoint: number;
    }>;
  }

  const observeRepeatedConsumeCyclesAcrossUnterminatedFence =
    (): RepeatedConsumeCycleObservation => {
      const pieces = [
        'Alpha paragraph.\n\n',
        'Beta paragraph.\n\n',
        '```ts\nconst value = 1;\n\n',
        'const other = 2;\n\n',
        '```\n\n',
        'Gamma paragraph.\n\n',
      ];
      const scanner = new IncrementalSplitScanner();
      const incrementalStates: Array<{ text: string; splitPoint: number }> = [];
      const batchStates: Array<{ text: string; splitPoint: number }> = [];
      let reference = '';

      for (const piece of pieces) {
        scanner.append(piece);
        reference += piece;
        incrementalStates.push({
          text: scanner.getText(),
          splitPoint: scanner.getSplitPoint(),
        });
        batchStates.push({
          text: reference,
          splitPoint: findLastSafeSplitPoint(reference),
        });

        const splitPoint = findLastSafeSplitPoint(reference);
        const commits = splitPoint > 0 && splitPoint < reference.length ? 1 : 0;
        reference = commits === 1 ? reference.slice(splitPoint) : reference;
        scanner.consume(commits === 1 ? splitPoint : 0);
        incrementalStates.push({
          text: scanner.getText(),
          splitPoint: scanner.getSplitPoint(),
        });
        batchStates.push({
          text: reference,
          splitPoint: findLastSafeSplitPoint(reference),
        });
      }

      return { incrementalStates, batchStates };
    };

  it('agrees after repeated consume cycles across an unterminated fence', () => {
    const consumeCycles = observeRepeatedConsumeCyclesAcrossUnterminatedFence();

    expect(consumeCycles.incrementalStates).toStrictEqual(
      consumeCycles.batchStates,
    );
  });

  it('resets all carried state', () => {
    const scanner = new IncrementalSplitScanner();
    scanner.append('para.\n\n```\nopen fence\n');
    scanner.reset();
    scanner.append('fresh.\n\ncontent.');
    expect({
      text: scanner.getText(),
      splitPoint: scanner.getSplitPoint(),
    }).toStrictEqual({
      text: 'fresh.\n\ncontent.',
      splitPoint: findLastSafeSplitPoint('fresh.\n\ncontent.'),
    });
  });

  it('scans each character a bounded number of times', () => {
    // Worst case for the batch implementation: one long unterminated fence, so
    // every delta would rescan the whole accumulated block.
    const body = 'const value = 1;\n'.repeat(12_000);
    const text = '```ts\n' + body;
    const scanner = new IncrementalSplitScanner();
    for (let index = 0; index < text.length; index += 4) {
      scanner.append(text.slice(index, index + 4));
    }

    expect(scanner.getSplitPoint()).toBe(findLastSafeSplitPoint(text));
    expect(scanner.charactersScanned).toBeLessThan(text.length * 2);
  });
});
