/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { recordMemoryGate } from '../journal/__tests__/support/memory-gate-evidence.js';
import { settledHeap } from '@vybestack/llxprt-code-test-utils/core/settled-heap.js';
import { ownedString } from './ownedString.js';

const MIB = 1024 * 1024;
const PREVIEW_BYTES = Buffer.byteLength('x'.repeat(200));
/** Smallest 200-byte fixture peak on 2026-11-13, before the parent-size comparison. */
const FIXED_OVERHEAD_BYTES = 4_272;
/** UTF-16 input and output copies of the owned preview, never its parent. */
const PREVIEW_ENCODING_FACTOR = 4;
const RETAINED_BOUND =
  FIXED_OVERHEAD_BYTES + PREVIEW_ENCODING_FACTOR * PREVIEW_BYTES;

/** Text of `bytes` characters built from distinct pieces so it is a real allocation. */
function bigText(bytes: number): string {
  const pieces: string[] = [];
  for (let at = 0, index = 0; at < bytes; at += MIB, index++) {
    pieces.push(
      index
        .toString(36)
        .padStart(6, '0')
        .repeat(MIB / 6),
    );
  }
  return pieces.join('').slice(0, bytes);
}

describe('ownedString', () => {
  it('returns the same characters', () => {
    expect(ownedString('')).toBe('');
    expect(ownedString('héllo \u{1F600} world')).toBe('héllo \u{1F600} world');
  });

  it.each([200, 2 * MIB])(
    'keeps none of the %i-byte string it was cut from alive',
    async (bytes) => {
      const baseline = await settledHeap();
      let held: string | undefined;
      const store = (): void => {
        held = ownedString(bigText(bytes).slice(0, 200));
      };
      store();
      const afterStore = await settledHeap();

      expect(held).toHaveLength(200);
      recordMemoryGate('ownedString', { bytes, peak: afterStore - baseline });
      expect(afterStore - baseline).toBeLessThan(RETAINED_BOUND);
    },
  );

  it('control: the bare slice keeps the parent alive in the same measurement', async () => {
    const baseline = await settledHeap();
    let held: string | undefined;
    const store = (): void => {
      held = bigText(2 * MIB).slice(0, 200);
    };
    store();
    const afterStore = await settledHeap();

    expect(held).toHaveLength(200);
    recordMemoryGate('ownedString-control', {
      bytes: 2 * MIB,
      peak: afterStore - baseline,
    });
    expect(afterStore - baseline).toBeGreaterThan(MIB);
    expect(afterStore - baseline).toBeGreaterThan(3 * RETAINED_BOUND);
  });
});
