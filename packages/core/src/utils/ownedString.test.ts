/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { settledHeap } from '@vybestack/llxprt-code-test-utils/core/settled-heap.js';
import { ownedString } from './ownedString.js';

const MIB = 1024 * 1024;
const RETAINED_BOUND = 4 * MIB;

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

  it('keeps none of the string it was cut from alive', async () => {
    const baseline = await settledHeap();
    let held: string | undefined;
    const store = (): void => {
      held = ownedString(bigText(40 * MIB).slice(0, 200));
    };
    store();
    const afterStore = await settledHeap();

    expect(held).toHaveLength(200);
    expect(afterStore - baseline).toBeLessThan(RETAINED_BOUND);
  });

  it('control: the bare slice keeps the parent alive in the same measurement', async () => {
    const baseline = await settledHeap();
    let held: string | undefined;
    const store = (): void => {
      held = bigText(40 * MIB).slice(0, 200);
    };
    store();
    const afterStore = await settledHeap();

    expect(held).toHaveLength(200);
    expect(afterStore - baseline).toBeGreaterThan(20 * MIB);
  });
});
