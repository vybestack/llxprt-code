/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { gcAndSweep, heapSize } from 'bun:jsc';
import { median } from '@vybestack/llxprt-code-test-utils/core/settled-heap.js';

/** Run each full collection in a separate timer callback, then take the median. */
export async function freshFrameHeap(): Promise<number> {
  const samples: number[] = [];
  for (let sample = 0; sample < 3; sample++) {
    samples.push(
      await new Promise<number>((resolve) => {
        setTimeout(() => {
          gcAndSweep();
          resolve(heapSize());
        }, 0);
      }),
    );
  }
  return median(samples);
}
