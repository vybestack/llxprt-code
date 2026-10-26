/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { heapSize } from 'bun:jsc';
import { settledHeap } from './settled-heap.js';
import { REALISTIC_SESSION_ROWS } from './realistic-session.js';

export type SessionOperation = 'send' | 'record';
export type SessionCheckpoint =
  | 'conversion'
  | 'quarter'
  | 'half'
  | 'three-quarter'
  | 'transport-entry'
  | 'paused-upload'
  | 'body-admission'
  | 'record-append'
  | 'record-ack'
  | 'terminal-publication'
  | 'after-release';

export interface SessionMemoryReading {
  readonly heapBytes: number;
  readonly bufferBytes: number;
  readonly rssBytes: number;
}

export interface SessionMemorySample extends SessionMemoryReading {
  readonly checkpoint: SessionCheckpoint | 'interval';
  readonly mode: 'uncollected' | 'settled';
}

export interface SessionCorpus {
  readonly rowCount: number;
  readonly selectedRowCount: number;
  readonly neutralPayloadBytes: number;
  readonly journalBytes: number;
  readonly selectedPayloadBytes: number;
  readonly largestUnitBytes: number;
}

export interface SessionWireDigest {
  readonly bytes: number;
  readonly sha256: string;
}

export interface SessionProbe {
  checkpoint(phase: SessionCheckpoint): Promise<void>;
  sample(phase: SessionCheckpoint): void;
}

export interface SessionPayloadOwner {
  retain(payload: string | Uint8Array): void;
}

export interface WholeHistoryBufferingControl extends SessionPayloadOwner {
  readonly rowCount: number;
  readonly payloadBytes: number;
  release(): void;
}

export interface PreparedSessionRoute {
  readonly corpus: SessionCorpus;
  readonly reference: SessionWireDigest;
  run(
    probe: SessionProbe,
    owner: SessionPayloadOwner,
  ): Promise<SessionWireDigest>;
  close(): Promise<void>;
}

export interface SessionRouteAdapter {
  readonly routeId: string;
  readonly operation: SessionOperation;
  warmup(): Promise<void>;
  prepare(): Promise<PreparedSessionRoute>;
}

export interface SessionMeasurement extends SessionCorpus {
  readonly routeId: string;
  readonly operation: SessionOperation;
  readonly wireBytes: number;
  readonly wireSha256: string;
  readonly reference: SessionWireDigest;
  readonly baseline: SessionMemoryReading;
  readonly samples: readonly SessionMemorySample[];
  readonly peakHeapGrowthBytes: number;
  readonly peakBufferGrowthBytes: number;
  readonly peakRssGrowthBytes: number;
  readonly boundBytes: number;
}

const MIN_SESSION_BYTES = 60 * 1024 * 1024;
const SEND_CHECKPOINTS: readonly SessionCheckpoint[] = [
  'conversion',
  'quarter',
  'half',
  'three-quarter',
  'transport-entry',
  'paused-upload',
  'body-admission',
  'after-release',
];
const RECORD_CHECKPOINTS: readonly SessionCheckpoint[] = [
  'quarter',
  'half',
  'three-quarter',
  'record-append',
  'record-ack',
  'terminal-publication',
  'after-release',
];

/**
 * JSC heap includes extra memory. external and arrayBuffers overlap, so take
 * their maximum, never their sum. Gate heap and buffers independently; RSS is
 * diagnostic. heapUsed supplements JSC's last-GC heap for uncollected samples.
 */
function memoryReading(): SessionMemoryReading {
  const usage = process.memoryUsage();
  return {
    heapBytes: Math.max(heapSize(), usage.heapUsed),
    bufferBytes: Math.max(usage.external, usage.arrayBuffers),
    rssBytes: usage.rss,
  };
}

export async function createSessionPeakSampler(): Promise<{
  readonly baseline: SessionMemoryReading;
  readonly samples: readonly SessionMemorySample[];
  readonly probe: SessionProbe;
  stop(): void;
}> {
  await settledHeap();
  const baseline = memoryReading();
  const samples: SessionMemorySample[] = [];
  const capture = (
    checkpoint: SessionMemorySample['checkpoint'],
    mode: SessionMemorySample['mode'],
  ): void => {
    samples.push({ ...memoryReading(), checkpoint, mode });
  };
  const interval = setInterval(() => capture('interval', 'uncollected'), 10);
  return {
    baseline,
    samples,
    probe: {
      sample: (phase): void => capture(phase, 'uncollected'),
      checkpoint: async (phase): Promise<void> => {
        capture(phase, 'uncollected');
        await settledHeap();
        capture(phase, 'settled');
      },
    },
    stop: (): void => clearInterval(interval),
  };
}

/** The adapter warms, seeds in bounded batches, and releases seed rows before sampling. */
export async function measureRealisticSession(
  adapter: SessionRouteAdapter,
  owner: SessionPayloadOwner = { retain: (): void => {} },
): Promise<SessionMeasurement> {
  await adapter.warmup();
  const prepared = await adapter.prepare();
  const sampler = await createSessionPeakSampler();
  try {
    const wire = await prepared.run(sampler.probe, owner);
    await sampler.probe.checkpoint('after-release');
    const denominator =
      adapter.operation === 'record'
        ? prepared.corpus.neutralPayloadBytes
        : prepared.corpus.selectedPayloadBytes;
    return {
      ...prepared.corpus,
      routeId: adapter.routeId,
      operation: adapter.operation,
      wireBytes: wire.bytes,
      wireSha256: wire.sha256,
      reference: prepared.reference,
      baseline: sampler.baseline,
      samples: [...sampler.samples],
      peakHeapGrowthBytes: peakDelta(
        sampler.samples,
        sampler.baseline,
        'heapBytes',
      ),
      peakBufferGrowthBytes: peakDelta(
        sampler.samples,
        sampler.baseline,
        'bufferBytes',
      ),
      peakRssGrowthBytes: peakDelta(
        sampler.samples,
        sampler.baseline,
        'rssBytes',
      ),
      boundBytes: Math.floor(denominator / 4),
    };
  } finally {
    sampler.stop();
    await prepared.close();
  }
}

function peakDelta(
  samples: readonly SessionMemorySample[],
  baseline: SessionMemoryReading,
  field: keyof SessionMemoryReading,
): number {
  return samples.reduce(
    (peak, sample) => Math.max(peak, sample[field] - baseline[field]),
    -Infinity,
  );
}

function validReading(reading: SessionMemoryReading): boolean {
  return (
    [reading.heapBytes, reading.bufferBytes, reading.rssBytes].every(
      (value) => Number.isFinite(value) && value >= 0,
    ) &&
    reading.heapBytes > 0 &&
    reading.rssBytes > 0
  );
}

export function sessionMemoryAccepted(
  measurement: SessionMeasurement,
): boolean {
  return (
    validSessionProof(measurement) &&
    measurement.peakHeapGrowthBytes < measurement.boundBytes &&
    measurement.peakBufferGrowthBytes < measurement.boundBytes
  );
}

function validSessionProof(measurement: SessionMeasurement): boolean {
  const checkpoints =
    measurement.operation === 'send' ? SEND_CHECKPOINTS : RECORD_CHECKPOINTS;
  const denominator =
    measurement.operation === 'record'
      ? measurement.neutralPayloadBytes
      : measurement.selectedPayloadBytes;
  const bound = Math.floor(denominator / 4);
  const checks = [
    validCorpus(measurement),
    validReading(measurement.baseline),
    measurement.samples.length > 0,
    measurement.samples.every(validReading),
    checkpoints.every((phase) =>
      ['uncollected', 'settled'].every((mode) =>
        measurement.samples.some(
          (sample) => sample.checkpoint === phase && sample.mode === mode,
        ),
      ),
    ),
    measurement.boundBytes === bound,
    Number.isFinite(measurement.peakHeapGrowthBytes),
    Number.isFinite(measurement.peakBufferGrowthBytes),
    measurement.wireBytes === measurement.reference.bytes,
    measurement.wireSha256 === measurement.reference.sha256,
  ];
  return checks.every((check) => check);
}

function validCorpus(measurement: SessionCorpus): boolean {
  const checks = [
    [
      measurement.rowCount,
      measurement.selectedRowCount,
      measurement.neutralPayloadBytes,
      measurement.journalBytes,
      measurement.selectedPayloadBytes,
      measurement.largestUnitBytes,
    ].every((value) => Number.isSafeInteger(value) && value > 0),
    measurement.rowCount >= measurement.selectedRowCount,
    measurement.selectedRowCount >= REALISTIC_SESSION_ROWS,
    measurement.neutralPayloadBytes >= MIN_SESSION_BYTES,
    measurement.selectedPayloadBytes >= MIN_SESSION_BYTES,
  ];
  return checks.every((check) => check);
}

export function assertSessionMemory(measurement: SessionMeasurement): void {
  if (!sessionMemoryAccepted(measurement)) {
    throw new Error(
      `Session memory acceptance failed: ${JSON.stringify(measurement)}`,
    );
  }
}

export function createWholeHistoryBufferingControl(): WholeHistoryBufferingControl {
  const retained: Uint8Array[] = [];
  let payloadBytes = 0;
  return {
    get rowCount(): number {
      return retained.length;
    },
    get payloadBytes(): number {
      return payloadBytes;
    },
    retain: (payload): void => {
      const copy =
        typeof payload === 'string'
          ? Buffer.from(payload, 'utf8')
          : Buffer.from(payload);
      retained.push(copy);
      payloadBytes += copy.byteLength;
    },
    release: (): void => {
      retained.length = 0;
      payloadBytes = 0;
    },
  };
}

export function assertWholeHistoryControl(
  measurement: SessionMeasurement,
  control: WholeHistoryBufferingControl,
): void {
  const denominator =
    measurement.operation === 'record'
      ? measurement.neutralPayloadBytes
      : measurement.selectedPayloadBytes;
  if (
    control.rowCount !== measurement.selectedRowCount ||
    control.payloadBytes < denominator
  ) {
    throw new Error(
      'Control must retain the complete selected history until after the peak sample',
    );
  }
  if (!validSessionProof(measurement)) {
    throw new Error(
      `Whole-history control has invalid proof: ${JSON.stringify(measurement)}`,
    );
  }
  if (
    sessionMemoryAccepted(measurement) ||
    !(
      measurement.peakHeapGrowthBytes >= measurement.boundBytes ||
      measurement.peakBufferGrowthBytes >= measurement.boundBytes
    )
  ) {
    throw new Error(
      `Whole-history buffering escaped the memory predicate: ${JSON.stringify(measurement)}`,
    );
  }
}
