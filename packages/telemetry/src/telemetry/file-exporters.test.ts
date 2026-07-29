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
} from '@opentelemetry/sdk-trace-base';
import { FileSpanExporter } from './file-exporters.js';

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
