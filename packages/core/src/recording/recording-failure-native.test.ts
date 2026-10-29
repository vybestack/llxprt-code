/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { mkdir, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { HistoryService } from '../services/history/HistoryService.js';
import {
  rejected,
  useNativeFailureIntegration,
} from './__tests__/support/native-failure-fixture.js';
import {
  nativeText,
  recordedRows,
} from './__tests__/support/native-integration-fixture.js';
import { JournalRecordingService } from './journalRecordingService.js';
import { withRecordingFailureReport } from './recording-failure-consumer.js';
import {
  RecordingFailureNotice,
  RecordingFailureReport,
  RecordingFailureStorageError,
} from './recording-failure-report.js';
import { RecordingIntegration } from './RecordingIntegration.js';
import { resumeSession } from './resumeSession.js';

function reportsOf(error: unknown): RecordingFailureReport[] {
  if (error instanceof RecordingFailureReport) return [error];
  if (error instanceof AggregateError) return error.errors.flatMap(reportsOf);
  return [];
}

async function consume(error: unknown): Promise<number[]> {
  const generations: number[] = [];
  for (const report of reportsOf(error)) {
    for await (const detail of report.details())
      if (detail.kind === 'failure') generations.push(detail.generation);
  }
  return generations;
}

describe('native recording failure report contracts', () => {
  const fixture = useNativeFailureIntegration();

  for (const count of [512, 8192]) {
    it(`reports ${count} genuine native failures once in generation order and resumes through reopen`, async () => {
      const { history, integration, recording, control, reports, directory } =
        fixture();
      const failure = new Error('native positional persistence failure');
      control.writeError = failure;
      history.add(nativeText('rejected row'));
      for (let index = 0; index < count; index += 1) {
        const error = await rejected(integration.flushAtTurnBoundary());
        if (!(error instanceof RecordingFailureReport)) throw error;
        expect(error.cause).toBe(failure);
        expect(await consume(error)).toStrictEqual([index + 2]);
      }
      expect(await readdir(reports)).toStrictEqual([]);
      await integration.dispose();
      expect(await recordedRows(recording)).toStrictEqual([
        nativeText('durable baseline'),
      ]);
      const path = recording.getFilePath();
      if (path === null) throw new Error('Missing native journal');
      await recording.dispose();
      const result = await resumeSession({
        continueRef: 'native-failure',
        projectHash: 'native-failure',
        chatsDir: join(directory, 'chats'),
        workspaceDirs: [],
        currentProvider: 'test',
        currentModel: 'test',
      });
      if (!result.ok) throw new Error(result.error);
      const resumed = result.recording;
      if (!(resumed instanceof JournalRecordingService))
        throw new Error('Expected native recorder');
      const nextHistory = new HistoryService({});
      const next = new RecordingIntegration(resumed);
      try {
        await nextHistory.adoptResumeBoot(resumed, result.boot);
        await next.subscribeToJournal(nextHistory);
        nextHistory.add(nativeText('after reopen'));
        await next.flushAtTurnBoundary();
        await expect(next.flushAtTurnBoundary()).resolves.toBeUndefined();
        expect(await recordedRows(resumed)).toStrictEqual([
          nativeText('durable baseline'),
          nativeText('after reopen'),
        ]);
      } finally {
        await next.dispose();
        await nextHistory.dispose();
        await resumed.dispose();
      }
    }, 120000);
  }

  it('surfaces a prequeued recorder failure with its original identity and diagnostic report', async () => {
    const { recording, integration, control, reports } = fixture();
    const failure = new Error('prequeued metadata write failed');
    control.writeError = failure;
    recording.recordSessionMetadata('rejected title');
    const error = await rejected(integration.flushAtTurnBoundary());
    const owned = reportsOf(error);
    expect(owned).toHaveLength(1);
    expect(owned[0].cause).toBe(failure);
    expect(await consume(error)).toStrictEqual([2]);
    expect(await readdir(reports)).toStrictEqual([]);
  });

  it('keeps a report storage failure terminal and preserves its original native I/O cause', async () => {
    const { history, integration, control, reports } = fixture();
    await writeFile(reports, 'blocked diagnostic directory');
    const cause = new Error('native persistence failed before reporting');
    control.writeError = cause;
    history.add(nativeText('failed row'));
    const error = await rejected(integration.flushAtTurnBoundary());
    if (!(error instanceof RecordingFailureStorageError)) throw error;
    expect(error.cause).toBe(cause);
    expect(error.storageError).toBeInstanceOf(Error);
    expect(error.cleanupError).toBeUndefined();
    await expect(integration.flushAtTurnBoundary()).rejects.toBe(error);
    await expect(integration.dispose()).rejects.toBe(error);
    await expect(integration.dispose()).resolves.toBeUndefined();
  });

  it('orders the native persistence cause, diagnostic storage fault and scratch cleanup failure', async () => {
    const { history, integration, control, reports } = fixture();
    await mkdir(join(reports, '2.jsonl.tmp'), { recursive: true });
    const cause = new Error('native write before reporting and cleanup');
    control.writeError = cause;
    history.add(nativeText('failed row'));
    const error = await rejected(integration.flushAtTurnBoundary());
    if (!(error instanceof RecordingFailureStorageError)) throw error;
    expect(error.cause).toBe(cause);
    expect(error.storageError).toBeInstanceOf(Error);
    expect(error.cleanupError).toBeInstanceOf(Error);
    await expect(integration.dispose()).rejects.toBe(error);
  });

  it('transfers 32 concurrent boundary failures once through disposal and shares its in-flight promise', async () => {
    const { history, integration, control, reports } = fixture();
    const cause = new Error('concurrent native writer failure');
    control.writeError = cause;
    history.add(nativeText('failed row'));
    const boundaries = Array.from({ length: 32 }, () =>
      rejected(integration.flushAtTurnBoundary()),
    );
    const disposal = integration.dispose();
    expect(new Set([disposal, integration.dispose()]).size).toBe(1);
    const observedDisposal = rejected(disposal);
    const observed = await Promise.all([...boundaries, observedDisposal]);
    const generations: number[] = [];
    let notices = 0;
    for (const error of observed) {
      if (error instanceof RecordingFailureNotice) notices += 1;
      else {
        if (!(error instanceof RecordingFailureReport)) throw error;
        generations.push(...(await consume(error)));
      }
    }
    for (const report of observed.flatMap(reportsOf))
      expect(report.cause).toBe(cause);
    expect(generations.sort((a, b) => a - b)).toStrictEqual(
      Array.from({ length: 32 }, (_, index) => index + 2),
    );
    expect(notices).toBeGreaterThan(0);
    expect(await readdir(reports)).toStrictEqual([]);
    await expect(integration.dispose()).resolves.toBeUndefined();
  });

  it('drains a real native report before rethrowing its summary and preserves a failed diagnostic consumer second', async () => {
    const { history, integration, control, reports } = fixture();
    const cause = new Error('native writer failure', {
      cause: new AggregateError(
        [
          new Map([['row', { detail: 'native diagnostic leaf' }]]),
          new Set([42n, undefined]),
        ],
        'nested native cause',
      ),
    });
    control.writeError = cause;
    history.add(nativeText('failed row'));
    const original = await rejected(integration.flushAtTurnBoundary());
    const sinkError = new Error('native diagnostic sink unavailable');
    const kinds = new Set<string>();
    let leaf = '';
    const observed = await rejected(
      withRecordingFailureReport(Promise.reject(original), async (detail) => {
        kinds.add(detail.kind);
        if (detail.value === 'native diagnostic leaf') leaf = detail.value;
        throw sinkError;
      }),
    );
    if (!(observed instanceof AggregateError)) throw observed;
    expect(observed.errors).toStrictEqual([original, sinkError]);
    expect(reportsOf(original)[0].cause).toBe(cause);
    expect([...kinds]).toStrictEqual(
      expect.arrayContaining([
        'failure',
        'map-entry',
        'set-entry',
        'bigint',
        'undefined',
      ]),
    );
    expect(leaf).toBe('native diagnostic leaf');
    expect(await readdir(reports)).toStrictEqual([]);
  });

  it('streams deep native causes within the record bound without invoking accessors or retaining cycles', async () => {
    const { history, integration, control } = fixture();
    const key = String.fromCharCode(0).repeat(128);
    let nested: object = { final: 'native deep diagnostic leaf' };
    for (let index = 0; index < 30; index += 1) nested = { [key]: nested };
    const cause: { self?: object; nested: object; secret?: string } = {
      nested,
    };
    cause.self = cause;
    Object.defineProperty(cause, 'secret', {
      enumerable: true,
      get: () => {
        throw new Error('native getter must not run');
      },
    });
    control.writeError = cause;
    history.add(nativeText('failed row'));
    const report = await rejected(integration.flushAtTurnBoundary());
    if (!(report instanceof RecordingFailureReport)) throw report;
    expect(report.cause).toBe(cause);
    const kinds = new Set<string>();
    let largest = 0;
    let sawLeaf = false;
    for await (const detail of report.details()) {
      kinds.add(detail.kind);
      largest = Math.max(largest, Buffer.byteLength(JSON.stringify(detail)));
      if (detail.value === 'native deep diagnostic leaf') sawLeaf = true;
    }
    expect(largest).toBeLessThan(32768);
    expect(sawLeaf).toBe(true);
    expect(kinds.has('accessor-not-evaluated')).toBe(true);
    expect(kinds.has('ancestor-reference')).toBe(true);
    expect(kinds.has('diagnostic-inspection-failed')).toBe(false);
  });
});
