/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  BasicTracerProvider,
  SimpleSpanProcessor,
  InMemorySpanExporter,
  type ReadableSpan,
} from '@opentelemetry/sdk-trace-base';
import {
  LoggerProvider,
  InMemoryLogRecordExporter,
  SimpleLogRecordProcessor,
  type ReadableLogRecord,
} from '@opentelemetry/sdk-logs';
import {
  AggregationTemporality,
  type ResourceMetrics,
} from '@opentelemetry/sdk-metrics';
import { resourceFromAttributes } from '@opentelemetry/resources';
import type { ExportResult } from '@opentelemetry/core';
import {
  FileSpanExporter,
  FileLogExporter,
  FileMetricExporter,
} from './file-exporters.js';

describe('FileSpanExporter', () => {
  const directories: string[] = [];

  afterEach(() => {
    for (const directory of directories.splice(0)) {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('writes readable spans to JSONL with complex fields projected', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'llxprt-span-exporter-'));
    directories.push(directory);
    const outfile = join(directory, 'spans.jsonl');
    const provider = new BasicTracerProvider({
      spanProcessors: [new SimpleSpanProcessor(new FileSpanExporter(outfile))],
    });

    const span = provider
      .getTracer('file-exporter-test')
      .startSpan('local-span');
    span.setAttribute('local.attribute', 'value');
    span.end();
    await provider.forceFlush();
    await provider.shutdown();

    const exported = JSON.parse(readFileSync(outfile, 'utf8')) as {
      name: string;
      attributes: Record<string, unknown>;
      instrumentationScope: { name: string };
      spanContext: { spanId: string; traceId: string };
    };
    expect(exported.name).toBe('local-span');
    expect(exported.attributes).toStrictEqual({ 'local.attribute': 'value' });
    expect(exported.instrumentationScope.name).toBe('file-exporter-test');
    expect(exported.spanContext.spanId).toHaveLength(16);
    expect(exported.spanContext.traceId).toHaveLength(32);
  });
});

/**
 * Produce a real, fully-formed ReadableSpan via the SDK pipeline so the
 * exporter serializes genuine telemetry data rather than a hand-rolled stub.
 * Uses InMemorySpanExporter to capture the finished ReadableSpan from the
 * pipeline instead of casting a raw Span.
 */
async function makeReadableSpan(name: string): Promise<ReadableSpan> {
  const memExporter = new InMemorySpanExporter();
  const provider = new BasicTracerProvider({
    spanProcessors: [new SimpleSpanProcessor(memExporter)],
  });
  const tracer = provider.getTracer('test-tracer');
  const span = tracer.startSpan(name);
  span.setAttribute('test.attr', 'value');
  span.end();
  await provider.forceFlush();
  // Capture spans before shutdown — InMemorySpanExporter clears its buffer
  // on shutdown.
  const finished = memExporter.getFinishedSpans();
  await provider.shutdown();
  if (finished.length === 0) {
    throw new Error('Expected at least one finished span');
  }
  return finished[0];
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
  await loggerProvider.shutdown();
  return records[0];
}

describe('FileSpanExporter serialization format', () => {
  const directories: string[] = [];

  afterEach(() => {
    for (const directory of directories.splice(0)) {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  function createOutfilePath(name: string): string {
    const directory = mkdtempSync(join(tmpdir(), 'llxprt-format-test-'));
    directories.push(directory);
    return join(directory, name);
  }

  it('writes compact JSON (no pretty-print indentation) — one object per line', async () => {
    const outfile = createOutfilePath('spans.jsonl');
    const exporter = new FileSpanExporter(outfile);
    const span = await makeReadableSpan('compact-test-span');

    const result = await new Promise<ExportResult>((resolve) => {
      exporter.export([span], resolve);
    });

    expect(result).toMatchObject({ code: 0 }); // ExportResultCode.SUCCESS

    const content = readFileSync(outfile, 'utf-8');
    expect(content).not.toContain('\n  ');
    expect(content.trim().split('\n').length).toBe(1);
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

    const lines = readFileSync(outfile, 'utf-8').trim().split('\n');
    expect(lines.length).toBe(2);
    expect(JSON.parse(lines[0]).name).toBe('span-one');
    expect(JSON.parse(lines[1]).name).toBe('span-two');
  });
});

describe('FileLogExporter serialization format', () => {
  const directories: string[] = [];

  afterEach(() => {
    for (const directory of directories.splice(0)) {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('writes compact JSON (no pretty-print indentation)', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'llxprt-log-format-test-'));
    directories.push(directory);
    const outfile = join(directory, 'logs.jsonl');
    const exporter = new FileLogExporter(outfile);
    const record = await makeReadableLogRecord('compact-log-body');

    const result = await new Promise<ExportResult>((resolve) => {
      exporter.export([record], resolve);
    });

    expect(result).toMatchObject({ code: 0 });
    const content = readFileSync(outfile, 'utf-8');
    expect(content).not.toContain('\n  ');
    const parsed = JSON.parse(content.trim());
    expect(parsed._body).toBe('compact-log-body');
  });
});

describe('FileMetricExporter serialization format', () => {
  const directories: string[] = [];

  afterEach(() => {
    for (const directory of directories.splice(0)) {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('writes compact JSON (no pretty-print indentation)', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'llxprt-metric-format-test-'));
    directories.push(directory);
    const outfile = join(directory, 'metrics.jsonl');
    const exporter = new FileMetricExporter(outfile);

    const resourceMetrics: ResourceMetrics = {
      resource: resourceFromAttributes({ 'service.name': 'test-service' }),
      scopeMetrics: [],
    };

    const result = await new Promise<ExportResult>((resolve) => {
      exporter.export(resourceMetrics, resolve);
    });

    expect(result).toMatchObject({ code: 0 });
    const content = readFileSync(outfile, 'utf-8');
    expect(content).not.toContain('\n  ');
    const parsed = JSON.parse(content.trim());
    expect(parsed.scopeMetrics).toStrictEqual([]);
    expect(JSON.stringify(resourceMetrics.resource)).toBe(
      JSON.stringify(parsed.resource),
    );
  });

  it('reports CUMULATIVE aggregation temporality', () => {
    const directory = mkdtempSync(join(tmpdir(), 'llxprt-temp-test-'));
    directories.push(directory);
    const exporter = new FileMetricExporter(join(directory, 'm.jsonl'));
    expect(exporter.getPreferredAggregationTemporality()).toBe(
      AggregationTemporality.CUMULATIVE,
    );
  });
});
