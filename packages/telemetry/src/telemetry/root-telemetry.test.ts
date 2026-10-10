/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, describe, expect, it } from 'bun:test';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  unlinkSync,
  rmSync,
} from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { z } from 'zod';
import { metrics, trace } from '@opentelemetry/api';
import { logs } from '@opentelemetry/api-logs';
import { ExportResultCode, type ExportResult } from '@opentelemetry/core';
import type {
  LogRecordExporter,
  ReadableLogRecord,
} from '@opentelemetry/sdk-logs';
import {
  type PushMetricExporter,
  type ResourceMetrics,
  type InstrumentType,
  type AggregationOption,
  AggregationTemporality,
} from '@opentelemetry/sdk-metrics';
import {
  FileLogExporter,
  FileMetricExporter,
  FileSpanExporter,
} from './file-exporters.js';
import {
  initializeTelemetry,
  flushTelemetry,
  shutdownTelemetry,
  isTelemetrySdkInitialized,
} from './sdk.js';
import {
  recordTokenUsageMetrics,
  recordFileOperationMetric,
  FileOperation,
} from './metrics.js';
import { createRootTelemetry, RootTelemetry } from './root-telemetry.js';

const evidence = join(tmpdir(), 'llxprt-telemetry-listener');
const roots: RootTelemetry[] = [];
const logRecord = z.object({
  attributes: z.record(z.unknown()),
  body: z.unknown().optional(),
});
const spanRecord = z.object({
  name: z.string(),
  attributes: z.record(z.unknown()),
  ended: z.boolean(),
});
const metricRecord = z.object({
  scopeMetrics: z.array(
    z.object({
      metrics: z.array(
        z.object({
          descriptor: z.object({ name: z.string() }),
          dataPoints: z.array(
            z.object({ attributes: z.record(z.unknown()), value: z.unknown() }),
          ),
        }),
      ),
    }),
  ),
});

function lines(file: string): unknown[] {
  return existsSync(file)
    ? readFileSync(file, 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line))
    : [];
}

async function root(file: string, enabled = true): Promise<RootTelemetry> {
  const selected = await createRootTelemetry({
    sessionId: 'same-public-label',
    outfile: file,
    enabled,
    maxBytes: 1024 * 1024,
    maxFiles: 2,
  });
  roots.push(selected);
  return selected;
}

function output(name: string): string {
  mkdirSync(evidence, { recursive: true });
  return join(mkdtempSync(join(evidence, 'private-sdk-')), `${name}.jsonl`);
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolvePromise: () => void = () => {
    throw new Error('Deferred was not initialized');
  };
  const promise = new Promise<void>((resolveValue) => {
    resolvePromise = resolveValue;
  });
  return { promise, resolve: resolvePromise };
}

class HttpLogExporter implements LogRecordExporter {
  constructor(private readonly endpoint: string) {}
  export(
    records: ReadableLogRecord[],
    done: (result: ExportResult) => void,
  ): void {
    void fetch(this.endpoint, {
      method: 'POST',
      body: JSON.stringify(records),
    }).then(
      (response) =>
        done(
          response.ok
            ? { code: ExportResultCode.SUCCESS }
            : {
                code: ExportResultCode.FAILED,
                error: new Error(`HTTP ${response.status}`),
              },
        ),
      (error: unknown) =>
        done({
          code: ExportResultCode.FAILED,
          error: error instanceof Error ? error : new Error(String(error)),
        }),
    );
  }
  forceFlush(): Promise<void> {
    return Promise.resolve();
  }
  shutdown(): Promise<void> {
    return Promise.resolve();
  }
}

class RejectedLogExporter extends FileLogExporter {
  override export(
    _records: ReadableLogRecord[],
    done: (result: ExportResult) => void,
  ): void {
    done({
      code: ExportResultCode.FAILED,
      error: new Error('accepted log export failed'),
    });
  }
}

class FailingLogExporter extends FileLogExporter {
  override shutdown(): Promise<void> {
    return Promise.reject(new Error('log transport shutdown failed'));
  }
}
class FailingSpanExporter extends FileSpanExporter {
  override shutdown(): Promise<void> {
    return Promise.reject(new Error('span transport shutdown failed'));
  }
}
class BrokenMetricExporter implements PushMetricExporter {
  get selectAggregationTemporality(): (
    instrument: InstrumentType,
  ) => AggregationTemporality {
    throw new Error('metric transport startup failed');
  }
  export(
    _metrics: ResourceMetrics,
    done: (result: ExportResult) => void,
  ): void {
    done({ code: ExportResultCode.SUCCESS });
  }
  forceFlush(): Promise<void> {
    return Promise.resolve();
  }
  shutdown(): Promise<void> {
    return Promise.reject(new Error('metric transport shutdown failed'));
  }
}

class BrokenInstrumentExporter extends FileMetricExporter {
  selectAggregation(_instrument: InstrumentType): AggregationOption {
    throw new Error('metric instrument binding failed');
  }
  override shutdown(): Promise<void> {
    return Promise.reject(new Error('metric binding cleanup failed'));
  }
}

async function joinFixture(
  operations: ReadonlyArray<Promise<void>>,
): Promise<void> {
  const settled = await Promise.allSettled(operations);
  const failures = settled.flatMap((result) =>
    result.status === 'rejected' ? [result.reason] : [],
  );
  if (failures.length > 0)
    throw new AggregateError(failures, 'HTTP fixture cleanup failed');
}

async function errors(result: Promise<void>): Promise<string[]> {
  try {
    await result;
    return [];
  } catch (error) {
    if (error instanceof AggregateError)
      return error.errors.flatMap((nested: unknown) =>
        nested instanceof AggregateError
          ? nested.errors.map(String)
          : [String(nested)],
      );
    return [String(error)];
  }
}

describe('private SDK root telemetry', () => {
  afterEach(async () => {
    const outcomes = await Promise.allSettled(
      roots.splice(0).map((selected) => selected.close()),
    );
    const failures = outcomes.filter((result) => result.status === 'rejected');
    if (failures.length > 0)
      throw new AggregateError(failures, 'Test root cleanup failed');
  });
  it('keeps package SDK and metric entry points on the explicitly selected lifetime', async () => {
    const file = output('package-operations');
    const peerFile = output('package-peer');
    const selected = await root(file, false);
    const peer = await root(peerFile);
    await initializeTelemetry(selected);
    selected.events.record(() => ({ body: 'selected package event' }));
    recordTokenUsageMetrics(selected, 'package-model', 37, 'input');
    recordFileOperationMetric(
      selected,
      FileOperation.READ,
      4,
      'application/json',
      'json',
    );
    await flushTelemetry(selected);
    expect(isTelemetrySdkInitialized(selected)).toBe(true);
    expect(readFileSync(file, 'utf8')).toContain('package-model');
    expect(readFileSync(file, 'utf8')).toContain('application/json');
    peer.events.record(() => ({ body: 'peer control' }));
    await peer.flush();
    expect(readFileSync(peerFile, 'utf8')).not.toContain('package-model');
    await shutdownTelemetry(selected);
    expect(isTelemetrySdkInitialized(selected)).toBe(false);
    selected.events.record(() => {
      throw new Error('Package shutdown left admission open');
    });
    await flushTelemetry(selected);
  });

  it('joins an activation interrupted by close without reopening the event ports', async () => {
    const file = output('activation-close');
    const selected = await root(file, false);
    const enabling = selected.setEnabled(true);
    await Promise.resolve();
    const closing = selected.close();
    await Promise.all([enabling, closing]);
    selected.events.record(() => {
      throw new Error('An interrupted activation reopened a closed root');
    });
    selected.spans.start('POST-CLOSE-ACTIVATION').end();
    expect(
      lines(file).flatMap((item) => {
        const parsed = spanRecord.safeParse(item);
        return parsed.success ? [parsed.data.name] : [];
      }),
    ).not.toContain('POST-CLOSE-ACTIVATION');
  });

  it('retries activation after an external transport startup failure without retaining the rejected queue', async () => {
    const file = output('activation-retry');
    let attempts = 0;
    const selected = RootTelemetry.prepare(
      {
        sessionId: 'retry',
        outfile: file,
        enabled: false,
        maxBytes: 1048576,
        maxFiles: 2,
      },
      () => {
        attempts += 1;
        return {
          logger: new FileLogExporter(file),
          tracer: new FileSpanExporter(file),
          meter:
            attempts === 1
              ? new BrokenMetricExporter()
              : new FileMetricExporter(file),
        };
      },
    );
    expect(await errors(selected.setEnabled(true))).toContain(
      'Error: metric transport startup failed',
    );
    try {
      await selected.setEnabled(true);
      selected.events.record(() => ({ body: 'physical retry succeeded' }));
      await selected.flush();
      expect(readFileSync(file, 'utf8')).toContain('physical retry succeeded');
      expect(selected.isEnabled()).toBe(true);
    } finally {
      await errors(selected.close());
    }
  });

  it('retries enable after a physical failed retirement and does not export through the retired generation', async () => {
    const file = output('retirement-retry');
    const selected = await root(file);
    selected.events.record(() => ({
      body: 'accepted before filesystem failure',
    }));
    await selected.flush();
    unlinkSync(file);
    mkdirSync(file);
    selected.events.record(() => ({ body: 'failed physical export' }));
    const failures = await errors(selected.setEnabled(false));
    expect(failures.join('\n')).toContain('EISDIR');
    rmSync(file, { recursive: true });
    try {
      await selected.setEnabled(true);
      selected.events.record(() => ({ body: 'new physical lifetime' }));
      await selected.flush();
      expect(readFileSync(file, 'utf8')).toContain('new physical lifetime');
      expect(readFileSync(file, 'utf8')).not.toContain(
        'failed physical export',
      );
    } finally {
      await errors(selected.close());
      roots.splice(roots.indexOf(selected), 1);
    }
  });

  it('activates only the current queued revision without exporting superseded SDK sessions', async () => {
    const file = output('queued-revision');
    const selected = await root(file, false);
    await Promise.all([
      selected.setEnabled(true),
      selected.setEnabled(false),
      selected.setEnabled(true),
    ]);
    selected.events.record(() => ({ body: 'current queued revision' }));
    await selected.flush();
    const sessions = lines(file).flatMap((item) => {
      const parsed = metricRecord.safeParse(item);
      return parsed.success
        ? parsed.data.scopeMetrics
            .flatMap((scope) => scope.metrics)
            .filter(
              (metric) =>
                metric.descriptor.name === 'llxprt_code.session.count',
            )
            .flatMap((metric) => metric.dataPoints.map((point) => point.value))
        : [];
    });
    expect(sessions).toStrictEqual([1]);
    expect(readFileSync(file, 'utf8')).toContain('current queued revision');
  });

  it('can enable after disable without reviving old accepted spans', async () => {
    const file = output('reenabled');
    const selected = await root(file);
    const oldSpan = selected.spans.start('before disable');
    await selected.setEnabled(false);
    await selected.setEnabled(true);
    oldSpan.setAttribute('late', 'RETIRED-SPAN-MARKER');
    oldSpan.end();
    selected.events.record(() => ({ body: 'enabled new generation' }));
    selected.spans.start('new generation span').end();
    await selected.flush();
    expect(readFileSync(file, 'utf8')).toContain('enabled new generation');
    expect(readFileSync(file, 'utf8')).toContain('new generation span');
    expect(readFileSync(file, 'utf8')).not.toContain('RETIRED-SPAN-MARKER');
  });

  it('routes events, spans and model/tool instruments by the actual private provider', async () => {
    const firstFile = output('first');
    const secondFile = output('second');
    const first = await root(firstFile);
    const second = await root(secondFile);
    first.events.record(() => ({
      body: 'first payload',
      attributes: { 'event.name': 'request', model: 'first-model' },
    }));
    second.events.record(() => ({
      body: 'second payload',
      attributes: { 'event.name': 'response', model: 'second-model' },
    }));
    first.spans.start('first request').end();
    second.spans.start('second request').end();
    first.measurements.modelResponse('first-model', 12, 200);
    second.measurements.toolCall('second-tool', 21, true);
    await Promise.all([first.flush(), second.flush()]);
    const firstLogs = lines(firstFile).flatMap((item) => {
      const parsed = logRecord.safeParse(item);
      return parsed.success ? [parsed.data] : [];
    });
    const secondLogs = lines(secondFile).flatMap((item) => {
      const parsed = logRecord.safeParse(item);
      return parsed.success ? [parsed.data] : [];
    });
    expect(firstLogs.map((item) => item.attributes.model)).toContain(
      'first-model',
    );
    expect(secondLogs.map((item) => item.attributes.model)).toContain(
      'second-model',
    );
    expect(readFileSync(firstFile, 'utf8')).not.toContain('second-model');
    expect(readFileSync(secondFile, 'utf8')).not.toContain('first-model');
    expect(
      lines(firstFile).flatMap((item) => {
        const parsed = spanRecord.safeParse(item);
        return parsed.success ? [parsed.data.name] : [];
      }),
    ).toContain('first request');
    const firstMetrics = lines(firstFile).flatMap((item) => {
      const parsed = metricRecord.safeParse(item);
      return parsed.success
        ? parsed.data.scopeMetrics.flatMap((scope) => scope.metrics)
        : [];
    });
    expect(
      firstMetrics.flatMap((metric) =>
        metric.dataPoints.map((point) => point.attributes.model),
      ),
    ).toContain('first-model');
    expect(readFileSync(secondFile, 'utf8')).toContain('second-tool');
  });

  it('does not collect or write disabled events/spans/instruments into either target', async () => {
    const enabledFile = output('enabled');
    const disabledFile = output('disabled');
    const enabled = await root(enabledFile);
    const disabled = await root(disabledFile, false);
    enabled.events.record(() => ({ body: 'enabled startup' }));
    disabled.events.record(() => {
      throw new Error('Disabled telemetry collected an event');
    });
    disabled.spans.start('disabled-span').end();
    disabled.measurements.modelResponse('disabled-model', 1, 200);
    await Promise.all([enabled.flush(), disabled.flush()]);
    expect(existsSync(disabledFile)).toBe(false);
    expect(readFileSync(enabledFile, 'utf8')).not.toContain('disabled');
  });

  it('does not adopt process-global API facades into private files', async () => {
    const file = output('private');
    const selected = await root(file);
    selected.events.record(() => ({ body: 'private control' }));
    trace.getTracer('unowned').startSpan('GLOBAL-SPAN-MARKER').end();
    logs.getLogger('unowned').emit({ body: 'GLOBAL-LOG-MARKER' });
    metrics.getMeter('unowned').createCounter('GLOBAL_METRIC_MARKER').add(1);
    await selected.flush();
    expect(readFileSync(file, 'utf8')).toContain('private control');
    expect(readFileSync(file, 'utf8')).not.toContain('GLOBAL-');
    expect(readFileSync(file, 'utf8')).not.toContain('GLOBAL_METRIC_MARKER');
  });

  it('closes owned spans and denies writes through old ports while a peer remains usable', async () => {
    const file = output('closed');
    const peerFile = output('peer');
    const selected = await root(file);
    const peer = await root(peerFile);
    const span = selected.spans.start('accepted span');
    selected.events.record(() => ({ body: 'accepted event' }));
    await selected.close();
    const before = readFileSync(file);
    span.setAttribute('late', 'POST-CLOSE-MARKER');
    span.end();
    selected.events.record(() => {
      throw new Error('Closed telemetry collected an event');
    });
    selected.spans.start('POST-CLOSE-SPAN').end();
    selected.measurements.toolCall('POST-CLOSE-TOOL', 1, true);
    peer.events.record(() => ({ body: 'peer remains usable' }));
    await Promise.all([selected.close(), peer.flush()]);
    expect(readFileSync(file).equals(before)).toBe(true);
    expect(
      lines(file).flatMap((item) => {
        const parsed = spanRecord.safeParse(item);
        return parsed.success ? [parsed.data.ended] : [];
      }),
    ).toContain(true);
    expect(readFileSync(peerFile, 'utf8')).toContain('peer remains usable');
  });

  it('disables collection immediately and joins accepted localhost HTTP before returning', async () => {
    const accepted = deferred();
    const release = deferred();
    const received: string[] = [];
    const receiving: Array<Promise<void>> = [];
    const server = createServer((request, response) => {
      const receive = async (): Promise<void> => {
        let body = '';
        for await (const chunk of request) body += String(chunk);
        received.push(body);
        accepted.resolve();
        await release.promise;
        response.end('ok');
      };
      const task = receive();
      receiving.push(task);
      void task.catch((error: unknown) =>
        response.destroy(
          error instanceof Error ? error : new Error(String(error)),
        ),
      );
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    if (address === null || typeof address === 'string')
      throw new Error('Expected a localhost TCP address');
    const file = output('held');
    const selected = await createRootTelemetry(
      {
        sessionId: 'held-localhost',
        outfile: file,
        enabled: true,
        maxBytes: 1024 * 1024,
        maxFiles: 2,
      },
      () => ({
        logger: new HttpLogExporter(`http://127.0.0.1:${address.port}`),
        tracer: new FileSpanExporter(file),
        meter: new FileMetricExporter(file),
      }),
    );
    roots.push(selected);
    try {
      selected.events.record(() => ({ body: 'accepted localhost payload' }));
      const flushing = selected.flush();
      await accepted.promise;
      let completed = false;
      const disabling = selected.setEnabled(false).then(() => {
        completed = true;
      });
      selected.events.record(() => {
        throw new Error('Disable waited before denying new collection');
      });
      selected.measurements.modelResponse('DENIED-MODEL', 1, 200);
      await Promise.resolve();
      expect(completed).toBe(false);
      release.resolve();
      await Promise.all([flushing, disabling]);
      expect(received).toHaveLength(1);
      expect(received[0]).toContain('accepted localhost payload');
      expect(received.join('')).not.toContain('DENIED-MODEL');
    } finally {
      release.resolve();
      try {
        await joinFixture([selected.close(), ...receiving]);
      } finally {
        await new Promise<void>((resolveValue, reject) =>
          server.close((error) => (error ? reject(error) : resolveValue())),
        );
      }
    }
  });

  it('preserves accepted export failure even when the SDK reports it through its global diagnostic handler', async () => {
    const file = output('rejected-export');
    const selected = await createRootTelemetry(
      {
        sessionId: 'rejected-export',
        outfile: file,
        enabled: true,
        maxBytes: 1024 * 1024,
        maxFiles: 2,
      },
      () => ({
        logger: new RejectedLogExporter(file),
        tracer: new FileSpanExporter(file),
        meter: new FileMetricExporter(file),
      }),
    );
    roots.push(selected);
    selected.events.record(() => ({
      body: 'accepted before transport failure',
    }));
    selected.measurements.toolCall('surviving-meter', 4, true);
    expect(await errors(selected.flush())).toContain(
      'Error: accepted log export failed',
    );
    await selected.close();
    expect(readFileSync(file, 'utf8')).toContain('surviving-meter');
  });

  it('releases providers when the actual meter fails to bind instruments', async () => {
    const file = output('failed-bind');
    const starting = createRootTelemetry(
      {
        sessionId: 'failed-bind',
        outfile: file,
        enabled: true,
        maxBytes: 1024 * 1024,
        maxFiles: 2,
      },
      () => ({
        logger: new FailingLogExporter(file),
        tracer: new FailingSpanExporter(file),
        meter: new BrokenInstrumentExporter(file),
      }),
    ).then(() => undefined);
    const failures = await errors(starting);
    expect(failures).toContain('Error: metric instrument binding failed');
    expect(failures).toContain('Error: log transport shutdown failed');
    expect(failures).toContain('Error: span transport shutdown failed');
    expect(failures).toContain('Error: metric binding cleanup failed');
  });

  it('preserves startup failure and releases every allocated transport', async () => {
    const file = output('failed-start');
    const starting = createRootTelemetry(
      {
        sessionId: 'failed-start',
        outfile: file,
        enabled: true,
        maxBytes: 1024 * 1024,
        maxFiles: 2,
      },
      () => ({
        logger: new FailingLogExporter(file),
        tracer: new FailingSpanExporter(file),
        meter: new BrokenMetricExporter(),
      }),
    ).then(() => undefined);
    const failures = await errors(starting);
    expect(failures).toContain('Error: metric transport startup failed');
    expect(failures).toContain('Error: log transport shutdown failed');
    expect(failures).toContain('Error: span transport shutdown failed');
    expect(failures).toContain('Error: metric transport shutdown failed');
  });

  it('preserves export and synchronous cleanup errors while releasing the physical meter', async () => {
    const file = output('combined-failure');
    const exportError = new Error('combined accepted export failure');
    const shutdownError = new Error('combined synchronous shutdown failure');
    class CombinedLogExporter extends FileLogExporter {
      override export(
        _records: ReadableLogRecord[],
        done: (result: ExportResult) => void,
      ): void {
        done({ code: ExportResultCode.FAILED, error: exportError });
      }
      override shutdown(): Promise<void> {
        throw shutdownError;
      }
    }
    const selected = await createRootTelemetry(
      {
        sessionId: 'combined-failure',
        outfile: file,
        enabled: true,
        maxBytes: 1024 * 1024,
        maxFiles: 2,
      },
      () => ({
        logger: new CombinedLogExporter(file),
        tracer: new FileSpanExporter(file),
        meter: new FileMetricExporter(file),
      }),
    );
    selected.events.record(() => ({ body: 'accepted failing event' }));
    selected.spans.start('accepted combined span').end();
    selected.measurements.modelResponse('combined surviving meter', 3, 200);
    const [result] = await Promise.allSettled([selected.close()]);
    if (
      result.status !== 'rejected' ||
      !(result.reason instanceof AggregateError)
    )
      throw new Error('Expected combined close errors');
    expect(result.reason.errors).toContain(exportError);
    expect(result.reason.errors).toContain(shutdownError);
    expect(readFileSync(file, 'utf8')).toContain('combined surviving meter');
    expect(readFileSync(file, 'utf8')).toContain('accepted combined span');
  });

  it('surfaces both transport shutdown failures after attempting every release', async () => {
    const file = output('failed-close');
    const selected = await createRootTelemetry(
      {
        sessionId: 'failures',
        outfile: file,
        enabled: true,
        maxBytes: 1024 * 1024,
        maxFiles: 2,
      },
      () => ({
        logger: new FailingLogExporter(file),
        tracer: new FailingSpanExporter(file),
        meter: new FileMetricExporter(file),
      }),
    );
    selected.events.record(() => ({
      body: 'accepted before shutdown failures',
    }));
    selected.measurements.modelResponse('released-meter', 1, 200);
    const failures = await errors(selected.close());
    expect(failures).toContain('Error: log transport shutdown failed');
    expect(failures).toContain('Error: span transport shutdown failed');
    expect(readFileSync(file, 'utf8')).toContain('released-meter');
  });
});
