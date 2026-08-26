/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import {
  FORCED_SPLIT_RETAINED_LENGTH,
  IncrementalSplitScanner,
  MAX_UNCLOSED_FENCE_LENGTH,
} from '../incrementalSplitScanner.js';
import { PendingResponseBuffer } from '../pendingResponseBuffer.js';

interface StreamResult {
  readonly committed: readonly string[];
  readonly retained: string;
}

function streamBuffer(deltas: readonly string[]): StreamResult {
  const buffer = new PendingResponseBuffer(undefined);
  const committed: string[] = [];

  for (const delta of deltas) {
    buffer.push(delta);
    const stableText = buffer.stableText;
    const splitPoint = buffer.getSplitPoint();
    if (splitPoint !== stableText.length) {
      const prefix = stableText.slice(0, splitPoint);
      if (prefix.length > 0) {
        committed.push(prefix);
      }
      buffer.consume(splitPoint);
    }
  }

  return { committed, retained: buffer.stableText };
}

const STREAM_DELTA = 'word salad goes here and here and here.\n\n';
const STREAM_DELTA_COUNT = 20_000;
const SYNTHESIZED_OPENING = '```typescript\n';
const LONG_FENCE_OPENING = '````typescript\n';

describe('PendingResponseBuffer markdown splitting', () => {
  it('preserves no-fence commit boundaries', () => {
    const result = streamBuffer([
      'Alpha paragraph.\n',
      '\nBeta paragraph.\n\n',
      'Gamma.',
    ]);

    expect(result).toStrictEqual({
      committed: ['Alpha paragraph.\n\nBeta paragraph.\n\n'],
      retained: 'Gamma.',
    });
  });

  it('preserves balanced-fence commit boundaries', () => {
    const result = streamBuffer([
      'Intro.\n\n```ts\n',
      'const a = 1;\n',
      '```\n\n',
      'Tail.\n\n',
      'End.',
    ]);

    expect(result).toStrictEqual({
      committed: ['Intro.\n\n', '```ts\nconst a = 1;\n```\n\nTail.\n\n'],
      retained: 'End.',
    });
  });

  it('bounds an unclosed fence that opens at index zero', () => {
    const deltas = [
      SYNTHESIZED_OPENING,
      ...Array.from({ length: STREAM_DELTA_COUNT }, () => STREAM_DELTA),
    ];
    const original = deltas.join('');

    const result = streamBuffer(deltas);

    expect(result.retained.length).toBeLessThan(original.length);
    expect(result.retained.length).toBeLessThanOrEqual(
      MAX_UNCLOSED_FENCE_LENGTH,
    );
  });

  it('keeps unclosed-fence retention independent of stream length', () => {
    // The defect is retention that GROWS with the stream. Asserting a single
    // stream lands under the limit does not catch that: it would still pass if
    // retention scaled. Doubling the input must not materially move retention.
    const build = (count: number): string[] => [
      SYNTHESIZED_OPENING,
      ...Array.from({ length: count }, () => STREAM_DELTA),
    ];

    const single = streamBuffer(build(STREAM_DELTA_COUNT));
    const double = streamBuffer(build(STREAM_DELTA_COUNT * 2));

    expect(double.retained.length).toBeLessThanOrEqual(
      MAX_UNCLOSED_FENCE_LENGTH,
    );
    // Retention is bounded by the forced-split policy, not by how much arrived,
    // so twice the input must not produce meaningfully more retained text.
    expect(double.retained.length).toBeLessThanOrEqual(
      single.retained.length + FORCED_SPLIT_RETAINED_LENGTH,
    );
  });

  it('reconstructs an unclosed code block across a forced split', () => {
    const deltas = [
      SYNTHESIZED_OPENING,
      ...Array.from({ length: STREAM_DELTA_COUNT }, () => STREAM_DELTA),
    ];
    const original = deltas.join('');

    const result = streamBuffer(deltas);
    const reconstructed =
      result.committed.join('') +
      result.retained.slice(SYNTHESIZED_OPENING.length);

    expect(reconstructed).toBe(original);
  });

  it('retains the original fence and language for code-block continuation', () => {
    const scanner = new IncrementalSplitScanner();
    const original =
      LONG_FENCE_OPENING + STREAM_DELTA.repeat(STREAM_DELTA_COUNT);
    scanner.append('``');
    scanner.append('``type');
    scanner.append('script\n');
    scanner.append(STREAM_DELTA.repeat(STREAM_DELTA_COUNT));

    const splitPoint = scanner.getSplitPoint();
    const committed = scanner.getText().slice(0, splitPoint);
    const retained = scanner.consume(splitPoint);

    expect({
      continuationOpening: retained.slice(0, LONG_FENCE_OPENING.length),
      reconstructed: committed + retained.slice(LONG_FENCE_OPENING.length),
    }).toStrictEqual({
      continuationOpening: LONG_FENCE_OPENING,
      reconstructed: original,
    });
  });
});
