/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { applicationRetention } from './application-retention.js';
import { trendGrowth, SEND_PEAK_BOUND_BYTES } from './sendPeakMeasurement.js';
import { settledHeap } from '@vybestack/llxprt-code-test-utils/core/settled-heap.js';

describe('application retention measurement', () => {
  it('excludes executable memory without excluding application payloads', () => {
    const measured = applicationRetention({
      version: 3,
      type: 'Inspector',
      nodes: [0, 0, 0, 0, 1, 500000, 1, 0, 2, 4096, 2, 0, 3, 64, 3, 0],
      nodeClassNames: ['root', 'FunctionCodeBlock', 'string', 'Object'],
      edges: [],
      edgeTypes: [],
      edgeNames: [],
    });
    expect(measured).toStrictEqual({ heap: 4160, objects: 1 });
  });

  for (const payload of ['row', 'metadata']) {
    it(`detects one retained ${payload} per send even below the byte allowance`, async () => {
      const held: object[] = [];
      const counts = new Array<number>(6).fill(0);
      const bytes = new Array<number>(6).fill(0);
      for (let send = 0; send < 6; send++) {
        held.push(
          payload === 'row'
            ? {
                speaker: 'human',
                blocks: [
                  { type: 'text', text: `row-${send}-${'x'.repeat(4096)}` },
                ],
              }
            : {
                requestId: send,
                detail: `metadata-${send}-${'x'.repeat(4096)}`,
              },
        );
        await settledHeap();
        const reading = applicationRetention(Bun.generateHeapSnapshot());
        counts[send] = reading.objects;
        bytes[send] = reading.heap;
      }
      expect(held).toHaveLength(6);
      expect(trendGrowth(bytes)).toBeLessThan(SEND_PEAK_BOUND_BYTES);
      expect(trendGrowth(counts)).toBeGreaterThan(0);
    });
  }
});
