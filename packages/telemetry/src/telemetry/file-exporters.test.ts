/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  readdirSync,
  statSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { afterEach, describe, expect, it } from 'bun:test';
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
  InstrumentType,
  MeterProvider,
  PeriodicExportingMetricReader,
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
  await loggerProvider.shutdown();
  if (records.length === 0) {
    throw new Error('Expected at least one finished log record');
  }
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

  it('appends each export call as a new JSONL line (no full-file rewrite)', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'llxprt-log-multi-test-'));
    directories.push(directory);
    const outfile = join(directory, 'logs-multi.jsonl');
    const exporter = new FileLogExporter(outfile);
    const rec1 = await makeReadableLogRecord('log-one');
    const rec2 = await makeReadableLogRecord('log-two');

    await new Promise<ExportResult>((resolve) => {
      exporter.export([rec1], resolve);
    });
    await new Promise<ExportResult>((resolve) => {
      exporter.export([rec2], resolve);
    });

    const lines = readFileSync(outfile, 'utf-8').trim().split('\n');
    expect(lines.length).toBe(2);
    expect(JSON.parse(lines[0])._body).toBe('log-one');
    expect(JSON.parse(lines[1])._body).toBe('log-two');
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

  it('selects DELTA aggregation temporality via the OTel exporter contract', () => {
    const directory = mkdtempSync(join(tmpdir(), 'llxprt-temp-test-'));
    directories.push(directory);
    const exporter = new FileMetricExporter(join(directory, 'm.jsonl'));
    // PeriodicExportingMetricReader binds exporter.selectAggregationTemporality
    // per instrument type; a differently-named method would silently leave the
    // reader on CUMULATIVE.
    expect(exporter.selectAggregationTemporality(InstrumentType.COUNTER)).toBe(
      AggregationTemporality.DELTA,
    );
    expect(
      exporter.selectAggregationTemporality(InstrumentType.HISTOGRAM),
    ).toBe(AggregationTemporality.DELTA);
  });

  it('effective SDK pipeline exports deltas, not cumulative replay', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'llxprt-delta-pipe-'));
    directories.push(directory);
    const outfile = join(directory, 'metrics-pipe.jsonl');
    const exporter = new FileMetricExporter(outfile);
    const reader = new PeriodicExportingMetricReader({
      exporter,
      exportIntervalMillis: 60_000,
    });
    const provider = new MeterProvider({ readers: [reader] });
    const counter = provider
      .getMeter('delta-pipe-test')
      .createCounter('pipe.counter');

    counter.add(5);
    await provider.forceFlush();
    counter.add(3);
    await provider.forceFlush();
    await provider.shutdown();

    const lines = readFileSync(outfile, 'utf-8').trim().split('\n');
    expect(lines.length).toBe(2);
    const first = pipeCounter(JSON.parse(lines[0]) as DumpShape);
    const second = pipeCounter(JSON.parse(lines[1]) as DumpShape);
    expect(first.value).toBe(5);
    // CUMULATIVE would re-serialize the full 8 here.
    expect(second.value).toBe(3);
    expect(first.temporality).toBe(AggregationTemporality.DELTA);
    expect(second.temporality).toBe(AggregationTemporality.DELTA);
  });

  it('does not re-serialize unbounded cumulative state: a delta export reflects only provided data', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'llxprt-metric-delta-test-'));
    directories.push(directory);
    const outfile = join(directory, 'metrics-delta.jsonl');
    const exporter = new FileMetricExporter(outfile);

    const first: ResourceMetrics = {
      resource: resourceFromAttributes({ 'service.name': 'test-service' }),
      scopeMetrics: [
        {
          scope: { name: 'scope', version: '1' },
          metrics: [],
        },
      ],
    };
    const second: ResourceMetrics = {
      resource: resourceFromAttributes({ 'service.name': 'test-service' }),
      scopeMetrics: [],
    };

    await new Promise<ExportResult>((resolve) => {
      exporter.export(first, resolve);
    });
    await new Promise<ExportResult>((resolve) => {
      exporter.export(second, resolve);
    });

    const lines = readFileSync(outfile, 'utf-8').trim().split('\n');
    // Each line carries only what was provided at that export; the second export
    // has no metrics at all, so its payload is tiny rather than a full replay.
    expect(JSON.parse(lines[1]).scopeMetrics).toStrictEqual([]);
    expect(Buffer.byteLength(lines[1], 'utf-8')).toBeLessThan(
      Buffer.byteLength(lines[0], 'utf-8'),
    );
  });
});

describe('FileExporter rotation (REQ-3315.4, REQ-3315.6)', () => {
  const directories: string[] = [];

  afterEach(() => {
    for (const directory of directories.splice(0)) {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  function makeDir(): string {
    const directory = mkdtempSync(join(tmpdir(), 'llxprt-rotation-'));
    directories.push(directory);
    return directory;
  }

  function rotatedPattern(entry: string, base: string): boolean {
    return (
      entry.startsWith(base + '.') &&
      /^llxprt-rot-\d+-[0-9a-z]{6}$/.test(entry.slice(base.length + 1))
    );
  }

  function rotatedFiles(dir: string, outfile: string): string[] {
    const base = basename(outfile);
    return readdirSync(dir)
      .filter((entry) => rotatedPattern(entry, base))
      .map((entry) => join(dir, entry));
  }

  it('rotates the active file when the next write would exceed maxBytes', () => {
    const dir = makeDir();
    const outfile = join(dir, 'logs.jsonl');
    const exporter = new FileLogExporter(outfile, {
      maxBytes: 400,
      maxFiles: 3,
    });
    exporter.export([makeLogRecord('alpha')], () => undefined);
    const activeSize = statSync(outfile).size;
    expect(activeSize).toBeLessThanOrEqual(400);

    const previous = readFileSync(outfile, 'utf-8');
    exporter.export([makeLogRecord('beta')], () => undefined);

    const rotated = rotatedFiles(dir, outfile);
    expect(
      rotated.some((file) => readFileSync(file, 'utf-8') === previous),
    ).toBe(true);
    expect(readFileSync(outfile, 'utf-8')).toContain('beta');
  });

  it('retention converges: rotated-file count never exceeds maxFiles', () => {
    const dir = makeDir();
    const outfile = join(dir, 'retention.jsonl');
    const exporter = new FileLogExporter(outfile, {
      maxBytes: 50,
      maxFiles: 3,
    });

    for (let i = 0; i < 20; i++) {
      exporter.export([makeLogRecord('record-' + i)], () => undefined);
    }

    expect(rotatedFiles(dir, outfile).length).toBeLessThanOrEqual(3);
  });

  it('active file stays within cap + one record (overshoot allowed for a single record)', () => {
    const dir = makeDir();
    const outfile = join(dir, 'overshoot.jsonl');
    const exporter = new FileLogExporter(outfile, {
      maxBytes: 200,
      maxFiles: 5,
    });
    const biggest = Buffer.byteLength(
      JSON.stringify(makeLogRecord('payload')) + '\n',
      'utf-8',
    );

    for (let i = 0; i < 10; i++) {
      exporter.export([makeLogRecord('payload')], () => undefined);
      expect(statSync(outfile).size).toBeLessThanOrEqual(200 + biggest);
    }
  });

  it('two interleaved writer instances sharing a path stay bounded and uncorrupted (best-effort cap: one in-flight record per writer)', () => {
    const dir = makeDir();
    const outfile = join(dir, 'concurrent.jsonl');
    const cap = 150;
    const maxFiles = 4;
    const a = new FileLogExporter(outfile, { maxBytes: cap, maxFiles });
    const b = new FileLogExporter(outfile, { maxBytes: cap, maxFiles });

    for (let i = 0; i < 30; i++) {
      a.export([makeLogRecord('writer-a-' + i)], () => undefined);
      b.export([makeLogRecord('writer-b-' + i)], () => undefined);
    }

    const recordSize = Buffer.byteLength(
      JSON.stringify(makeLogRecord('writer-a-0')) + '\n',
      'utf-8',
    );
    const allFiles = [outfile, ...rotatedFiles(dir, outfile)];
    for (const file of allFiles) {
      const size = statSync(file).size;
      expect(size).toBeLessThanOrEqual(cap + 2 * recordSize + 1);
      for (const line of readFileSync(file, 'utf-8').trim().split('\n')) {
        if (line.length > 0) JSON.parse(line);
      }
    }
    expect(allFiles.length).toBeLessThanOrEqual(maxFiles + 1);
  });

  it('single record larger than the cap is still written whole', () => {
    const dir = makeDir();
    const outfile = join(dir, 'big-record.jsonl');
    const exporter = new FileLogExporter(outfile, {
      maxBytes: 1000,
      maxFiles: 2,
    });
    const big = makeLogRecord('x'.repeat(5000));
    exporter.export([big], () => undefined);
    expect(readFileSync(outfile, 'utf-8')).toContain('x'.repeat(5000));
  });

  it('constructor throws RangeError on invalid maxBytes/maxFiles', () => {
    const dir = makeDir();
    expect(
      () =>
        new FileLogExporter(join(dir, 'a.jsonl'), { maxBytes: 0, maxFiles: 2 }),
    ).toThrow(RangeError);
    expect(
      () =>
        new FileLogExporter(join(dir, 'b.jsonl'), {
          maxBytes: 100,
          maxFiles: 0,
        }),
    ).toThrow(RangeError);
    expect(
      () =>
        new FileLogExporter(join(dir, 'c.jsonl'), {
          maxBytes: Number.NaN,
          maxFiles: 2,
        }),
    ).toThrow(RangeError);
    expect(
      () =>
        new FileLogExporter(join(dir, 'd.jsonl'), {
          maxBytes: 100,
          maxFiles: Number.POSITIVE_INFINITY,
        }),
    ).toThrow(RangeError);
  });

  it('retention only prunes rotation-token files; similarly prefixed foreign files survive', () => {
    const dir = makeDir();
    const outfile = join(dir, 'foreign.jsonl');
    const foreignBackup = join(dir, 'foreign.jsonl.backup');
    // `2026-notes` matches the naive `<digits>-<lowercase>` shape that the
    // pre-namespace retention predicate could delete; it must survive.
    const foreignNotes = join(dir, 'foreign.jsonl.2026-notes');
    writeFileSync(foreignBackup, 'user backup data', 'utf-8');
    writeFileSync(foreignNotes, 'user notes', 'utf-8');

    const exporter = new FileLogExporter(outfile, {
      maxBytes: 50,
      maxFiles: 1,
    });
    for (let i = 0; i < 10; i++) {
      exporter.export([makeLogRecord('record-' + i)], () => undefined);
    }

    expect(readFileSync(foreignBackup, 'utf-8')).toBe('user backup data');
    expect(readFileSync(foreignNotes, 'utf-8')).toBe('user notes');
    expect(rotatedFiles(dir, outfile).length).toBeLessThanOrEqual(1);
  });

  it('retention prunes oldest rotated files first (mtime, then name)', () => {
    const dir = makeDir();
    const outfile = join(dir, 'ordered.jsonl');
    const base = basename(outfile);
    const old = join(dir, `${base}.llxprt-rot-1000000000000-aaaaaa`);
    const mid = join(dir, `${base}.llxprt-rot-1000000000001-bbbbbb`);
    const recent = join(dir, `${base}.llxprt-rot-1000000000002-cccccc`);
    writeFileSync(old, 'old', 'utf-8');
    writeFileSync(mid, 'mid', 'utf-8');
    writeFileSync(recent, 'recent', 'utf-8');
    const t = Date.now() / 1000;
    utimesSync(old, t - 3000, t - 3000);
    utimesSync(mid, t - 2000, t - 2000);
    utimesSync(recent, t - 1000, t - 1000);

    const exporter = new FileLogExporter(outfile, {
      maxBytes: 50,
      maxFiles: 3,
    });
    // Every record exceeds the cap, so each write after the first rotates the
    // active file: three exports yield two new rotated files, so retention
    // must prune exactly the two oldest seeded files and keep `recent`.
    for (let i = 0; i < 3; i++) {
      exporter.export([makeLogRecord('prune-' + i)], () => undefined);
    }

    expect(existsSync(old)).toBe(false);
    expect(existsSync(mid)).toBe(false);
    expect(existsSync(recent)).toBe(true);
    expect(rotatedFiles(dir, outfile).length).toBeLessThanOrEqual(3);
  });

  it.skipIf(typeof process.getuid === 'function' && process.getuid() === 0)(
    'fails open: rotation errors fall back to append so export still succeeds',
    () => {
      const dir = makeDir();
      const outfile = join(dir, 'failopen.jsonl');
      writeFileSync(outfile, 'seed', 'utf-8');
      const exporter = new FileLogExporter(outfile, {
        maxBytes: 10,
        maxFiles: 2,
      });
      // A read-only directory makes renameSync fail with EACCES (not ENOENT),
      // exercising the fail-open path: the record must still be appended.
      chmodSync(dir, 0o500);
      let resultCode: number | undefined;
      try {
        exporter.export([makeLogRecord('still-appends')], (result) => {
          resultCode = result.code;
        });
        expect(resultCode).toBe(0);
        expect(readFileSync(outfile, 'utf-8')).toContain('still-appends');
      } finally {
        chmodSync(dir, 0o700);
      }
    },
  );

  it('FileMetricExporter rotates under the same cap and retention policy', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'llxprt-metric-rot-'));
    directories.push(directory);
    const outfile = join(directory, 'metrics-rot.jsonl');
    const exporter = new FileMetricExporter(outfile, {
      maxBytes: 400,
      maxFiles: 2,
    });

    for (let i = 0; i < 6; i++) {
      const batch: ResourceMetrics = {
        resource: resourceFromAttributes({ 'service.name': 'test-service' }),
        scopeMetrics: [
          {
            scope: { name: 'scope', version: '1' },
            metrics: [],
          },
        ],
      };
      await new Promise<ExportResult>((resolve) => {
        exporter.export(batch, resolve);
      });
    }

    const rotated = rotatedFiles(directory, outfile);
    expect(rotated.length).toBeGreaterThanOrEqual(1);
    expect(rotated.length).toBeLessThanOrEqual(2);
    for (const line of readFileSync(outfile, 'utf-8').trim().split('\n')) {
      if (line.length > 0) JSON.parse(line);
    }
  });

  it('a multi-record batch still respects cap + one record per file (per-record writes)', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'llxprt-batch-cap-'));
    directories.push(directory);
    const outfile = join(directory, 'batch.jsonl');
    const exporter = new FileLogExporter(outfile, {
      maxBytes: 500,
      maxFiles: 5,
    });
    const single = JSON.stringify(makeLogRecord('payload')) + '\n';
    const recordBytes = Buffer.byteLength(single, 'utf-8');

    // One export() call carrying three records. A joined-batch writer would
    // append all three after rotation (overshoot 3 records); the per-record
    // writer must keep every file at cap + at most one record.
    exporter.export(
      [
        makeLogRecord('payload'),
        makeLogRecord('payload'),
        makeLogRecord('payload'),
      ],
      () => undefined,
    );

    const base = basename(outfile);
    const files = readdirSync(directory)
      .filter((entry) => entry === base || rotatedPattern(entry, base))
      .map((entry) => join(directory, entry));
    for (const file of files) {
      expect(statSync(file).size).toBeLessThanOrEqual(500 + recordBytes);
    }
  });

  it('equal-mtime rotated files break the retention tie by name (lexicographic)', () => {
    const dir = makeDir();
    const outfile = join(dir, 'tiebreak.jsonl');
    const base = basename(outfile);
    const aaa = join(dir, `${base}.llxprt-rot-1000000000000-aaaaaa`);
    const zzz = join(dir, `${base}.llxprt-rot-1000000000000-zzzzzz`);
    writeFileSync(aaa, 'a', 'utf-8');
    writeFileSync(zzz, 'z', 'utf-8');
    const same = Date.now() / 1000;
    utimesSync(aaa, same, same);
    utimesSync(zzz, same, same);

    const exporter = new FileLogExporter(outfile, {
      maxBytes: 50,
      maxFiles: 1,
    });
    for (let i = 0; i < 3; i++) {
      exporter.export([makeLogRecord('tie-' + i)], () => undefined);
    }

    // Both seeded files share an mtime with each other (though not with the
    // new rotations); when pruning must choose between them, the smaller name
    // is older by convention and goes first.
    expect(existsSync(aaa)).toBe(false);
  });

  it('FileSpanExporter rotates under the same cap and retention policy', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'llxprt-span-rot-'));
    directories.push(directory);
    const outfile = join(directory, 'spans-rot.jsonl');
    const exporter = new FileSpanExporter(outfile, {
      maxBytes: 400,
      maxFiles: 2,
    });

    for (let i = 0; i < 6; i++) {
      const span = await makeReadableSpan('rotation-span-' + i);
      await new Promise<ExportResult>((resolve) => {
        exporter.export([span], resolve);
      });
    }

    const rotated = rotatedFiles(directory, outfile);
    expect(rotated.length).toBeGreaterThanOrEqual(1);
    expect(rotated.length).toBeLessThanOrEqual(2);
  });
});

function makeLogRecord(body: string): ReadableLogRecord {
  return {
    _body: body,
    attributes: { 'test.attr': 'value' },
    timestamp: new Date().toISOString(),
    observedTimestamp: new Date().toISOString(),
    severityNumber: 9,
    severityText: 'INFO',
    instrumentationScope: { name: 'test-logger' },
    resource: { attributes: { 'service.name': 'test-service' } },
  } as unknown as ReadableLogRecord;
}

/** Minimal shape of a serialized ResourceMetrics dump for the delta-pipe test. */
interface DumpShape {
  scopeMetrics: Array<{
    metrics: Array<{
      descriptor?: { name?: string };
      aggregationTemporality?: number;
      dataPoints?: Array<{ value?: number }>;
    }>;
  }>;
}

function pipeCounter(dump: DumpShape): {
  value: number | undefined;
  temporality: number | undefined;
} {
  for (const scope of dump.scopeMetrics) {
    for (const metric of scope.metrics) {
      if (metric.descriptor?.name === 'pipe.counter') {
        return {
          value: metric.dataPoints?.[0]?.value,
          temporality: metric.aggregationTemporality,
        };
      }
    }
  }
  return { value: undefined, temporality: undefined };
}
