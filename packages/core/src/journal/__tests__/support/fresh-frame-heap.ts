/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { gcAndSweep, heapSize } from 'bun:jsc';
import { median } from '@vybestack/llxprt-code-test-utils/core/settled-heap.js';

/** Run each full collection in a separate timer callback, read after it, then take the median of three. */
async function freshFrameMedian(read: () => number): Promise<number> {
  const samples: number[] = [];
  for (let sample = 0; sample < 3; sample++) {
    samples.push(
      await new Promise<number>((resolve) => {
        setTimeout(() => {
          gcAndSweep();
          resolve(read());
        }, 0);
      }),
    );
  }
  return median(samples);
}

/** The total heap, read in fresh frames (see {@link freshFrameMedian}). */
export function freshFrameHeap(): Promise<number> {
  return freshFrameMedian(heapSize);
}

/** Heap snapshot classes that hold compiled code and its engine metadata. */
const ENGINE_CODE_CLASSES =
  /CodeBlock|Executable|^Structure(?:RareData)?$|^JSSourceCode$|^SourceCode$|^SymbolTable$|^PropertyTable$/;

/**
 * The application-memory census of the allowance ledger: the bytes of every
 * heap snapshot node except compiled code and its engine metadata.
 * JavaScriptCore drops and recompiles code on its own schedule, which moves
 * the total heap by hundreds of KiB between readings while the objects the
 * application holds stay the same.
 */
export function applicationHeapBytes(): number {
  const snapshot = Bun.generateHeapSnapshot();
  if (snapshot.version !== 3 || snapshot.nodes.length % 4 !== 0)
    throw new Error('Unsupported JSC heap snapshot layout');
  let bytes = 0;
  for (let at = 4; at < snapshot.nodes.length; at += 4) {
    const name = snapshot.nodeClassNames[snapshot.nodes[at + 2]];
    if (!ENGINE_CODE_CLASSES.test(name)) bytes += snapshot.nodes[at + 1];
  }
  return bytes;
}

/** The application census, read in fresh frames (see {@link freshFrameMedian}). */
export function freshFrameApplicationBytes(): Promise<number> {
  return freshFrameMedian(applicationHeapBytes);
}
