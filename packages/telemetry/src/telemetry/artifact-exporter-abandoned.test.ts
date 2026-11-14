/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { ExportResultCode, type ExportResult } from '@opentelemetry/core';
import {
  LoggerProvider,
  SimpleLogRecordProcessor,
  type LogRecordExporter,
  type ReadableLogRecord,
} from '@opentelemetry/sdk-logs';
import { AcknowledgedLogExporter } from './artifact-exporter.js';

class SilentExporter implements LogRecordExporter {
  readonly requestArtifactSchemaVersion = 4;
  export(): void {
    // Never reports an export result.
  }
  shutdown(): Promise<void> {
    return Promise.resolve();
  }
  forceFlush(): Promise<void> {
    return Promise.resolve();
  }
}

describe('acknowledged log export without any result', () => {
  it('completes the export as failed once its receipt times out, so joins on accepted exports end', async () => {
    const acknowledging = new AcknowledgedLogExporter(new SilentExporter());
    const results: ExportResult[] = [];
    const observed: LogRecordExporter = {
      export(
        records: ReadableLogRecord[],
        callback: (result: ExportResult) => void,
      ): void {
        acknowledging.export(records, (result) => {
          results.push(result);
          callback(result);
        });
      },
      shutdown: () => acknowledging.shutdown(),
      forceFlush: () => acknowledging.forceFlush(),
    };
    const provider = new LoggerProvider({
      processors: [new SimpleLogRecordProcessor(observed)],
    });
    const receipt = acknowledging.receipt({ body: 'never acknowledged' });
    const outcome = receipt.acknowledged.then(
      () => undefined,
      (error: unknown) => error,
    );
    provider.getLogger('abandoned').emit(receipt.record);
    const missing = await outcome;
    expect(String(missing)).toContain('acknowledgement missing');
    expect(results).toHaveLength(1);
    expect(results[0].code).toBe(ExportResultCode.FAILED);
    expect(results[0].error).toBe(missing as Error);
    await provider.shutdown();
  }, 15000);
});
