/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { afterEach, describe, expect, it } from 'bun:test';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { SessionRecordingService } from './SessionRecordingService.js';
import { RowOwnership } from './rowOwnership.js';
import type { CommitWatermark, RecordingWriterObservation } from './types.js';

const LIMIT = 8_388_608;
const COUNT_LIMIT = 440;

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

function inspectWatermarks(watermarks: readonly CommitWatermark[]): void {
  for (let index = 1; index < watermarks.length; index += 1) {
    expect(watermarks[index].seq).toBeGreaterThan(watermarks[index - 1].seq);
    expect(watermarks[index].byteOffset).toBeGreaterThan(
      watermarks[index - 1].byteOffset,
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

  it('rejects the same 440-object predicate when an independent consumer retains 441 committed payloads', async () => {
    await runHeldConsumer(fixture);
    expect(fixture.services[0]?.isActive()).toBe(false);
  });
});
