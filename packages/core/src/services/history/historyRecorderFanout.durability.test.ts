/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { appendFile } from 'node:fs/promises';
import type { RecordingWriterIo } from '../../recording/types.js';
import type { SessionRecordingService } from '../../recording/SessionRecordingService.js';
import { FanoutHarness, textRow } from './__tests__/support/fanout-harness.js';

function lastOf(values: readonly string[]): string | undefined {
  return values[values.length - 1];
}

const harness = new FanoutHarness();

/** A disk that takes a moment per write, so a mirror lags behind the primary. */
const slowDisk: RecordingWriterIo = {
  async appendFile(filePath, data, encoding) {
    await new Promise((resolve) => setTimeout(resolve, 20));
    await appendFile(filePath, data, encoding);
  },
};

/** Two origins on one history; the second mirror writes through a slow disk. */
async function twoOriginsWithSlowMirror() {
  const service = harness.history();
  const ownerA = {};
  const ownerB = {};
  const a = harness.recorder('a');
  const b = harness.recorder('b', slowDisk);
  service.add(textRow('seed'));
  await service.attachJournal(a, true, undefined, ownerA);
  await service.attachJournal(b, true, undefined, ownerB);
  return { service, ownerA, ownerB, a, b };
}

/**
 * The record types on disk in the mirror's file, read synchronously so the
 * recorder gets no turn to drain between the commit and the read.
 */
function typesOnDisk(recorder: SessionRecordingService): string[] {
  const path = recorder.getFilePath();
  if (path === null) throw new Error('mirror was never materialized');
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => (JSON.parse(line) as { type: string }).type);
}

describe('a mutation is durable in every mirror once the history reports it committed', () => {
  beforeEach(() => harness.setup());
  afterEach(() => harness.teardown());

  it('a clear is on disk in each mirror when waitForCommit resolves', async () => {
    const { service, ownerA, ownerB, a, b } = await twoOriginsWithSlowMirror();
    service.add(textRow('A1'), undefined, ownerA);
    service.add(textRow('B1'), undefined, ownerB);
    await service.waitForCommit();

    service.clear();
    await service.waitForCommit();

    expect(lastOf(typesOnDisk(a))).toBe('rewind');
    expect(lastOf(typesOnDisk(b))).toBe('rewind');
    expect(await harness.replayed(a)).toStrictEqual([]);
    expect(await harness.replayed(b)).toStrictEqual([]);
  });

  it('a tail removal is on disk in the mirror that owned the row when waitForCommit resolves', async () => {
    const { service, ownerA, ownerB, a, b } = await twoOriginsWithSlowMirror();
    service.add(textRow('A1'), undefined, ownerA);
    service.add(textRow('A2'), undefined, ownerA);
    service.add(textRow('B1'), undefined, ownerB);
    await service.waitForCommit();

    await service.pop();
    await service.waitForCommit();

    expect(lastOf(typesOnDisk(b))).toBe('rewind');
    expect(await harness.replayed(a)).toStrictEqual(['seed', 'A1', 'A2']);
    expect(await harness.replayed(b)).toStrictEqual(['seed']);
  });

  it('a replacement is on disk in each mirror when the replacing call resolves', async () => {
    const { service, ownerA, ownerB, a, b } = await twoOriginsWithSlowMirror();
    service.add(textRow('A1'), undefined, ownerA);
    service.add(textRow('B1'), undefined, ownerB);
    await service.waitForCommit();

    await service.replaceAll([]);

    expect(lastOf(typesOnDisk(a))).toBe('rewind');
    expect(lastOf(typesOnDisk(b))).toBe('rewind');
    expect(await harness.replayed(a)).toStrictEqual([]);
    expect(await harness.replayed(b)).toStrictEqual([]);
  });
});
