/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it, spyOn } from 'bun:test';
import * as fs from 'node:fs';
import { mkdir, readdir, rename, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { openJournalReadOnly } from '../journal/journalReader.js';
import {
  rejected,
  useNativeFailureIntegration,
} from './__tests__/support/native-failure-fixture.js';
import {
  nativeText,
  recordedRows,
} from './__tests__/support/native-integration-fixture.js';
import { RecordingFailureReport } from './recording-failure-report.js';
import { withRecordingFailureReport } from './recording-failure-consumer.js';

describe('native recording positional failure ownership', () => {
  const fixture = useNativeFailureIntegration();

  it('completes repeated partial positional writes without truncation or duplication', async () => {
    const { history, recording, integration, control } = fixture();
    control.writeMode = 'partial';
    const row = nativeText('partial Unicode row: \u{1f600}'.repeat(64));
    history.add(row);
    await integration.flushAtTurnBoundary();
    expect(control.fragments).toBeGreaterThan(1);
    expect(await recordedRows(recording)).toStrictEqual([
      nativeText('durable baseline'),
      nativeText('partial Unicode row: \u{1f600}'.repeat(64)),
    ]);
  });

  for (const mode of ['zero', 'records', 'trailer'] as const) {
    it(`reports ${mode === 'zero' ? 'no-progress' : `torn ${mode}`} writes and detaches without publishing the rejected row`, async () => {
      const { history, recording, integration, control, reports } = fixture();
      const cause = new Error(`mid-${mode} native failure`);
      const path = recording.getFilePath();
      if (path === null) throw new Error('Missing native file');
      const before = await openJournalReadOnly(path);
      const trailer = before.trailer;
      await before.close();
      if (trailer === undefined)
        throw new Error('Missing durable native baseline');
      const end = trailer.durableEnd;
      control.writeMode = mode;
      if (mode !== 'zero') control.writeError = cause;
      history.add(nativeText('not durable'));
      const error = await rejected(integration.flushAtTurnBoundary());
      if (!(error instanceof RecordingFailureReport)) throw error;
      const failure = error.cause;
      if (!(failure instanceof Error)) throw failure;
      expect(failure.message).toMatch(
        mode === 'zero'
          ? /made no progress/
          : /^mid-(records|trailer) native failure$/,
      );
      expect(mode === 'zero' || error.cause === cause).toBe(true);
      let failures = 0;
      for await (const detail of error.details())
        if (detail.kind === 'failure') failures += 1;
      expect(failures).toBe(1);
      expect(control.fragments).toBe(mode === 'zero' ? 0 : 1);
      const extraBytes = (await stat(path)).size - end;
      expect(extraBytes).toBeGreaterThanOrEqual(0);
      expect(extraBytes > 0).toBe(mode !== 'zero');
      expect(await readdir(reports)).toStrictEqual([]);
      await integration.dispose();
      history.add(nativeText('after detach'));
      await history.waitForCommit();
      expect(history.getStatistics().totalMessages).toBe(3);
      expect(await recordedRows(recording)).toStrictEqual([
        nativeText('durable baseline'),
      ]);
    });
  }

  for (const kind of ['read', 'flush'] as const) {
    it(`retains the exact prequeued ${kind} cause through a report and successful diagnostic consumption`, async () => {
      const { recording, integration, control, reports } = fixture();
      const cause = new Error(`native ${kind} failed`);
      if (kind === 'read') control.readError = cause;
      else control.flushError = cause;
      recording.recordSessionMetadata('failed metadata');
      const report = await rejected(integration.flushAtTurnBoundary());
      if (!(report instanceof RecordingFailureReport)) throw report;
      const generations: number[] = [];
      const observed = await rejected(
        withRecordingFailureReport(Promise.reject(report), async (detail) => {
          if (detail.kind === 'failure') generations.push(detail.generation);
        }),
      );
      expect(observed).toBe(report);
      expect(report.cause).toBe(cause);
      expect(generations).toStrictEqual([2]);
      expect(await readdir(reports)).toStrictEqual([]);
    });
  }

  it('preserves the primary writer and descriptor close error identities in order', async () => {
    const { recording, integration, control } = fixture();
    await integration.dispose();
    const primary = new Error('native primary write');
    const cleanup = new Error('native descriptor close');
    control.writeError = primary;
    control.closeError = cleanup;
    recording.recordSessionMetadata('rejected metadata');
    const error = await rejected(recording.dispose());
    if (!(error instanceof AggregateError)) throw error;
    expect(error.errors).toStrictEqual([primary, cleanup]);
    expect(recording.isActive()).toBe(false);
    expect(await recordedRows(recording)).toStrictEqual([
      nativeText('durable baseline'),
    ]);
  });

  it('keeps failed native report cleanup retryable without consuming a later generation', async () => {
    const { history, integration, control, reports, directory } = fixture();
    control.writeError = new Error('native writer remains poisoned');
    history.add(nativeText('failed row'));
    const first = await rejected(integration.flushAtTurnBoundary());
    const later = await rejected(integration.flushAtTurnBoundary());
    if (
      !(first instanceof RecordingFailureReport) ||
      !(later instanceof RecordingFailureReport)
    )
      throw new Error('Expected two native reports');
    const file = join(reports, '2.jsonl');
    const held = join(directory, 'held-first-report');
    await rename(file, held);
    await mkdir(file);
    await expect(first.close()).rejects.toThrow(/EISDIR|EPERM/);
    expect(await readdir(reports)).toHaveLength(2);
    await rename(file, join(directory, 'held-obstruction'));
    await rename(held, file);
    await first.close();
    const generations: number[] = [];
    for await (const detail of later.details())
      if (detail.kind === 'failure') generations.push(detail.generation);
    expect(generations).toStrictEqual([3]);
    expect(await readdir(reports)).toStrictEqual([]);
  });

  for (const mode of ['read', 'close', 'both'] as const) {
    it(`preserves diagnostic ${mode} failure identities while consuming a native report`, async () => {
      const { history, integration, control, reports } = fixture();
      control.writeError = new Error('native failure requiring diagnostics');
      history.add(nativeText('failed row'));
      const report = await rejected(integration.flushAtTurnBoundary());
      if (!(report instanceof RecordingFailureReport)) throw report;
      const primary = new Error('diagnostic read failed');
      const cleanup = new Error('diagnostic descriptor close failed');
      const close = fs.closeSync;
      const readMock =
        mode === 'close'
          ? undefined
          : spyOn(fs, 'readSync').mockImplementation(() => {
              throw primary;
            });
      const closeMock = spyOn(fs, 'closeSync').mockImplementation((fd) => {
        close(fd);
        if (mode !== 'read') throw cleanup;
      });
      let observed: unknown;
      try {
        observed = await rejected(
          (async () => {
            for await (const detail of report.details()) void detail;
          })(),
        );
      } finally {
        readMock?.mockRestore();
        closeMock.mockRestore();
      }
      const errors =
        observed instanceof AggregateError ? observed.errors : [observed];
      expect(errors).toStrictEqual(
        mode === 'both'
          ? [primary, cleanup]
          : [mode === 'read' ? primary : cleanup],
      );
      expect(await readdir(reports)).toStrictEqual([]);
    });
  }
});
