/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ExportResultCode } from '@opentelemetry/core';
import type {
  LogRecordExporter,
  ReadableLogRecord,
} from '@opentelemetry/sdk-logs';
import { createRootTelemetry, type RootTelemetry } from './root-telemetry.js';
import { ExportAcknowledgementMissingError } from './artifact-exporter.js';
import {
  assertRequestArtifactExporter,
  flushRequestArtifactTelemetry,
} from './sdk.js';
import {
  acknowledgeTerminalTelemetry,
  recordEmitter,
} from './log-record-emission.js';

const roots: RootTelemetry[] = [];
const outfile = (): string =>
  join(mkdtempSync(join(tmpdir(), 'artifact-root-')), 'events.jsonl');

async function fileRoot(file: string): Promise<RootTelemetry> {
  const selected = await createRootTelemetry({
    sessionId: 'artifact-root-session',
    enabled: true,
    outfile: file,
    maxBytes: 1048576,
    maxFiles: 2,
  });
  roots.push(selected);
  return selected;
}

const unsupportedExporter: LogRecordExporter = {
  export: (_records, done) => done({ code: ExportResultCode.SUCCESS }),
  shutdown: () => Promise.resolve(),
  forceFlush: () => Promise.resolve(),
};

describe('request artifact telemetry owned by a RootTelemetry', () => {
  afterEach(async () => {
    await Promise.all(roots.splice(0).map((selected) => selected.close()));
  });

  it('resolves an acknowledged publication only after the file exporter wrote the record', async () => {
    const file = outfile();
    const selected = await fileRoot(file);

    await flushRequestArtifactTelemetry(selected, {
      body: 'acknowledged record',
      attributes: { marker: 'ack-1' },
    });

    const written = readFileSync(file, 'utf8');
    expect(written).toContain('ack-1');
    expect(written).toContain('artifact-root-session');
  });

  it('rejects acknowledged publication when the root exporter lacks request artifact schema 4', async () => {
    const selected = await createRootTelemetry(
      {
        sessionId: 'unsupported',
        enabled: true,
        maxBytes: 1,
        maxFiles: 1,
      },
      () => ({
        tracer: {
          export: (_spans, done) => done({ code: ExportResultCode.SUCCESS }),
          shutdown: () => Promise.resolve(),
        },
        logger: unsupportedExporter,
        meter: {
          export: (_metrics, done) => done({ code: ExportResultCode.SUCCESS }),
          shutdown: () => Promise.resolve(),
          forceFlush: () => Promise.resolve(),
        },
      }),
    );
    roots.push(selected);

    expect(() => assertRequestArtifactExporter(selected)).toThrow(
      'request artifact schema 4',
    );
    await expect(
      flushRequestArtifactTelemetry(selected, { body: 'x' }),
    ).rejects.toThrow('request artifact schema 4');
  });

  it('reports artifact support without throwing: file exporter yes, schema-less exporter no', async () => {
    const supported = await fileRoot(outfile());
    const unsupported = await createRootTelemetry(
      {
        sessionId: 'unsupported-probe',
        enabled: true,
        maxBytes: 1,
        maxFiles: 1,
      },
      () => ({
        tracer: {
          export: (_spans, done) => done({ code: ExportResultCode.SUCCESS }),
          shutdown: () => Promise.resolve(),
        },
        logger: unsupportedExporter,
        meter: {
          export: (_metrics, done) => done({ code: ExportResultCode.SUCCESS }),
          shutdown: () => Promise.resolve(),
          forceFlush: () => Promise.resolve(),
        },
      }),
    );
    roots.push(unsupported);

    expect(supported.supportsRequestArtifacts()).toBe(true);
    expect(unsupported.supportsRequestArtifacts()).toBe(false);
    await supported.setEnabled(false);
    expect(supported.supportsRequestArtifacts()).toBe(false);
  });

  it('requires an active root for the exporter assertion', async () => {
    const selected = await fileRoot(outfile());
    await selected.setEnabled(false);

    expect(() => assertRequestArtifactExporter(selected)).toThrow(
      'requires an active telemetry SDK',
    );
  });

  it('publishes terminal records before running the deferred effects, per root', async () => {
    const file = outfile();
    const selected = await fileRoot(file);
    const other = await fileRoot(outfile());
    const order: string[] = [];

    const accept = await acknowledgeTerminalTelemetry(selected, () => {
      selected.events.record(() => ({
        body: 'terminal',
        attributes: { marker: 'terminal-1' },
      }));
      selected.runAfterTerminalAcknowledgement(() => order.push('effect'));
      other.runAfterTerminalAcknowledgement(() => order.push('other-now'));
    });

    expect(order).toStrictEqual(['other-now']);
    expect(readFileSync(file, 'utf8')).toContain('terminal-1');
    accept();
    expect(order).toStrictEqual(['other-now', 'effect']);
  });

  it('does not make a best-effort publication wait behind a withheld strict acknowledgement', async () => {
    const withheld: Array<() => void> = [];
    const exported: string[] = [];
    const logger: LogRecordExporter & { requestArtifactSchemaVersion: 4 } = {
      requestArtifactSchemaVersion: 4,
      export: (records: ReadableLogRecord[], done) => {
        const marker = String(records[0]?.attributes.marker);
        exported.push(marker);
        if (marker === 'withheld')
          withheld.push(() => done({ code: ExportResultCode.SUCCESS }));
        else done({ code: ExportResultCode.SUCCESS });
      },
      shutdown: () => Promise.resolve(),
      forceFlush: () => Promise.resolve(),
    };
    const selected = await createRootTelemetry(
      { sessionId: 'withheld', enabled: true, maxBytes: 1, maxFiles: 1 },
      () => ({
        tracer: {
          export: (_spans, done) => done({ code: ExportResultCode.SUCCESS }),
          shutdown: () => Promise.resolve(),
        },
        logger,
        meter: {
          export: (_metrics, done) => done({ code: ExportResultCode.SUCCESS }),
          shutdown: () => Promise.resolve(),
          forceFlush: () => Promise.resolve(),
        },
      }),
    );
    roots.push(selected);
    const abort = new AbortController();
    const strict = selected.publishAcknowledged(
      { body: 'strict', attributes: { marker: 'withheld' } },
      abort.signal,
    );
    const strictOutcome = strict.then(
      () => undefined,
      (error: unknown) => error,
    );

    await recordEmitter(
      selected,
      undefined,
      false,
    )({ body: 'eager', attributes: { marker: 'eager' } });

    expect(exported).toStrictEqual(['withheld', 'eager']);
    abort.abort(new Error('released'));
    expect(await strictOutcome).toBeInstanceOf(Error);
    for (const release of withheld) release();
  });

  it('rejects a terminal publication with more than two records', async () => {
    const selected = await fileRoot(outfile());

    await expect(
      acknowledgeTerminalTelemetry(selected, () => {
        for (let index = 0; index < 3; index++)
          selected.events.record(() => ({ body: `record-${index}` }));
      }),
    ).rejects.toThrow('exceeds two records');
  });

  it('releases root flush and close when an exporter stops making progress, without a second failure', async () => {
    const stalled: LogRecordExporter & {
      readonly requestArtifactSchemaVersion: 4;
    } = {
      requestArtifactSchemaVersion: 4,
      export: () => undefined,
      shutdown: () => Promise.resolve(),
      forceFlush: () => Promise.resolve(),
    };
    const selected = await createRootTelemetry(
      {
        sessionId: 'stalled-exporter',
        enabled: true,
        maxBytes: 1,
        maxFiles: 1,
      },
      () => ({
        tracer: {
          export: (_spans, done) => done({ code: ExportResultCode.SUCCESS }),
          shutdown: () => Promise.resolve(),
        },
        logger: stalled,
        meter: {
          export: (_metrics, done) => done({ code: ExportResultCode.SUCCESS }),
          shutdown: () => Promise.resolve(),
          forceFlush: () => Promise.resolve(),
        },
      }),
    );
    roots.push(selected);

    const abandoned = flushRequestArtifactTelemetry(selected, {
      body: 'stalled record',
    });
    await expect(abandoned).rejects.toBeInstanceOf(
      ExportAcknowledgementMissingError,
    );
    await selected.flush();
    await selected.close();
  }, 30000);

  describe('a cancelled receipt on a stalled exporter', () => {
    const stallWindowMs = 5000;
    const marginMs = 4000;

    async function stalledRoot(
      sessionId: string,
    ): Promise<{ selected: RootTelemetry; exported: Promise<void> }> {
      let reached: () => void = () => undefined;
      const exported = new Promise<void>((resolve) => {
        reached = resolve;
      });
      const stalled: LogRecordExporter & {
        readonly requestArtifactSchemaVersion: 4;
      } = {
        requestArtifactSchemaVersion: 4,
        export: () => reached(),
        shutdown: () => Promise.resolve(),
        forceFlush: () => Promise.resolve(),
      };
      const selected = await createRootTelemetry(
        { sessionId, enabled: true, maxBytes: 1, maxFiles: 1 },
        () => ({
          tracer: {
            export: (_spans, done) => done({ code: ExportResultCode.SUCCESS }),
            shutdown: () => Promise.resolve(),
          },
          logger: stalled,
          meter: {
            export: (_metrics, done) =>
              done({ code: ExportResultCode.SUCCESS }),
            shutdown: () => Promise.resolve(),
            forceFlush: () => Promise.resolve(),
          },
        }),
      );
      roots.push(selected);
      return { selected, exported };
    }

    async function cancelAfterExport(
      selected: RootTelemetry,
      exported: Promise<void>,
    ): Promise<void> {
      const cancel = new AbortController();
      const publishing = flushRequestArtifactTelemetry(
        selected,
        { body: 'cancelled record' },
        cancel.signal,
      );
      await exported;
      cancel.abort(new Error('request cancelled'));
      await expect(publishing).rejects.toThrow('request cancelled');
    }

    it('still releases flush within the stall window', async () => {
      const { selected, exported } = await stalledRoot('cancel-then-flush');
      await cancelAfterExport(selected, exported);
      const started = Date.now();
      await selected.flush();
      expect(Date.now() - started).toBeLessThan(stallWindowMs + marginMs);
    }, 12000);

    it('still releases close within the stall window', async () => {
      const { selected, exported } = await stalledRoot('cancel-then-close');
      await cancelAfterExport(selected, exported);
      const started = Date.now();
      await selected.close();
      expect(Date.now() - started).toBeLessThan(stallWindowMs + marginMs);
    }, 12000);
  });
});
