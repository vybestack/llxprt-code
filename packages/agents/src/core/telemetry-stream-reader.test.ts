/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { Config } from '@vybestack/llxprt-code-core/config/config.js';
import { createTelemetryAdapterFromConfig } from '@vybestack/llxprt-code-core/runtime/runtimeAdapters.js';
import {
  shutdownTelemetry,
  readRequestArtifact,
} from '@vybestack/llxprt-code-telemetry/telemetry/sdk.js';
import { sourceRootSetup } from './prompt-envelope-source-test-helpers.js';
import { stageTurnRequestArtifact } from './turn-request-artifact.js';
import { diskTextRow } from '@vybestack/llxprt-code-providers/openai-responses/disk-text-fixture.js';
import { getRequestTextFromContents } from './turnLogging.js';

const root = sourceRootSetup();
const recordSchema = z
  .object({ attributes: z.record(z.unknown()) })
  .passthrough();
async function published() {
  const path = join(root(), 'reader.jsonl');
  const config = new Config({
    cwd: root(),
    targetDir: root(),
    sessionId: 'reader',
    model: 'gpt-5.6',
    debugMode: false,
    telemetry: {
      enabled: true,
      logPrompts: true,
      logApiBodies: true,
      logApiBodyMaxChars: 32 * 1024 * 1024,
      outfile: path,
    },
  });
  try {
    const source = await stageTurnRequestArtifact(
      root(),
      (async function* () {
        for (let index = 0; index < 64; index++) yield diskTextRow(index, true);
      })(),
    );
    await createTelemetryAdapterFromConfig(config).logApiRequest({
      model: 'gpt-5.6',
      promptId: 'reader',
      requestArtifact: {
        schema_version: 3,
        serialization: 'independent-safe-json-rows-v1',
        source,
      },
    });
  } finally {
    await shutdownTelemetry(config);
  }
  const records = (await readFile(path, 'utf8'))
    .trim()
    .split('\n')
    .flatMap((line) => {
      const value = z
        .object({ attributes: z.record(z.unknown()).optional() })
        .passthrough()
        .parse(JSON.parse(line));
      return value.attributes === undefined ? [] : [recordSchema.parse(value)];
    });
  const header = records.find(
    (record) => record.attributes['event.name'] === 'llxprt_code.api_request',
  );
  return {
    path,
    records,
    publication: z.string().parse(header?.attributes.publication_id),
  };
}
async function receipt(
  path: string,
  publication: string,
  signal?: AbortSignal,
): Promise<{ bytes: number; digest: string }> {
  const hash = createHash('sha256');
  let bytes = 0;
  for await (const chunk of readRequestArtifact(path, publication, signal)) {
    expect(chunk.length).toBeLessThanOrEqual(16384);
    hash.update(chunk);
    bytes += chunk.length;
  }
  return { bytes, digest: hash.digest('hex') };
}
describe('production bounded FileLogExporter reader', () => {
  it('streams all JSON string bytes without reconstructing scalar text', async () => {
    const result = await published();
    const oracle = Buffer.from(
      JSON.stringify(
        getRequestTextFromContents(
          Array.from({ length: 64 }, (_, index) => diskTextRow(index, true)),
        ),
      ),
    );
    expect(await receipt(result.path, result.publication)).toStrictEqual({
      bytes: oracle.length,
      digest: createHash('sha256').update(oracle).digest('hex'),
    });
  }, 120000);
});

describe('bounded artifact reader rejects incomplete and corrupt publications', () => {
  it.each([
    'corrupt',
    'missing',
    'reorder',
    'abort',
    'chars',
    'reader-abort',
    'unknown',
  ] as const)(
    'rejects %s instead of returning successful completion',
    async (mode) => {
      const result = await published();
      const chunkIndex = result.records.findIndex(
        (record) =>
          record.attributes['event.name'] === 'llxprt_code.api_request_chunk',
      );
      const chunk = result.records[chunkIndex];
      const data = Buffer.from(
        z.string().parse(chunk.attributes.chunk_data),
        'base64',
      );
      data[10] ^= 1;
      const altered = result.records.flatMap((record, index) => {
        if (
          mode === 'missing' &&
          record.attributes['event.name'] === 'llxprt_code.api_request_complete'
        )
          return [];
        const attributes = {
          ...record.attributes,
          ...(mode === 'corrupt' && index === chunkIndex
            ? { chunk_data: data.toString('base64') }
            : {}),
          ...(mode === 'reorder' && index === chunkIndex
            ? { chunk_index: 10 }
            : {}),
          ...(mode === 'abort' &&
          record.attributes['event.name'] === 'llxprt_code.api_request_complete'
            ? { 'event.name': 'llxprt_code.api_request_abort' }
            : {}),
          ...(mode === 'chars' ? { visible_chars: 1 } : {}),
        };
        return [{ ...record, attributes }];
      });
      await writeFile(
        result.path,
        altered.map((record) => JSON.stringify(record)).join('\n') + '\n',
      );
      const controller = new AbortController();
      if (mode === 'reader-abort') controller.abort(new Error('reader abort'));
      await expect(
        receipt(
          result.path,
          mode === 'unknown' ? 'unknown' : result.publication,
          controller.signal,
        ),
      ).rejects.toThrow(
        {
          corrupt: 'digest',
          missing: 'Truncated request artifact publication',
          reorder: 'sequence',
          abort: 'Aborted',
          chars: 'counts',
          'reader-abort': 'reader abort',
          unknown: 'Missing request artifact completion',
        }[mode],
      );
    },
    120000,
  );
});
