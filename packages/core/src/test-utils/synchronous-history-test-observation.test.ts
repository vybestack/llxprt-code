import { collectRawHistory } from './collect-raw-history.js';
/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { gcAndSweep } from 'bun:jsc';
import { mkdtempSync, rmSync } from 'node:fs';
import { appendFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SessionRecordingService } from '../recording/SessionRecordingService.js';
import { HistoryService } from '../services/history/HistoryService.js';
import type { IContent } from '../services/history/IContent.js';
import {
  suffixRow,
  withSuffixFixture,
} from '../services/history/history-suffix-test-helpers.js';
import { observeHistorySynchronouslyForTest } from './synchronous-history-test-observation.js';

async function withPendingObservation(
  size: number,
  action: (service: HistoryService, original: IContent[]) => void,
): Promise<void> {
  const directory = mkdtempSync(join(tmpdir(), 'sync-history-observation-'));
  let releaseWriter: () => void = (): void => undefined;
  const gate = new Promise<void>((resolve) => {
    releaseWriter = resolve;
  });
  const recorder = new SessionRecordingService({
    sessionId: 'sync-test',
    projectHash: 'sync-test',
    chatsDir: directory,
    workspaceDirs: [directory],
    provider: 'test',
    model: 'test',
    io: {
      appendFile: async (filePath, data, encoding): Promise<void> => {
        await gate;
        await appendFile(filePath, data, encoding);
      },
    },
  });
  const service = new HistoryService({ recording: recorder });
  try {
    const original = Array.from({ length: size }, (_, index) =>
      suffixRow(index, 128),
    );
    await service.addBatch(original);
    action(service, original);
  } finally {
    releaseWriter();
    service.dispose();
    await recorder.dispose();
    rmSync(directory, { recursive: true, force: true });
  }
}

function assertPendingIdentities(
  observed: IContent[],
  reference: IContent[],
  original: IContent[],
): void {
  expect(observed).not.toBe(reference);
  expect(observed).toHaveLength(original.length);
  for (const [index, row] of original.entries()) {
    expect(observed[index]).toBe(row);
    expect(observed[index]).toBe(reference[index]);
    expect(observed[index].blocks).toBe(row.blocks);
    expect(observed[index].metadata).toBe(row.metadata);
  }
}

function assertEventSampling(
  service: HistoryService,
  original: IContent[],
): void {
  let yielded = false;
  queueMicrotask(() => {
    yielded = true;
  });
  const retained = observeHistorySynchronouslyForTest(service);
  assertPendingIdentities(retained, original.slice(), original);
  expect(yielded).toBe(false);
  const queued = suffixRow(original.length);
  const events: Array<{ name: string; rows: IContent[] }> = [];
  for (const name of [
    'compressionLockReleased',
    'compressionEnded',
    'contentAdded',
  ]) {
    service.on(name, () => {
      events.push({ name, rows: observeHistorySynchronouslyForTest(service) });
    });
  }
  service.startCompression();
  service.add(queued);
  expect(observeHistorySynchronouslyForTest(service)).toHaveLength(
    original.length,
  );
  service.endCompression(suffixRow(original.length + 1), 1);
  expect(events.map(({ name, rows }) => [name, rows.length])).toStrictEqual([
    ['compressionLockReleased', original.length],
    ['compressionEnded', original.length],
    ['contentAdded', original.length + 1],
  ]);
  expect(events[2].rows[original.length]).toBe(queued);
  expect(yielded).toBe(false);
  const rebuilt = suffixRow(original.length + 2);
  service.rebuildWith(() => {
    service.clear();
    service.add(rebuilt);
  });
  const afterCut = observeHistorySynchronouslyForTest(service);
  expect(afterCut).toStrictEqual([rebuilt]);
  expect(afterCut[0]).toBe(rebuilt);
  expect(afterCut[0].metadata?.chronology?.seq).toBeGreaterThan(
    retained[original.length - 1].metadata?.chronology?.seq ?? 0,
  );
  gcAndSweep();
  gcAndSweep();
  // These arrays are test-owned identity oracles, not memory acceptance evidence.
  assertPendingIdentities(retained, original, original);
  expect(yielded).toBe(false);
}

describe('test-only same-turn history observation', () => {
  for (const size of [512, 8192]) {
    it(`keeps pending identities and event-time samples through a cut marker and GC at ${size} rows`, async () => {
      await withPendingObservation(size, (service, original) => {
        assertEventSampling(service, original);
        expect(observeHistorySynchronouslyForTest(service)[0]).toStrictEqual(
          suffixRow(size + 2),
        );
      });
    }, 120_000);

    it(`reads the same durable sequence with fresh decoded objects at ${size} rows`, async () => {
      await withSuffixFixture(
        size,
        async (service) => {
          const observed = observeHistorySynchronouslyForTest(service);
          const reference = await collectRawHistory(service);
          expect(observed).toHaveLength(size);
          expect(observed).toStrictEqual(reference);
          for (let index = 0; index < size; index++) {
            expect(observed[index]).toStrictEqual(suffixRow(index));
            expect(observed[index]).not.toBe(reference[index]);
          }
          service.clear();
          expect(observeHistorySynchronouslyForTest(service)).toStrictEqual([]);
          await service.waitForCommit();
          gcAndSweep();
          expect(
            observed.map((row) => row.metadata?.chronology?.seq),
          ).toStrictEqual(
            Array.from({ length: size }, (_, index) => index + 1),
          );
          expect(observed[size - 1]).toStrictEqual(suffixRow(size - 1));
        },
        0,
        suffixRow,
        undefined,
        (options) => new HistoryService(options),
      );
    }, 120_000);
  }
});
