/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import {
  buildSendPeakRows,
  SEND_PEAK_SHAPES,
  SEND_PEAK_SIZES,
  streamSendPeakRows,
} from './sendPeakShapes.js';

describe('streamed native memory corpus', () => {
  for (const shape of SEND_PEAK_SHAPES) {
    for (const size of SEND_PEAK_SIZES) {
      it(`preserves every original ${shape} ${size} row`, () => {
        const original = buildSendPeakRows(shape, size);
        let index = 0;
        for (const row of streamSendPeakRows(shape, size)) {
          expect(row).toStrictEqual(original[index++]);
        }
        expect(index).toBe(original.length);
      });
    }
  }
});
