/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { afterEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, mkdirSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  LoggerProvider,
  BatchLogRecordProcessor,
  type ReadableLogRecord,
} from '@opentelemetry/sdk-logs';
import type { ExportResult } from '@opentelemetry/core';
import { FileLogExporter } from './file-exporters.js';
import { AcknowledgedLogExporter } from './artifact-exporter.js';
import { CorrelatedLogRecordProcessor } from './correlated-log-processor.js';

class DelayedFileExporter extends FileLogExporter {
  private delayed: (() => void) | undefined;
  override export(
    records: ReadableLogRecord[],
    callback: (result: ExportResult) => void,
  ): void {
    super.export(records, (result) => {
      if (records.some((record) => record.body === 'late'))
        this.delayed = () => callback(result);
      else callback(result);
    });
  }
  release(): void {
    this.delayed?.();
    this.delayed = undefined;
  }
}
function settled(promise: Promise<void>): Promise<unknown> {
  return promise.then(
    () => null,
    (error: unknown) => error,
  );
}
function setup(batch = 3, delayed = false) {
  const root = mkdtempSync(join(tmpdir(), 'correlated-export-'));
  const path = join(root, 'events.jsonl');
  const file = new DelayedFileExporter(path);
  const exporter = new AcknowledgedLogExporter(
    delayed ? file : new FileLogExporter(path),
  );
  const provider = new LoggerProvider({
    processors: [
      delayed
        ? new CorrelatedLogRecordProcessor(exporter)
        : new BatchLogRecordProcessor(exporter, {
            maxExportBatchSize: batch,
            scheduledDelayMillis: 60000,
            exportTimeoutMillis: 5000,
          }),
    ],
  });
  return {
    root,
    path,
    file,
    exporter,
    provider,
    logger: provider.getLogger('receipt-test'),
  };
}
const resources: Array<ReturnType<typeof setup>> = [];
async function cleanupResources(): Promise<void> {
  for (const resource of resources.splice(0)) {
    resource.file.release();
    await resource.provider.shutdown();
    rmSync(resource.root, { recursive: true, force: true });
  }
}
describe('record export receipts through real OpenTelemetry batches', () => {
  afterEach(cleanupResources);
  it('assigns a rejected mixed batch to every included strict record without poisoning later records', async () => {
    const input = setup();
    resources.push(input);
    mkdirSync(input.path);
    const first = input.exporter.receipt({
      body: 'first',
      attributes: { prompt_id: 'one' },
    });
    const second = input.exporter.receipt({
      body: 'second',
      attributes: { prompt_id: 'two' },
    });
    const outcomes = [
      settled(first.acknowledged),
      settled(second.acknowledged),
    ];
    input.logger.emit(first.record);
    input.logger.emit({ body: 'unrelated legacy' });
    input.logger.emit(second.record);
    const errors = await Promise.all(outcomes);
    for (const error of errors) expect(String(error)).toContain('EISDIR');
    expect(errors[0]).toBe(errors[1]);
    rmSync(input.path, { recursive: true });
    const later = input.exporter.receipt({ body: 'later' });
    input.logger.emit(later.record);
    await input.provider.forceFlush();
    await expect(later.acknowledged).resolves.toBeUndefined();
    expect(readFileSync(input.path, 'utf8')).toContain('later');
  });
  it('rejects a missing ACK and ignores its late failure without rejecting a healthy concurrent receipt', async () => {
    const input = setup(1, true);
    resources.push(input);
    mkdirSync(input.path);
    const late = input.exporter.receipt({ body: 'late' });
    const outcome = settled(late.acknowledged);
    input.logger.emit(late.record);
    rmSync(input.path, { recursive: true });
    const healthy = input.exporter.receipt({ body: 'healthy' });
    input.logger.emit(healthy.record);
    await expect(healthy.acknowledged).resolves.toBeUndefined();
    expect(String(await outcome)).toContain('acknowledgement missing');
    input.file.release();
    const next = input.exporter.receipt({ body: 'after late failure' });
    input.logger.emit(next.record);
    await expect(next.acknowledged).resolves.toBeUndefined();
  }, 15000);
  it('aborts only the waiting receipt and cannot turn a late ACK into success', async () => {
    const input = setup(1, true);
    resources.push(input);
    const controller = new AbortController();
    const late = input.exporter.receipt({ body: 'late' }, controller.signal);
    const outcome = settled(late.acknowledged);
    input.logger.emit(late.record);
    const error = new DOMException('cancelled receipt', 'AbortError');
    controller.abort(error);
    expect(await outcome).toBe(error);
    input.file.release();
    const healthy = input.exporter.receipt({ body: 'other' });
    input.logger.emit(healthy.record);
    await expect(healthy.acknowledged).resolves.toBeUndefined();
    expect(String(await settled(late.acknowledged))).toContain(
      'cancelled receipt',
    );
  });
  it('rejects outstanding receipts at shutdown instead of retaining waiters', async () => {
    const input = setup(1, true);
    resources.push(input);
    const late = input.exporter.receipt({ body: 'late' });
    const outcome = settled(late.acknowledged);
    input.logger.emit(late.record);
    await input.exporter.shutdown();
    expect(String(await outcome)).toContain('shut down');
    input.file.release();
  });
});
