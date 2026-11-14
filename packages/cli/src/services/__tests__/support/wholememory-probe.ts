/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { writeFileSync } from 'node:fs';
import { sampleMemoryUsage } from '../../../ui/hooks/memoryTrend/jscMemorySampler.js';

declare const Bun: {
  generateHeapSnapshot(): { nodes: number[]; nodeClassNames: string[] };
};
export interface HeapCensus {
  heapSize: number;
  runtimeHeapSize: number;
  extraMemorySize: number;
  bytes: number;
  objects: number;
  arrays: number;
  maps: number;
  sets: number;
  classes: Record<string, { count: number; bytes: number }>;
}

interface JscSweepApi {
  gcAndSweep: () => number;
}

function isJscSweepApi(value: unknown): value is JscSweepApi {
  return (
    typeof value === 'object' &&
    value !== null &&
    'gcAndSweep' in value &&
    typeof value.gcAndSweep === 'function'
  );
}

function loadJscSweepApi(): JscSweepApi {
  const jsc: unknown = process.getBuiltinModule('bun:jsc');
  if (!isJscSweepApi(jsc)) throw new Error('bun:jsc gcAndSweep is unavailable');
  return jsc;
}

const jsc = loadJscSweepApi();

// A plain full collection leaves dead cells unswept, and the JSC heap size
// still counts them until the lazy sweeper runs. That makes a baseline read
// right after the collection depend on sweeper timing, so every collection in
// this harness sweeps as well.
function collectAndSweep(): void {
  jsc.gcAndSweep();
}

/**
 * Snapshot node sizes count live cells and their owned backing storage once.
 * Keep the runtime aggregate separate: on Linux its delta can fall below a
 * live store's byteLength even when that store is fully present in the census.
 */
export function heapCensus(snapshotPath?: string): HeapCensus {
  const { heapUsed: runtimeHeapSize, external: extraMemorySize } =
    sampleMemoryUsage();
  const snapshot = Bun.generateHeapSnapshot();
  if (
    snapshot.nodes.length % 4 !== 0 ||
    !snapshot.nodeClassNames.includes('Object')
  ) {
    throw new Error('Unsupported Bun heap snapshot layout');
  }
  const result: HeapCensus = {
    heapSize: 0,
    runtimeHeapSize,
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
  result.heapSize = result.bytes;
  if (snapshotPath) writeFileSync(snapshotPath, JSON.stringify(snapshot));
  for (const value of Object.values(snapshot))
    if (Array.isArray(value)) value.length = 0;
  return result;
}

export async function settleHeap(): Promise<void> {
  for (let turn = 0; turn < 3; turn += 1) {
    await new Promise<void>((resolve) => setImmediate(resolve));
    collectAndSweep();
  }
}

const STABLE_WINDOW_BYTES = 64 * 1024;
const STABLE_ROUNDS = 2;
const MAX_SETTLE_ROUNDS = 12;

/**
 * Collect until two consecutive full collections leave both heap counters
 * within STABLE_WINDOW_BYTES of each other. A single collection can leave
 * garbage from the preceding census (its snapshot arrays, finished test
 * frames) unswept on some platforms, which inflates a baseline taken
 * immediately afterward and makes a later live payload read smaller than it is.
 * The bounded loop only waits for release; it never subtracts from a reading.
 */
async function collectUntilStable(): Promise<void> {
  let stable = 0;
  let previous = sampleMemoryUsage();
  for (let round = 0; round < MAX_SETTLE_ROUNDS; round += 1) {
    await new Promise<void>((resolve) => setImmediate(resolve));
    collectAndSweep();
    const current = sampleMemoryUsage();
    const settled =
      Math.abs(current.heapUsed - previous.heapUsed) < STABLE_WINDOW_BYTES &&
      Math.abs(current.external - previous.external) < STABLE_WINDOW_BYTES;
    stable = settled ? stable + 1 : 0;
    previous = current;
    if (stable >= STABLE_ROUNDS) return;
  }
}

// Kept out of settledHeapCensus so the discarded warm-up snapshot is not a
// local of the frame that goes on to take the reading.
function warmCensus(): void {
  heapCensus();
}

async function censusAfterSettling(): Promise<HeapCensus> {
  await settleHeap();
  warmCensus();
  await collectUntilStable();
  const census = heapCensus();
  await collectUntilStable();
  const memory = sampleMemoryUsage();
  return {
    ...census,
    runtimeHeapSize: memory.heapUsed,
    extraMemorySize: memory.external,
  };
}

/**
 * Measured on Bun 1.3.14: the first census after other work still reads
 * 0.3 MiB to 1.9 MiB above the heap that the next fully settled census reports,
 * with identical live data. Only the second reading is the converged one, so
 * the first is taken and dropped.
 */
export async function settledHeapCensus(): Promise<HeapCensus> {
  await censusAfterSettling();
  return censusAfterSettling();
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
