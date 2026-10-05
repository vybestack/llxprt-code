/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { afterEach, describe, expect, it } from 'bun:test';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  DEFAULT_MAX_QUEUE_BYTES,
  SessionRecordingService,
} from './SessionRecordingService.js';
import { RowOwnership } from './rowOwnership.js';
import type { CommitWatermark, RecordingWriterObservation } from './types.js';

const LIMIT = 8_388_608;
const COUNT_LIMIT = 440;
const PAYLOAD_COUNT = 12;
const TEXT_BYTES = 720_000;

interface Sample {
  readonly phase: string;
  readonly callerRows: number;
  readonly callerBytes: number;
  readonly preContentBytes: number;
  readonly queueBytes: number;
  readonly queuedRecords: number;
  readonly queuedStrings: number;
  readonly queuedStringBytes: number;
  readonly unregisteredBlockedCandidates: number;
  readonly batchCount: number;
  readonly batchSharesQueueIdentity: boolean;
  readonly joinedBytes: number;
  readonly pendingAcks: number;
  readonly lastAckedSeq: number;
  readonly lastByteOffset: number;
  readonly transientLogicalBytes: number;
  readonly combinedBytes: number;
  readonly combinedObjects: number;
}

function sampleOf(
  observation: RecordingWriterObservation,
  ownership: RowOwnership,
): Sample {
  const rows = ownership.snapshot();
  const unique = new Set([...observation.preContent, ...observation.queue]);
  for (const entry of observation.batch) unique.add(entry);
  const queuedStringBytes = [...unique].reduce(
    (sum, entry) => sum + Buffer.byteLength(entry.json, 'utf8'),
    0,
  );
  const joinedBytes =
    observation.lines === null
      ? 0
      : Buffer.byteLength(observation.lines, 'utf8');
  return {
    phase: observation.phase,
    callerRows: rows.liveRows,
    callerBytes: rows.liveSerializedBytes,
    preContentBytes: observation.preContentBytes,
    queueBytes: observation.queueBytes,
    queuedRecords: unique.size,
    queuedStrings: unique.size,
    queuedStringBytes,
    unregisteredBlockedCandidates:
      observation.phase === 'append' && observation.lastAckedSeq === 0
        ? Math.max(0, rows.liveRows - observation.pendingAcks)
        : 0,
    batchCount: observation.batch.length,
    batchSharesQueueIdentity:
      observation.batch.length > 0 &&
      observation.batch[0] === observation.queue[0],
    joinedBytes,
    pendingAcks: observation.pendingAcks,
    lastAckedSeq: observation.lastAckedSeq,
    lastByteOffset: observation.lastByteOffset,
    transientLogicalBytes: queuedStringBytes + joinedBytes,
    combinedBytes: rows.liveSerializedBytes + queuedStringBytes + joinedBytes,
    combinedObjects:
      rows.liveRows + unique.size * 2 + (joinedBytes > 0 ? 1 : 0),
  };
}

interface HeldAppend {
  readonly data: string;
  release(): void;
}

class PausedWriter {
  private readonly pending: HeldAppend[] = [];
  private readonly held = new Set<HeldAppend>();
  private arrived: (() => void) | null = null;
  private releaseFuture = false;

  readonly io = {
    appendFile: (filePath: string, data: string, _encoding: 'utf8') =>
      new Promise<void>((resolve, reject) => {
        const entry = {
          data,
          release: () => {
            this.held.delete(entry);
            void fs.appendFile(filePath, data, 'utf8').then(resolve, reject);
          },
        };
        if (this.releaseFuture) {
          entry.release();
          return;
        }
        this.held.add(entry);
        this.pending.push(entry);
        this.arrived?.();
        this.arrived = null;
      }),
  };

  async next(): Promise<HeldAppend> {
    if (this.pending.length === 0) {
      await new Promise<void>((resolve) => {
        this.arrived = resolve;
      });
    }
    const next = this.pending.shift();
    if (next === undefined) throw new Error('append signal without append');
    return next;
  }

  releasePending(): void {
    this.releaseFuture = true;
    for (const entry of this.held) entry.release();
    this.pending.length = 0;
  }
}

interface Fixture {
  readonly dirs: string[];
  readonly services: SessionRecordingService[];
  readonly writers: PausedWriter[];
}

async function makeService(
  fixture: Fixture,
  writer: PausedWriter,
  observeWriter?: (state: RecordingWriterObservation) => void,
): Promise<SessionRecordingService> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'p05d-queue-peak-'));
  fixture.dirs.push(dir);
  fixture.writers.push(writer);
  const service = new SessionRecordingService({
    sessionId: crypto.randomUUID(),
    projectHash: 'peak-q',
    chatsDir: dir,
    workspaceDirs: [],
    provider: 'test',
    model: 'test',
    io: writer.io,
    observeWriter,
  });
  fixture.services.push(service);
  return service;
}

function payloadFor(index: number): {
  readonly chronologyId: string;
  readonly text: string;
} {
  return {
    chronologyId: `bind-${index}`,
    text: `${String(index).padStart(2, '0')}:${'x'.repeat(TEXT_BYTES - 3)}`,
  };
}

function inspectWatermarks(watermarks: readonly CommitWatermark[]): void {
  for (let index = 1; index < watermarks.length; index += 1) {
    expect(watermarks[index].seq).toBeGreaterThan(watermarks[index - 1].seq);
    expect(watermarks[index].byteOffset).toBeGreaterThan(
      watermarks[index - 1].byteOffset,
    );
  }
}

function assertPause(
  pre: Sample,
  paused: Sample,
  first: HeldAppend,
  outcomes: readonly number[],
  service: SessionRecordingService,
  ownership: RowOwnership,
): void {
  expect(pre.phase).toBe('pre-content');
  expect(pre.preContentBytes).toBeGreaterThan(0);
  expect(pre.queueBytes).toBe(0);
  expect(paused.phase).toBe('append');
  expect(paused.callerRows).toBe(PAYLOAD_COUNT);
  expect(paused.queueBytes + paused.preContentBytes).toBeLessThanOrEqual(
    DEFAULT_MAX_QUEUE_BYTES,
  );
  expect(paused.queueBytes + paused.preContentBytes).toBeGreaterThan(
    DEFAULT_MAX_QUEUE_BYTES - TEXT_BYTES,
  );
  expect(paused.batchCount).toBeGreaterThan(0);
  expect(paused.batchSharesQueueIdentity).toBe(true);
  expect(paused.joinedBytes).toBe(Buffer.byteLength(first.data, 'utf8'));
  expect(paused.queuedStrings).toBe(paused.batchCount);
  expect(paused.queuedRecords).toBe(paused.batchCount);
  expect(paused.unregisteredBlockedCandidates).toBe(1);
  expect(paused.pendingAcks).toBe(PAYLOAD_COUNT - 1);
  expect(paused.lastAckedSeq).toBe(0);
  expect(paused.lastByteOffset).toBe(0);
  expect(outcomes).toStrictEqual([]);
  expect(service.getLastEnqueuedSequence()).toBe(PAYLOAD_COUNT);
  expect(ownership.within({ rows: COUNT_LIMIT, serializedBytes: LIMIT })).toBe(
    false,
  );
  expect(paused.transientLogicalBytes).toBeGreaterThan(LIMIT);
  expect(paused.combinedBytes).toBeGreaterThan(LIMIT);
  expect(paused.combinedObjects).toBeLessThanOrEqual(COUNT_LIMIT);
}

function isEnvelope(value: unknown): value is {
  readonly type: string;
  readonly payload: { readonly chronologyId?: string };
} {
  if (typeof value !== 'object' || value === null) return false;
  if (!('type' in value) || !('payload' in value)) return false;
  if (typeof value.type !== 'string') return false;
  const payload = value.payload;
  return typeof payload === 'object' && payload !== null;
}

async function verifyJournal(service: SessionRecordingService): Promise<void> {
  const file = service.getFilePath();
  if (file === null) throw new Error('commit did not materialize the journal');
  const raw = await fs.readFile(file, 'utf8');
  const parsed: unknown[] = raw
    .trimEnd()
    .split('\n')
    .map((line) => JSON.parse(line));
  if (!parsed.every(isEnvelope)) throw new Error('invalid journal envelope');
  expect(parsed.map((line) => line.type)).toStrictEqual([
    'session_start',
    ...Array.from({ length: PAYLOAD_COUNT }, () => 'chronology_bind'),
  ]);
  expect(
    parsed.slice(1).map((line) => line.payload.chronologyId),
  ).toStrictEqual(
    Array.from({ length: PAYLOAD_COUNT }, (_, index) => `bind-${index}`),
  );
}

async function runQueuePause(fixture: Fixture): Promise<void> {
  const writer = new PausedWriter();
  const ownership = new RowOwnership();
  const samples: Sample[] = [];
  const service = await makeService(fixture, writer, (state) => {
    samples.push(sampleOf(state, ownership));
  });
  const outcomes: number[] = [];
  const commits = Array.from({ length: PAYLOAD_COUNT }, (_, index) => {
    const payload = payloadFor(index);
    ownership.retain(payload);
    return service.commit('chronology_bind', payload).then((watermark) => {
      outcomes.push(watermark.seq);
      ownership.release(payload);
      return watermark;
    });
  });
  const first = await writer.next();
  if (samples.length === 0) throw new Error('writer never observed admission');
  const paused = samples[samples.length - 1];
  assertPause(samples[0], paused, first, outcomes, service, ownership);
  first.release();
  const second = await writer.next();
  const resumed = samples[samples.length - 1];
  expect(resumed.phase).toBe('append');
  expect(resumed.pendingAcks).toBe(1);
  expect(resumed.lastAckedSeq).toBe(PAYLOAD_COUNT);
  expect(resumed.lastByteOffset).toBe(Buffer.byteLength(first.data, 'utf8'));
  expect(resumed.queueBytes).toBe(Buffer.byteLength(second.data, 'utf8'));
  expect(outcomes).toContain(2);
  expect(outcomes).not.toContain(PAYLOAD_COUNT + 1);
  second.release();
  const watermarks = await Promise.all(commits);
  inspectWatermarks(watermarks);
  expect(outcomes).toStrictEqual(watermarks.map((mark) => mark.seq));
  expect(service.getPendingByteCount()).toBe(0);
  expect(ownership.snapshot().liveRows).toBe(0);
  await verifyJournal(service);
  await service.dispose();
  const closed = {
    registered: ownership.snapshot(),
    pendingRecords: service.getPendingRecordCount(),
    pendingBytes: service.getPendingByteCount(),
    lastWriterSample: samples[samples.length - 1],
  };
  expect(closed.registered.liveSerializedBytes).toBe(0);
  expect(closed.lastWriterSample.queuedStrings).toBe(0);
  expect(closed.lastWriterSample.joinedBytes).toBe(0);
  const peakCombinedBytes = Math.max(
    ...samples.map((item) => item.combinedBytes),
  );
  const peakCombinedObjects = Math.max(
    ...samples.map((item) => item.combinedObjects),
  );
  expect(peakCombinedBytes).toBeGreaterThan(LIMIT);
  expect(peakCombinedObjects).toBeLessThanOrEqual(COUNT_LIMIT);
  const evidence = process.env['LLXPRT_PEAK_EVIDENCE_PATH'];
  if (evidence !== undefined) {
    await fs.writeFile(
      evidence,
      JSON.stringify(
        {
          paused,
          resumed,
          closed,
          peakCombinedBytes,
          peakCombinedObjects,
          samples,
          watermarks,
        },
        null,
        2,
      ),
    );
  }
}

async function runHeldConsumer(fixture: Fixture): Promise<void> {
  const writer = new PausedWriter();
  const ownership = new RowOwnership();
  const service = await makeService(fixture, writer);
  const consumers: object[] = [];
  const commits = Array.from({ length: COUNT_LIMIT + 1 }, (_, index) => {
    const payload = { chronologyId: `consumer-${index}` };
    ownership.retain(payload);
    ownership.retain(payload);
    consumers.push(payload);
    return service.commit('chronology_bind', payload).then((watermark) => {
      ownership.release(payload);
      return watermark;
    });
  });
  await writer.next();
  writer.releasePending();
  inspectWatermarks(await Promise.all(commits));
  await service.dispose();
  const held = ownership.snapshot();
  expect(held.liveRows).toBe(COUNT_LIMIT + 1);
  expect(held.liveSerializedBytes).toBeLessThan(LIMIT);
  expect(ownership.within({ rows: COUNT_LIMIT, serializedBytes: LIMIT })).toBe(
    false,
  );
  const shallowCopy = { ...consumers[0] };
  ownership.retain(shallowCopy);
  const copied = ownership.snapshot();
  expect(copied.liveRows).toBe(COUNT_LIMIT + 2);
  expect(copied.liveSerializedBytes - held.liveSerializedBytes).toBe(
    Buffer.byteLength(JSON.stringify(shallowCopy), 'utf8'),
  );
  ownership.release(shallowCopy);
  for (const payload of consumers) ownership.release(payload);
  const released = ownership.snapshot();
  expect(released.liveRows).toBe(0);
  expect(released.liveSerializedBytes).toBe(0);
  const evidence = process.env['LLXPRT_PEAK_EVIDENCE_PATH'];
  if (evidence !== undefined) {
    await fs.writeFile(
      path.join(path.dirname(evidence), 'queue-q-control.json'),
      JSON.stringify({ held, copied, released }, null, 2),
    );
  }
}

describe('real recording queue controlled-pause logical peak, issue #854 Q', () => {
  const fixture: Fixture = { dirs: [], services: [], writers: [] };
  afterEach(async () => {
    for (const writer of fixture.writers.splice(0)) writer.releasePending();
    for (const service of fixture.services.splice(0)) await service.dispose();
    for (const dir of fixture.dirs.splice(0)) {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('rejects the unchanged combined peak bound while a batch and backpressured callers coexist', async () => {
    await runQueuePause(fixture);
    expect(fixture.services[0]?.getPendingRecordCount()).toBe(0);
  });

  it('rejects the same 440-object predicate when an independent consumer retains 441 committed payloads', async () => {
    await runHeldConsumer(fixture);
    expect(fixture.services[0]?.isActive()).toBe(false);
  });
});
