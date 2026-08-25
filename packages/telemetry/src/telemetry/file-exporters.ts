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
  type InstrumentType,
  AggregationTemporality,
} from '@opentelemetry/sdk-metrics';

interface RotationOptions {
  maxBytes: number;
  maxFiles: number;
}

// A rotated filename is `${outfile}.llxprt-rot-${Date.now()}-${6 base36
// chars}`. The `llxprt-rot-` namespace plus fixed-width token keeps the
// retention predicate tight: files that merely share the outfile prefix
// (`telemetry.jsonl.backup`, `telemetry.jsonl.2026-notes`) are not ours to
// delete, while every name this module generates is guaranteed to match.
const ROTATION_TOKEN_RE = /^llxprt-rot-\d+-[0-9a-z]{6}$/;

function assertPositiveFinite(value: number, name: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive finite number`);
  }
}

class FileExporter {
  protected filePath: string;
  private readonly maxBytes: number | undefined;
  private readonly maxFiles: number | undefined;

  constructor(filePath: string, rotation?: RotationOptions) {
    this.filePath = filePath;
    if (rotation !== undefined) {
      assertPositiveFinite(rotation.maxBytes, 'maxBytes');
      assertPositiveFinite(rotation.maxFiles, 'maxFiles');
      this.maxBytes = rotation.maxBytes;
      this.maxFiles = rotation.maxFiles;
    }
    // Ensure directory exists
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  protected serialize(data: unknown): string {
    return JSON.stringify(data) + '\n';
  }

  protected writeToFile(data: string): void {
    // Rotation is a best-effort bound on outfile growth. A single record larger
    // than maxBytes is still written whole — JSONL lines cannot be split.
    if (this.maxBytes !== undefined && this.maxFiles !== undefined) {
      try {
        this.rotateIfNeeded(data);
      } catch {
        // Fail open: filesystem is external; telemetry must never break the
        // caller path. Fall back to a plain append.
      }
    }
    // Use synchronous append to ensure immediate write. When rotation is enabled this
    // also (re)creates the active file after a rename.
    fs.appendFileSync(this.filePath, data, 'utf-8');
  }

  private rotateIfNeeded(data: string): void {
    if (this.maxBytes === undefined || this.maxFiles === undefined) return;
    let currentSize = 0;
    try {
      currentSize = fs.statSync(this.filePath).size;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== 'ENOENT') throw err;
      currentSize = 0;
    }
    const incomingBytes = Buffer.byteLength(data, 'utf-8');
    if (currentSize + incomingBytes <= this.maxBytes) return;

    // Timestamp plus a collision suffix so concurrent sessions cannot produce
    // the same rotated filename and clobber each other's renames. padEnd
    // guarantees the fixed 6-char width even for degenerate random() values.
    const token = `llxprt-rot-${Date.now()}-${Math.random()
      .toString(36)
      .slice(2, 8)
      .padEnd(6, '0')}`;
    const rotatedPath = `${this.filePath}.${token}`;
    try {
      fs.renameSync(this.filePath, rotatedPath);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      // Another writer rotated first; the active file already moved.
      if (code !== 'ENOENT') throw err;
    }
    this.enforceRetention();
  }

  private enforceRetention(): void {
    if (this.maxFiles === undefined) return;
    const dir = path.dirname(this.filePath);
    const activeBasename = path.basename(this.filePath);
    let entries: string[] = [];
    try {
      entries = fs.readdirSync(dir);
    } catch {
      return; // Fail open: missing/unreadable dir is not ours to fix here.
    }
    const rotated = entries
      .filter(
        (entry) =>
          entry.startsWith(`${activeBasename}.`) &&
          ROTATION_TOKEN_RE.test(entry.slice(activeBasename.length + 1)),
      )
      .map((entry) => {
        const full = path.join(dir, entry);
        let mtime = 0;
        try {
          mtime = fs.statSync(full).mtimeMs;
        } catch {
          // Stat may race a concurrent retention unlink; treat as oldest.
          mtime = 0;
        }
        return { full, mtime, name: entry };
      })
      .sort((a, b) => {
        if (a.mtime !== b.mtime) return a.mtime - b.mtime;
        if (a.name < b.name) return -1;
        if (a.name > b.name) return 1;
        return 0;
      });
    const excess = rotated.length - this.maxFiles;
    for (let i = 0; i < excess; i++) {
      try {
        fs.unlinkSync(rotated[i].full);
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code !== 'ENOENT') throw err;
      }
    }
  }

  shutdown(): Promise<void> {
    // Nothing to do for sync writes
    return Promise.resolve();
  }

  forceFlush(): Promise<void> {
    // Writes are synchronous (appendFileSync), so there is never any
    // pending/buffered data to flush.
    return Promise.resolve();
  }
}

function toSerializableSpan(span: ReadableSpan): object {
  return {
    name: span.name,
    kind: span.kind,
    spanContext: span.spanContext(),
    parentSpanId: span.parentSpanContext?.spanId ?? null,
    startTime: span.startTime,
    endTime: span.endTime,
    status: span.status,
    attributes: span.attributes,
    links: span.links,
    events: span.events,
    duration: span.duration,
    ended: span.ended,
    resource: span.resource,
    instrumentationScope: span.instrumentationScope,
    droppedAttributesCount: span.droppedAttributesCount,
    droppedEventsCount: span.droppedEventsCount,
    droppedLinksCount: span.droppedLinksCount,
  };
}

export class FileSpanExporter extends FileExporter implements SpanExporter {
  export(
    spans: ReadableSpan[],
    resultCallback: (result: ExportResult) => void,
  ): void {
    // One writeToFile per record, not a joined batch: rotation is evaluated
    // per record, so the active file overshoots the cap by at most one record
    // instead of one batch.
    try {
      for (const span of spans) {
        this.writeToFile(this.serialize(toSerializableSpan(span)));
      }
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
    // Per-record writes for the same cap-overshoot reason as spans.
    try {
      for (const log of logs) {
        this.writeToFile(this.serialize(log));
      }
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

  selectAggregationTemporality(
    _instrumentType: InstrumentType,
  ): AggregationTemporality {
    // DELTA so each 10s export carries only changes since the previous export;
    // a CUMULATIVE stream re-serializes all accumulated series every interval.
    // This is the method the OTel MetricExporter contract defines —
    // PeriodicExportingMetricReader binds it per instrument type.
    return AggregationTemporality.DELTA;
  }

  override forceFlush(): Promise<void> {
    return Promise.resolve();
  }
}
