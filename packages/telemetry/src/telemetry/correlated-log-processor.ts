/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { Context } from '@opentelemetry/api';
import {
  BatchLogRecordProcessor,
  SimpleLogRecordProcessor,
  type LogRecordProcessor,
  type SdkLogRecord,
} from '@opentelemetry/sdk-logs';
import {
  type AcknowledgedLogExporter,
  hasExportReceipt,
} from './artifact-exporter.js';

/** A missing strict ACK must not block another request in the SDK's shared batch queue. */
export class CorrelatedLogRecordProcessor implements LogRecordProcessor {
  private readonly eager: BatchLogRecordProcessor;
  private readonly strict: SimpleLogRecordProcessor;
  constructor(exporter: AcknowledgedLogExporter) {
    this.eager = new BatchLogRecordProcessor(exporter, {
      scheduledDelayMillis: 0,
      maxExportBatchSize: 1,
      exportTimeoutMillis: 5000,
    });
    this.strict = new SimpleLogRecordProcessor(exporter);
  }
  onEmit(record: SdkLogRecord, context?: Context): void {
    if (hasExportReceipt(record) && record.attributes.schema_version !== 4)
      this.strict.onEmit(record, context);
    else this.eager.onEmit(record);
  }
  async forceFlush(): Promise<void> {
    await Promise.all([this.eager.forceFlush(), this.strict.forceFlush()]);
  }
  async shutdown(): Promise<void> {
    await this.strict.forceFlush();
    await this.eager.shutdown();
  }
}
