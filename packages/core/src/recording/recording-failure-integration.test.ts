/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { mkdtemp, mkdir, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Storage } from '@vybestack/llxprt-code-settings';
import { HistoryService } from '../services/history/HistoryService.js';
import { SessionPersistenceService } from '../storage/SessionPersistenceService.js';
import { SessionRecordingService } from './SessionRecordingService.js';
import { RecordingIntegration } from './RecordingIntegration.js';
import {
  RecordingFailureReport,
  RecordingFailureNotice,
  RecordingFailureStorageError,
} from './recording-failure-report.js';

async function withRecorder(
  run: (
    integration: RecordingIntegration,
    persistenceDirectory: string,
    recorder: SessionRecordingService,
  ) => Promise<void>,
  failReportStorage = false,
): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'recording-failure-real-'));
  const storage = new Storage(join(root, 'project'));
  const persistenceDirectory = join(storage.getProjectTempDir(), 'chats');
  await mkdir(storage.getProjectTempDir(), { recursive: true });
  await writeFile(persistenceDirectory, 'not a directory');
  const recorder = new SessionRecordingService({
    sessionId: crypto.randomUUID(),
    projectHash: 'failure-contract',
    chatsDir: join(root, 'journal'),
    workspaceDirs: [],
    provider: 'test',
    model: 'test',
  });
  const reportDirectory = join(root, 'blocked-report-storage');
  if (failReportStorage) await writeFile(reportDirectory, 'blocked');
  const integration = new RecordingIntegration(
    recorder,
    new SessionPersistenceService(storage, 'failure-contract'),
    failReportStorage ? reportDirectory : undefined,
  );
  const history = new HistoryService();
  await integration.subscribeToJournal(history);
  await history.addBatch([
    {
      speaker: 'human',
      blocks: [{ type: 'text', text: 'durable row before save failure' }],
    },
  ]);
  try {
    await run(integration, persistenceDirectory, recorder);
  } finally {
    await integration.dispose();
    await recorder.dispose();
    await rm(root, { recursive: true, force: true });
    await rm(storage.getProjectTempDir(), { recursive: true, force: true });
  }
}

async function drain(
  report: RecordingFailureReport,
): Promise<{ failures: number; first: number; last: number }> {
  let failures = 0;
  let first = 0;
  let last = 0;
  for await (const detail of report.details()) {
    if (detail.kind !== 'failure') continue;
    if (failures === 0) first = detail.generation;
    last = detail.generation;
    failures += 1;
  }
  return { failures, first, last };
}

async function observeBoundary(
  integration: RecordingIntegration,
): Promise<{ failures: number; last: number; legacyFailures: number }> {
  try {
    await integration.flushAtTurnBoundary();
  } catch (error: unknown) {
    if (error instanceof RecordingFailureReport)
      return { ...(await drain(error)), legacyFailures: 0 };
    return { failures: 0, last: 0, legacyFailures: 1 };
  }
  return { failures: 0, last: 0, legacyFailures: 0 };
}

describe('real recorder bounded persistence failures', () => {
  for (const count of [512, 8192]) {
    it(`reports ${count} genuine I/O failures then recovers without replaying old generations`, async () => {
      await withRecorder(async (integration, directory, recorder) => {
        let failures = 0;
        let last = 0;
        let legacyFailures = 0;
        for (let index = 0; index < count; index += 1) {
          const outcome = await observeBoundary(integration);
          failures += outcome.failures;
          last = outcome.last;
          legacyFailures += outcome.legacyFailures;
        }
        expect({ failures, last, legacyFailures }).toStrictEqual({
          failures: count,
          last: count,
          legacyFailures: 0,
        });
        await rm(directory);
        await mkdir(directory);
        await expect(
          integration.flushAtTurnBoundary(),
        ).resolves.toBeUndefined();
        const journal = recorder.getFilePath();
        if (journal === null) throw new Error('Missing real journal');
        expect(await readFile(journal, 'utf8')).toContain(
          'durable row before save failure',
        );
      });
    }, 120000);
  }
});
describe('real recorder failure terminal ownership', () => {
  it('propagates a failed diagnostic disk write and stops new persistence admission', async () => {
    await withRecorder(async (integration, directory) => {
      const failure: unknown = await integration
        .flushAtTurnBoundary()
        .catch((error: unknown) => error);
      if (!(failure instanceof RecordingFailureStorageError)) throw failure;
      expect(failure.cause).toBeInstanceOf(Error);
      expect(failure.storageError).toBeInstanceOf(Error);
      await rm(directory);
      await mkdir(directory);
      await expect(integration.flushAtTurnBoundary()).rejects.toBe(failure);
      await expect(integration.dispose()).rejects.toBe(failure);
    }, true);
  });
  it('transfers all concurrent failures once across disposal and shares the disposal promise', async () => {
    await withRecorder(async (integration) => {
      let total = 0;
      const boundaries = Array.from({ length: 32 }, () =>
        integration.flushAtTurnBoundary().catch(async (error: unknown) => {
          if (error instanceof RecordingFailureNotice) return;
          if (!(error instanceof RecordingFailureReport)) throw error;
          const outcome = await drain(error);
          total += outcome.failures;
        }),
      );
      const disposal = integration.dispose();
      const concurrentDisposal = integration.dispose();
      expect(concurrentDisposal === disposal).toBe(true);
      let disposalRejected = false;
      const observedDisposal = disposal.catch(async (error: unknown) => {
        disposalRejected = true;
        if (error instanceof RecordingFailureNotice) return;
        if (!(error instanceof RecordingFailureReport)) throw error;
        const outcome = await drain(error);
        total += outcome.failures;
      });
      await Promise.all([...boundaries, observedDisposal]);
      expect(total).toBe(32);
      expect(disposalRejected).toBe(true);
      await expect(integration.dispose()).resolves.toBeUndefined();
    });
  });
});
