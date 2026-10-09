/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { createHash } from 'node:crypto';
import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import type { ReadableLogRecord } from '@opentelemetry/sdk-logs';
import type { ExportResult } from '@opentelemetry/core';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { Config } from '@vybestack/llxprt-code-core/config/config.js';
import { createTelemetryAdapterFromConfig } from '@vybestack/llxprt-code-core/runtime/runtimeAdapters.js';
import { FileLogExporter } from '@vybestack/llxprt-code-telemetry/telemetry/file-exporters.js';
import {
  initializeTelemetry,
  shutdownTelemetry,
  readRequestArtifact,
} from '@vybestack/llxprt-code-telemetry/telemetry/sdk.js';
import { stageTurnRequestArtifact } from '../../turn-request-artifact.js';
import { telemetryCapRow } from './telemetry-stream-fixture.js';
import { sourceHeap } from './streamprocessor-source-measurements.js';

const directory = z.string().parse(process.env.ISSUE854_CAP_MEMORY_ROOT);
const trap = process.env.ISSUE854_CAP_TRAP;
const retainedRows: IContent[] = [];
const references: Array<WeakRef<IContent>> = [];
const retainedChunks: ReadableLogRecord[] = [];
let measured = false;
let publication = '';
let peakHeap = 0;
let peakExternal = 0;
let peakRss = 0;
async function sample(): Promise<void> {
  const heap = await sourceHeap();
  const memory = process.memoryUsage();
  peakHeap = Math.max(peakHeap, heap);
  peakExternal = Math.max(peakExternal, memory.external);
  peakRss = Math.max(peakRss, memory.rss);
}
class MeasuredExporter extends FileLogExporter {
  private chunks = 0;
  override export(
    records: ReadableLogRecord[],
    callback: (result: ExportResult) => void,
  ): void {
    super.export(records, (result) => {
      for (const record of records) {
        if (record.attributes['event.name'] === 'llxprt_code.api_request')
          publication = z.string().parse(record.attributes.publication_id);
        if (
          record.attributes['event.name'] === 'llxprt_code.api_request_chunk'
        ) {
          if (measured && trap === 'chunks') retainedChunks.push(record);
          this.chunks++;
        }
      }
      if (measured && this.chunks % 256 === 0)
        void sample().then(() => callback(result));
      else callback(result);
    });
  }
}
async function stage(large = true) {
  return stageTurnRequestArtifact(
    directory,
    (async function* () {
      for (let index = 0; index < 64; index++) {
        const row = telemetryCapRow(index, large);
        if (measured) {
          references.push(new WeakRef(row));
          if (trap === 'rows') retainedRows.push(row);
        }
        yield row;
      }
    })(),
  );
}
await mkdir(directory, { recursive: true });
const output = join(directory, 'memory.jsonl');
const config = new Config({
  cwd: directory,
  targetDir: directory,
  sessionId: 'cap-memory',
  model: 'gpt-5.6',
  debugMode: false,
  telemetry: {
    enabled: true,
    logPrompts: true,
    logApiBodies: true,
    logApiBodyMaxChars: 32 * 1024 * 1024,
    outfile: output,
    outfileMaxBytes: 256 * 1024 * 1024,
  },
});
await shutdownTelemetry(config);
initializeTelemetry(config, new MeasuredExporter(output));
const adapter = createTelemetryAdapterFromConfig(config);
async function send(promptId: string, large = true): Promise<void> {
  const source = await stage(large);
  await adapter.logApiRequest({
    model: 'gpt-5.6',
    promptId,
    requestArtifact: {
      schema_version: 3,
      serialization: 'independent-safe-json-rows-v1',
      source,
    },
  });
}
async function readReceipt(
  sampled: boolean,
): Promise<{ bytes: number; sha256: string }> {
  const hash = createHash('sha256');
  let bytes = 0;
  let chunks = 0;
  for await (const chunk of readRequestArtifact(output, publication)) {
    hash.update(chunk);
    bytes += chunk.length;
    if (sampled && ++chunks % 256 === 0) await sample();
  }
  return { bytes, sha256: hash.digest('hex') };
}
try {
  await send('warm-small', false);
  await readReceipt(false);
  const baseline = await sourceHeap();
  const baselineMemory = process.memoryUsage();
  peakHeap = -Infinity;
  peakExternal = -Infinity;
  peakRss = -Infinity;
  measured = true;
  await send('measured');
  await sample();
  const receipt = await readReceipt(true);
  await sample();
  measured = false;
  const settled = await sourceHeap();
  const settledMemory = process.memoryUsage();
  const facts = {
    baseline,
    peakHeap,
    settled,
    sampledDelta: peakHeap - baseline,
    settledDelta: settled - baseline,
    baselineMemory,
    peakExternal,
    peakRss,
    settledMemory,
    externalDelta: peakExternal - baselineMemory.external,
    liveRows: references.filter((reference) => reference.deref() !== undefined)
      .length,
    retainedRows: retainedRows.length,
    retainedChunks: retainedChunks.length,
    receipt,
    publication,
  };
  await writeFile(
    join(directory, 'result.json'),
    JSON.stringify(facts, null, 2),
  );
} finally {
  await shutdownTelemetry(config);
}
