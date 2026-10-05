/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RecordingFailureStore } from './recording-failure-report.js';
import { withRecordingFailureReport } from './recording-failure-consumer.js';

describe('recording failure consumer ownership', () => {
  it('drains nested reports in order and closes them before propagating the original summary', async () => {
    const root = mkdtempSync(join(tmpdir(), 'recording-failure-consumer-'));
    const store = new RecordingFailureStore(root);
    try {
      store.record(2, new Error('second'));
      store.record(1, new Error('first'));
      const report = store.takeThrough(2, 'flush');
      if (report === undefined) throw new Error('Missing report');
      const shutdown = new AggregateError(
        [new Error('detach'), report],
        'shutdown',
      );
      const order: number[] = [];
      const observed = await withRecordingFailureReport(
        Promise.reject(shutdown),
        async (detail) => {
          await Promise.resolve();
          if (detail.kind === 'failure') order.push(detail.generation);
        },
      ).catch((error: unknown) => error);
      expect(observed).toBe(shutdown);
      expect(order).toStrictEqual([1, 2]);
      expect(readdirSync(root)).toStrictEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('propagates a diagnostic consumer error after the original persistence failure', async () => {
    const root = mkdtempSync(join(tmpdir(), 'recording-failure-consumer-'));
    const store = new RecordingFailureStore(root);
    try {
      store.record(1, new Error('original persistence error'));
      const report = store.takeThrough(1, 'flush');
      if (report === undefined) throw new Error('Missing report');
      const sinkError = new Error('diagnostic sink unavailable');
      const observed = await withRecordingFailureReport(
        Promise.reject(report),
        async () => {
          throw sinkError;
        },
      ).catch((error: unknown) => error);
      if (!(observed instanceof AggregateError)) throw observed;
      expect(observed.errors[0]).toBe(report);
      expect(observed.errors[1]).toBe(sinkError);
      expect(readdirSync(root)).toStrictEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
