/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import type { JournalRecordingService } from '../../recording/journalRecordingService.js';
import { open } from 'node:fs/promises';
import {
  decodeJournalHeader,
  JOURNAL_HEADER_BYTES,
} from '../../journal/fileHeader.js';
import {
  decodeTrailerRecord,
  TRAILER_RECORD_BYTES,
} from '../../journal/trailerRecord.js';
import { MUTATION } from '../../journal/recordKinds.js';
import type { JournalSessionOptions } from './journalSession.js';
import { FanoutHarness, textRow } from './__tests__/support/fanout-harness.js';

const harness = new FanoutHarness();

function slowDisk(): JournalSessionOptions {
  return {
    journal: {
      open: async (path, flags) => {
        const handle = await open(path, flags);
        return {
          fd: handle.fd,
          stat: () => handle.stat(),
          truncate: (length) => handle.truncate(length),
          close: () => handle.close(),
          read: (buffer, offset, length, position) =>
            handle.read(buffer, offset, length, position),
          write: async (buffer, offset, length, position) => {
            await new Promise((resolve) => setTimeout(resolve, 20));
            return handle.write(buffer, offset, length, position);
          },
          writev: async (buffers, position) => {
            await new Promise((resolve) => setTimeout(resolve, 20));
            return handle.writev(buffers, position);
          },
        };
      },
    },
  };
}

/** Two origins on one history; the second mirror writes through a slow disk. */
async function twoOriginsWithSlowMirror() {
  const service = harness.history();
  const ownerA = {};
  const ownerB = {};
  const a = harness.recorder('a');
  const b = harness.recorder('b', slowDisk());
  service.add(textRow('seed'));
  await service.attachJournal(a, true, undefined, ownerA);
  await service.attachJournal(b, true, undefined, ownerB);
  return { service, ownerA, ownerB, a, b };
}

function mutationOnDisk(recorder: JournalRecordingService): number {
  const path = recorder.getFilePath();
  if (path === null) throw new Error('mirror was never materialized');
  const bytes = readFileSync(path);
  const header = decodeJournalHeader(bytes.subarray(0, JOURNAL_HEADER_BYTES));
  const offset = bytes.length - TRAILER_RECORD_BYTES;
  return decodeTrailerRecord(bytes.subarray(offset), {
    offset,
    syncMarker: header.syncMarker,
  }).mutation;
}

describe('a mutation is durable in every mirror once the history reports it committed', () => {
  beforeEach(() => harness.setup());
  afterEach(() => harness.teardown());

  it('a clear is on disk in each mirror when waitForCommit resolves', async () => {
    const { service, ownerA, ownerB, a, b } = await twoOriginsWithSlowMirror();
    service.add(textRow('A1'), undefined, ownerA);
    service.add(textRow('B1'), undefined, ownerB);
    await service.waitForCommit();

    await service.clear();
    await service.waitForCommit();

    expect(mutationOnDisk(a)).toBe(MUTATION.pop);
    expect(mutationOnDisk(b)).toBe(MUTATION.pop);
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

    expect(mutationOnDisk(b)).toBe(MUTATION.pop);
    expect(await harness.replayed(a)).toStrictEqual(['seed', 'A1', 'A2']);
    expect(await harness.replayed(b)).toStrictEqual(['seed']);
  });

  it('a replacement is on disk in each mirror when the replacing call resolves', async () => {
    const { service, ownerA, ownerB, a, b } = await twoOriginsWithSlowMirror();
    service.add(textRow('A1'), undefined, ownerA);
    service.add(textRow('B1'), undefined, ownerB);
    await service.waitForCommit();

    await service.replaceAll([]);

    expect(mutationOnDisk(a)).toBe(MUTATION.pop);
    expect(mutationOnDisk(b)).toBe(MUTATION.pop);
    expect(await harness.replayed(a)).toStrictEqual([]);
    expect(await harness.replayed(b)).toStrictEqual([]);
  });
});
