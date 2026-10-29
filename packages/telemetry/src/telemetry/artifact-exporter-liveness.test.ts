/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { ExportResultCode, type ExportResult } from '@opentelemetry/core';
import {
  LoggerProvider,
  SimpleLogRecordProcessor,
  type ReadableLogRecord,
} from '@opentelemetry/sdk-logs';
import {
  AcknowledgedLogExporter,
  ExportAcknowledgementMissingError,
  type ExportProgress,
  type ProgressReportingLogExporter,
} from './artifact-exporter.js';

const livenessMs = 80;
const stepMs = 30;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Writes `steps` chunks, one per `stepMs`, reporting progress after each. */
class SteppedExporter implements ProgressReportingLogExporter {
  readonly requestArtifactSchemaVersion = 4;
  bytesWritten = 0;
  constructor(
    private readonly steps: number,
    private readonly stallAfter: number | undefined,
  ) {}
  export(): void {
    throw new Error('exportWithProgress must be used');
  }
  exportWithProgress(
    _records: ReadableLogRecord[],
    progress: ExportProgress,
    done: (result: ExportResult) => void,
  ): void {
    const writeNext = (step: number): void => {
      if (progress.signal.aborted) return;
      if (step === this.steps) {
        done({ code: ExportResultCode.SUCCESS });
        return;
      }
      this.bytesWritten += 1;
      if (this.stallAfter === undefined || step < this.stallAfter)
        progress.report();
      setTimeout(() => writeNext(step + 1), stepMs);
    };
    writeNext(0);
  }
  shutdown(): Promise<void> {
    return Promise.resolve();
  }
  forceFlush(): Promise<void> {
    return Promise.resolve();
  }
}

function emitThrough(
  acknowledging: AcknowledgedLogExporter,
  results: ExportResult[],
): { provider: LoggerProvider; acknowledged: Promise<unknown> } {
  const provider = new LoggerProvider({
    processors: [
      new SimpleLogRecordProcessor({
        export: (records, callback) =>
          acknowledging.export(records, (result) => {
            results.push(result);
            callback(result);
          }),
        shutdown: () => acknowledging.shutdown(),
        forceFlush: () => acknowledging.forceFlush(),
      }),
    ],
  });
  const receipt = acknowledging.receipt({ body: 'chunk' });
  const acknowledged = receipt.acknowledged.then(
    () => undefined,
    (error: unknown) => error,
  );
  provider.getLogger('liveness').emit(receipt.record);
  return { provider, acknowledged };
}

describe('progress-based export liveness', () => {
  it('does not time out a write that keeps making progress for longer than the liveness window', async () => {
    const exporter = new SteppedExporter(8, undefined);
    const acknowledging = new AcknowledgedLogExporter(exporter, { livenessMs });
    const results: ExportResult[] = [];
    const started = Date.now();
    const { provider, acknowledged } = emitThrough(acknowledging, results);
    expect(await acknowledged).toBeUndefined();
    expect(Date.now() - started).toBeGreaterThan(livenessMs * 2);
    expect(results.map((result) => result.code)).toStrictEqual([
      ExportResultCode.SUCCESS,
    ]);
    expect(exporter.bytesWritten).toBe(8);
    await provider.shutdown();
  }, 15000);

  it('abandons a write that stops making progress and aborts it so no further bytes are written', async () => {
    const exporter = new SteppedExporter(1000, 2);
    const acknowledging = new AcknowledgedLogExporter(exporter, { livenessMs });
    const results: ExportResult[] = [];
    const { provider, acknowledged } = emitThrough(acknowledging, results);
    const outcome = await acknowledged;
    expect(outcome).toBeInstanceOf(ExportAcknowledgementMissingError);
    expect(results).toHaveLength(1);
    expect(results[0].code).toBe(ExportResultCode.FAILED);
    expect(results[0].error).toBe(outcome as Error);
    const writtenAtAbandonment = exporter.bytesWritten;
    await sleep(stepMs * 5);
    expect(exporter.bytesWritten).toBe(writtenAtAbandonment);
    await provider.shutdown();
  }, 15000);

  it('keeps abandoning an exporter that cannot report progress after the liveness window', async () => {
    const exporter = {
      requestArtifactSchemaVersion: 4 as const,
      export: (): void => undefined,
      shutdown: (): Promise<void> => Promise.resolve(),
      forceFlush: (): Promise<void> => Promise.resolve(),
    };
    const acknowledging = new AcknowledgedLogExporter(exporter, { livenessMs });
    const results: ExportResult[] = [];
    const { provider, acknowledged } = emitThrough(acknowledging, results);
    expect(await acknowledged).toBeInstanceOf(
      ExportAcknowledgementMissingError,
    );
    expect(results[0].code).toBe(ExportResultCode.FAILED);
    await provider.shutdown();
  }, 15000);

  it('keeps the stall timer for an in-flight export after its receipt is cancelled', async () => {
    const exporter = {
      requestArtifactSchemaVersion: 4 as const,
      export: (): void => undefined,
      shutdown: (): Promise<void> => Promise.resolve(),
      forceFlush: (): Promise<void> => Promise.resolve(),
    };
    const acknowledging = new AcknowledgedLogExporter(exporter, { livenessMs });
    const results: ExportResult[] = [];
    const provider = new LoggerProvider({
      processors: [
        new SimpleLogRecordProcessor({
          export: (records, callback) =>
            acknowledging.export(records, (result) => {
              results.push(result);
              callback(result);
            }),
          shutdown: () => acknowledging.shutdown(),
          forceFlush: () => acknowledging.forceFlush(),
        }),
      ],
    });
    const cancel = new AbortController();
    const receipt = acknowledging.receipt({ body: 'chunk' }, cancel.signal);
    const cancelled = receipt.acknowledged.then(
      () => undefined,
      (error: unknown) => error,
    );
    provider.getLogger('liveness').emit(receipt.record);
    cancel.abort(new Error('request cancelled'));
    expect(String(await cancelled)).toContain('request cancelled');
    expect(results).toHaveLength(0);

    await sleep(livenessMs * 3);

    expect(results).toHaveLength(1);
    expect(results[0].code).toBe(ExportResultCode.FAILED);
    expect(results[0].error).toBeInstanceOf(ExportAcknowledgementMissingError);
    await provider.shutdown();
  }, 15000);

  it('rejects a non-positive liveness window', () => {
    expect(
      () =>
        new AcknowledgedLogExporter(new SteppedExporter(1, undefined), {
          livenessMs: 0,
        }),
    ).toThrow(RangeError);
  });
});
