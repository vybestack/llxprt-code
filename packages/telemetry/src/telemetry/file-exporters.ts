/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { type ExportResult, ExportResultCode } from '@opentelemetry/core';
import {
  type ReadableSpan,
  type SpanExporter,
} from '@opentelemetry/sdk-trace-base';
import {
  type ReadableLogRecord,
  type LogRecordExporter,
} from '@opentelemetry/sdk-logs';
import {
  type ResourceMetrics,
  type PushMetricExporter,
  AggregationTemporality,
} from '@opentelemetry/sdk-metrics';

class FileExporter {
  protected filePath: string;

  constructor(filePath: string) {
    this.filePath = filePath;
    // Ensure directory exists
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  protected serialize(data: unknown): string {
    return JSON.stringify(data, null, 2) + '\n';
  }

  protected writeToFile(data: string): void {
    // Use synchronous append to ensure immediate write
    fs.appendFileSync(this.filePath, data, 'utf-8');
  }

  shutdown(): Promise<void> {
    // Nothing to do for sync writes
    return Promise.resolve();
  }
}

export class FileSpanExporter extends FileExporter implements SpanExporter {
  export(
    spans: ReadableSpan[],
    resultCallback: (result: ExportResult) => void,
  ): void {
    try {
      const data = spans.map((span) => this.serialize(span)).join('');
      this.writeToFile(data);
      resultCallback({
        code: ExportResultCode.SUCCESS,
      });
    } catch (error) {
      resultCallback({
        code: ExportResultCode.FAILED,
        error: error as Error,
      });
    }
  }
}

export class FileLogExporter extends FileExporter implements LogRecordExporter {
  export(
    logs: ReadableLogRecord[],
    resultCallback: (result: ExportResult) => void,
  ): void {
    try {
      const data = logs.map((log) => this.serialize(log)).join('');
      this.writeToFile(data);
      resultCallback({
        code: ExportResultCode.SUCCESS,
      });
    } catch (error) {
      resultCallback({
        code: ExportResultCode.FAILED,
        error: error as Error,
      });
    }
  }
}

export class FileMetricExporter
  extends FileExporter
  implements PushMetricExporter
{
  export(
    metrics: ResourceMetrics,
    resultCallback: (result: ExportResult) => void,
  ): void {
    try {
      const data = this.serialize(metrics);
      this.writeToFile(data);
      resultCallback({
        code: ExportResultCode.SUCCESS,
      });
    } catch (error) {
      resultCallback({
        code: ExportResultCode.FAILED,
        error: error as Error,
      });
    }
  }

  getPreferredAggregationTemporality(): AggregationTemporality {
    return AggregationTemporality.CUMULATIVE;
  }

  async forceFlush(): Promise<void> {
    return Promise.resolve();
  }
}
