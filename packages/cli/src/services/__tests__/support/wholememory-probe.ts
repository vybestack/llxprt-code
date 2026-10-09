/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { writeFileSync } from 'node:fs';
import { sampleMemoryUsage } from '../../../ui/hooks/memoryTrend/jscMemorySampler.js';

declare const Bun: {
  gc(force: boolean): void;
  generateHeapSnapshot(): { nodes: number[]; nodeClassNames: string[] };
};
export interface HeapCensus {
  heapSize: number;
  extraMemorySize: number;
  bytes: number;
  objects: number;
  arrays: number;
  maps: number;
  sets: number;
  classes: Record<string, { count: number; bytes: number }>;
}

export function heapCensus(snapshotPath?: string): HeapCensus {
  // Bun's process heapUsed reports the last Eden collection, even after a
  // full GC. Read the live JSC size, including backing storage, instead.
  const { heapUsed: heapSize, external: extraMemorySize } = sampleMemoryUsage();
  const snapshot = Bun.generateHeapSnapshot();
  if (
    snapshot.nodes.length % 4 !== 0 ||
    !snapshot.nodeClassNames.includes('Object')
  ) {
    throw new Error('Unsupported Bun heap snapshot layout');
  }
  const result: HeapCensus = {
    heapSize,
    extraMemorySize,
    bytes: 0,
    objects: 0,
    arrays: 0,
    maps: 0,
    sets: 0,
    classes: {},
  };
  for (let index = 0; index < snapshot.nodes.length; index += 4) {
    result.bytes += snapshot.nodes[index + 1];
    const name = snapshot.nodeClassNames[snapshot.nodes[index + 2]];
    const entry = (result.classes[name] ??= { count: 0, bytes: 0 });
    entry.count += 1;
    entry.bytes += snapshot.nodes[index + 1];
    if (name === 'Object') result.objects += 1;
    if (name === 'Array') result.arrays += 1;
    if (name === 'Map') result.maps += 1;
    if (name === 'Set') result.sets += 1;
  }
  if (result.bytes <= 0 || result.objects <= 0)
    throw new Error('Empty heap census');
  if (snapshotPath) writeFileSync(snapshotPath, JSON.stringify(snapshot));
  return result;
}

export async function settleHeap(): Promise<void> {
  for (let turn = 0; turn < 3; turn += 1) {
    await new Promise<void>((resolve) => setImmediate(resolve));
    Bun.gc(true);
  }
}

export async function settledHeapCensus(): Promise<HeapCensus> {
  await settleHeap();
  heapCensus();
  await new Promise<void>((resolve) => setImmediate(resolve));
  Bun.gc(true);
  return heapCensus();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** Independent decode observer includes prepasses, UI and uninstrumented readers.
 * Fixed-size weak sample does not itself allocate O(history) retained state.
 */
export function observeDecodedRows(mode: string): {
  snapshot(): {
    decoded: number;
    sampled: number;
    surviving: number;
    leaked: number;
    mediaSampled: number;
    mediaSurviving: number;
  };
  restore(): void;
} {
  const parse = JSON.parse;
  const samples: Array<WeakRef<object>> = [];
  const retained: object[] = [];
  const closures: Array<() => object> = [];
  const mediaReferences: object[] = [];
  const mediaSamples: Array<WeakRef<object>> = [];
  let decoded = 0;
  const observe = (value: unknown): void => {
    if (!isRecord(value)) return;
    if (typeof value.speaker === 'string' && Array.isArray(value.blocks)) {
      decoded += 1;
      // Sample the first window and then uniformly spaced later decodes.
      if (samples.length < 64) samples.push(new WeakRef(value));
      else if (decoded % 127 === 0)
        samples[(decoded / 127) % 64] = new WeakRef(value);
      if (mode === 'array') retained.push(value);
      if (mode === 'closure') closures.push(() => value);
      for (const block of value.blocks) {
        if (!isRecord(block) || block.encoding !== 'reference') continue;
        if (mediaSamples.length < 64) mediaSamples.push(new WeakRef(block));
        else if (decoded % 127 === 0)
          mediaSamples[(decoded / 127) % 64] = new WeakRef(block);
        if (mode === 'media-reference') mediaReferences.push(block);
      }
      return;
    }
    if (isRecord(value.payload)) {
      observe(value.payload.content);
      observe(value.payload.summary);
    }
  };
  JSON.parse = (text, reviver): unknown => {
    const value: unknown = parse(text, reviver);
    observe(value);
    return value;
  };
  return {
    snapshot: () => ({
      decoded,
      sampled: samples.length,
      surviving: samples.filter((sample) => sample.deref() !== undefined)
        .length,
      leaked:
        retained.length +
        closures.filter((read) => isRecord(read())).length +
        mediaReferences.length,
      mediaSampled: mediaSamples.length,
      mediaSurviving: mediaSamples.filter(
        (sample) => sample.deref() !== undefined,
      ).length,
    }),
    restore: () => {
      JSON.parse = parse;
    },
  };
}
