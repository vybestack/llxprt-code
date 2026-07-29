/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  FileSpanExporter,
  FileLogExporter,
  FileMetricExporter,
} from './file-exporters.js';
import { BasicTracerProvider } from '@opentelemetry/sdk-trace-base';
import {
  LoggerProvider,
  InMemoryLogRecordExporter,
  SimpleLogRecordProcessor,
} from '@opentelemetry/sdk-logs';
import {
  AggregationTemporality,
  type ResourceMetrics,
} from '@opentelemetry/sdk-metrics';
import { resourceFromAttributes } from '@opentelemetry/resources';
import type { ExportResult } from '@opentelemetry/core';
import type { ReadableSpan } from '@opentelemetry/sdk-trace-base';
import type { ReadableLogRecord } from '@opentelemetry/sdk-logs';

const TMP_DIR = path.join(
  os.tmpdir(),
  `llxprt-file-exporters-test-${process.pid}`,
);

function setupTempDir(): void {
  fs.rmSync(TMP_DIR, { recursive: true, force: true });
  fs.mkdirSync(TMP_DIR, { recursive: true });
}

function teardownTempDir(): void {
  fs.rmSync(TMP_DIR, { recursive: true, force: true });
}

function createOutfilePath(name: string): string {
  return path.join(TMP_DIR, name);
}

function readOutfile(filePath: string): string {
  return fs.readFileSync(filePath, 'utf-8');
}

/**
 * Produce a real, fully-formed ReadableSpan using a tracer provider so the
 * exporter serializes genuine telemetry data rather than a hand-rolled stub.
 */
async function makeReadableSpan(name: string): Promise<ReadableSpan> {
  const provider = new BasicTracerProvider();
  const tracer = provider.getTracer('test-tracer');
  const span = tracer.startSpan(name);
  span.setAttribute('test.attr', 'value');
  span.end();
  await provider.forceFlush();
  await provider.shutdown();
  // The SDK's span object satisfies ReadableSpan after end().
  return span as unknown as ReadableSpan;
}

/**
 * Produce a real ReadableLogRecord using the logs SDK so the exporter gets a
 * genuine record shape.
 */
async function makeReadableLogRecord(body: string): Promise<ReadableLogRecord> {
  const exporter = new InMemoryLogRecordExporter();
  const loggerProvider = new LoggerProvider({
    processors: [new SimpleLogRecordProcessor(exporter)],
  });
  const logger = loggerProvider.getLogger('test-logger');
  logger.emit({
    body,
    attributes: { 'test.attr': 'value' },
  });
  const records = exporter.getFinishedLogRecords();
  if (records.length === 0) {
    throw new Error('Expected at least one finished log record');
  }
  // Release SDK background resources (processors, scheduled exports).
  await loggerProvider.shutdown();
  return records[0];
}

describe('FileSpanExporter serialization format', () => {
  beforeEach(() => {
    setupTempDir();
  });

  afterEach(() => {
    teardownTempDir();
  });

  it('writes compact JSON (no pretty-print indentation) — one object per line', async () => {
    const outfile = createOutfilePath('spans.jsonl');
    const exporter = new FileSpanExporter(outfile);
    const span = await makeReadableSpan('compact-test-span');

    const result = await new Promise<ExportResult>((resolve) => {
      exporter.export([span], resolve);
    });

    expect(result).toMatchObject({ code: 0 }); // ExportResultCode.SUCCESS

    const content = readOutfile(outfile);
    // Compact JSON must not contain the 2-space indentation that
    // pretty-printing produces. A single span is one line.
    expect(content).not.toContain('\n  ');
    expect(content.trim().split('\n').length).toBe(1);
    // The serialized line must round-trip to an object with the span name.
    const parsed = JSON.parse(content.trim());
    expect(parsed.name).toBe('compact-test-span');
  });

  it('appends each export call as a new JSONL line (no full-file rewrite)', async () => {
    const outfile = createOutfilePath('spans-multi.jsonl');
    const exporter = new FileSpanExporter(outfile);
    const span1 = await makeReadableSpan('span-one');
    const span2 = await makeReadableSpan('span-two');

    await new Promise<ExportResult>((resolve) => {
      exporter.export([span1], resolve);
    });
    await new Promise<ExportResult>((resolve) => {
      exporter.export([span2], resolve);
    });

    const lines = readOutfile(outfile).trim().split('\n');
    expect(lines.length).toBe(2);
    expect(JSON.parse(lines[0]).name).toBe('span-one');
    expect(JSON.parse(lines[1]).name).toBe('span-two');
  });
});

describe('FileLogExporter serialization format', () => {
  beforeEach(() => {
    setupTempDir();
  });

  afterEach(() => {
    teardownTempDir();
  });

  it('writes compact JSON (no pretty-print indentation)', async () => {
    const outfile = createOutfilePath('logs.jsonl');
    const exporter = new FileLogExporter(outfile);
    const record = await makeReadableLogRecord('compact-log-body');

    const result = await new Promise<ExportResult>((resolve) => {
      exporter.export([record], resolve);
    });

    expect(result).toMatchObject({ code: 0 });
    const content = readOutfile(outfile);
    expect(content).not.toContain('\n  ');
    const parsed = JSON.parse(content.trim());
    expect(parsed._body).toBe('compact-log-body');
  });
});

describe('FileMetricExporter serialization format', () => {
  beforeEach(() => {
    setupTempDir();
  });

  afterEach(() => {
    teardownTempDir();
  });

  it('writes compact JSON (no pretty-print indentation)', async () => {
    const outfile = createOutfilePath('metrics.jsonl');
    const exporter = new FileMetricExporter(outfile);

    const resourceMetrics: ResourceMetrics = {
      resource: resourceFromAttributes({ 'service.name': 'test-service' }),
      scopeMetrics: [],
    };

    const result = await new Promise<ExportResult>((resolve) => {
      exporter.export(resourceMetrics, resolve);
    });

    expect(result).toMatchObject({ code: 0 });
    const content = readOutfile(outfile);
    expect(content).not.toContain('\n  ');
    const parsed = JSON.parse(content.trim());
    // Validate the actual metric data structure, not just resource presence.
    expect(parsed.scopeMetrics).toStrictEqual([]);
    // Behavior-level: the serialized resource should round-trip the same
    // attributes as the source resource (avoiding coupling to OTel SDK
    // internals like _rawAttributes).
    expect(JSON.stringify(resourceMetrics.resource)).toBe(
      JSON.stringify(parsed.resource),
    );
  });

  it('reports CUMULATIVE aggregation temporality', () => {
    const exporter = new FileMetricExporter(createOutfilePath('m.jsonl'));
    expect(exporter.getPreferredAggregationTemporality()).toBe(
      AggregationTemporality.CUMULATIVE,
    );
  });
});
