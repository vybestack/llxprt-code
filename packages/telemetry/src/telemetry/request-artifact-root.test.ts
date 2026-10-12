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
import type { LogRecordExporter } from '@opentelemetry/sdk-logs';
import { createRootTelemetry, type RootTelemetry } from './root-telemetry.js';
import { logBoundedRequestArtifact } from './bounded-request-artifact.js';
import {
  assertRequestArtifactExporter,
  flushRequestArtifactTelemetry,
} from './sdk.js';
import { acknowledgeTerminalTelemetry } from './log-record-emission.js';

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

    expect(order).toEqual(['other-now']);
    expect(readFileSync(file, 'utf8')).toContain('terminal-1');
    accept();
    expect(order).toEqual(['other-now', 'effect']);
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

  it('logs a plain api request event when bodies are not opted in', async () => {
    const file = outfile();
    const selected = await fileRoot(file);
    const artifact = {
      schema_version: 3,
      serialization: 'independent-safe-json-rows-v1',
      source: {
        schema_version: 2,
        artifact_id: 'a',
        artifact_path: '/nonexistent/never-read',
        content_offset: 0,
        content_bytes: 2,
        content_chars: 2,
        content_sha256: 'a'.repeat(64),
        row_count: 1,
      },
    } as const;

    await logBoundedRequestArtifact(
      selected,
      'artifact-root-session',
      'model-x',
      'prompt-1',
      artifact,
    );
    await selected.flush();

    const written = readFileSync(file, 'utf8');
    expect(written).toContain('API request to model-x.');
    expect(written).not.toContain('chunk_data');
  });

  it('refuses bounded request artifacts while the root is disabled', async () => {
    const selected = await fileRoot(outfile());
    await selected.setEnabled(false);

    await expect(
      logBoundedRequestArtifact(
        selected,
        'artifact-root-session',
        'model-x',
        'prompt-1',
        {
          schema_version: 3,
          serialization: 'legacy-request-text-v1',
          source: {
            schema_version: 2,
            artifact_id: 'a',
            artifact_path: '/nonexistent/never-read',
            content_offset: 0,
            content_bytes: 2,
            content_chars: 2,
            content_sha256: 'b'.repeat(64),
            row_count: 1,
          },
        },
      ),
    ).rejects.toThrow('requires an active telemetry SDK');
  });
});
