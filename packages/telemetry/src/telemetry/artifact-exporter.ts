/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { randomUUID } from 'node:crypto';
import type { LogRecord } from '@opentelemetry/api-logs';
import { ExportResultCode, type ExportResult } from '@opentelemetry/core';
import type {
  LogRecordExporter,
  ReadableLogRecord,
} from '@opentelemetry/sdk-logs';

export interface RequestArtifactLogExporter extends LogRecordExporter {
  readonly requestArtifactSchemaVersion: 4;
}
const receiptAttribute = 'llxprt.export_receipt_id';
export function hasExportReceipt(
  record: Pick<ReadableLogRecord, 'attributes'>,
): boolean {
  return typeof record.attributes[receiptAttribute] === 'string';
}
/**
 * A receipt-carrying export that never reported back. The request that awaited
 * the receipt already receives this rejection, so the root only releases its
 * join on the export and does not queue a second failure for flush or close.
 */
export class ExportAcknowledgementMissingError extends Error {
  constructor() {
    super('Telemetry record export acknowledgement missing');
    this.name = 'ExportAcknowledgementMissingError';
  }
}
export interface LogExportReceipt {
  readonly record: LogRecord;
  readonly acknowledged: Promise<void>;
  readonly fail: (error: unknown) => void;
}
export class AcknowledgedLogExporter implements LogRecordExporter {
  private readonly receipts = new Map<string, (error?: unknown) => void>();
  private readonly abandonExports = new Map<string, (error: Error) => void>();
  constructor(private readonly exporter: LogRecordExporter) {}

  /** Whether the wrapped exporter can carry schema 4 request-artifact records. */
  supportsRequestArtifacts(): boolean {
    return (
      'requestArtifactSchemaVersion' in this.exporter &&
      this.exporter.requestArtifactSchemaVersion === 4
    );
  }

  assertArtifactSupport(): void {
    if (!this.supportsRequestArtifacts())
      throw new Error(
        'Telemetry exporter does not support request artifact schema 4',
      );
  }

  receipt(record: LogRecord, signal?: AbortSignal): LogExportReceipt {
    this.assertArtifactSupport();
    signal?.throwIfAborted();
    const id = randomUUID();
    let fail: (error: unknown) => void = () => {
      throw new Error('Export receipt not registered');
    };
    const acknowledged = new Promise<void>((resolve, reject) => {
      const settle = (error?: unknown): void => {
        if (!this.receipts.delete(id)) return;
        clearTimeout(timeout);
        signal?.removeEventListener('abort', abort);
        if (error === undefined) resolve();
        else reject(error);
      };
      const abort = (): void => settle(signal?.reason);
      const timeout = setTimeout(() => {
        const missing = new ExportAcknowledgementMissingError();
        settle(missing);
        // An export that never reports back would otherwise keep the root's
        // accepted-export join, and so its flush and close, waiting forever.
        this.abandonExports.get(id)?.(missing);
      }, 5000);
      fail = settle;
      this.receipts.set(id, settle);
      signal?.addEventListener('abort', abort, { once: true });
    });
    return {
      record: {
        ...record,
        attributes: { ...record.attributes, [receiptAttribute]: id },
      },
      acknowledged,
      fail,
    };
  }

  export(
    records: ReadableLogRecord[],
    callback: (result: ExportResult) => void,
  ): void {
    // Snapshot IDs, not records: a late callback must not retain transcript chunks.
    const ids = records.flatMap((record) => {
      const id = record.attributes[receiptAttribute];
      return typeof id === 'string' ? [id] : [];
    });
    let completed = false;
    const complete = (result: ExportResult): void => {
      if (completed) return;
      completed = true;
      for (const id of ids) this.abandonExports.delete(id);
      const error =
        result.code === ExportResultCode.SUCCESS
          ? undefined
          : (result.error ?? new Error('Telemetry record export failed'));
      for (const id of ids) this.receipts.get(id)?.(error);
      callback(result);
    };
    const abandon = (error: Error): void =>
      complete({ code: ExportResultCode.FAILED, error });
    for (const id of ids) this.abandonExports.set(id, abandon);
    try {
      this.exporter.export(records, complete);
    } catch (error: unknown) {
      complete({
        code: ExportResultCode.FAILED,
        error: error instanceof Error ? error : new Error(String(error)),
      });
    }
  }

  shutdown(): Promise<void> {
    for (const settle of this.receipts.values())
      settle(
        new Error('Telemetry SDK shut down before export acknowledgement'),
      );
    return this.exporter.shutdown();
  }
  forceFlush(): Promise<void> {
    return this.exporter.forceFlush();
  }
}
