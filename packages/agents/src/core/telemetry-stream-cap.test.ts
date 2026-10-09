/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { Config } from '@vybestack/llxprt-code-core/config/config.js';
import { createTelemetryAdapterFromConfig } from '@vybestack/llxprt-code-core/runtime/runtimeAdapters.js';
import {
  initializeTelemetry,
  shutdownTelemetry,
  type RuntimeRequestArtifact,
} from '@vybestack/llxprt-code-telemetry/telemetry/sdk.js';
import { telemetryCapRow } from './__tests__/support/telemetry-stream-fixture.js';
import { diskTextRow } from '@vybestack/llxprt-code-providers/openai-responses/__tests__/support/disk-text-fixture.js';
import { sourceRootSetup } from './__tests__/support/prompt-envelope-source-test-helpers.js';
import { stageTurnRequestArtifact } from './turn-request-artifact.js';
import { getRequestTextFromContents } from './turnLogging.js';

const root = sourceRootSetup();
const cap32 = 32 * 1024 * 1024;
const recordSchema = z.object({ attributes: z.record(z.unknown()) });
const hash = (bytes: string | Buffer): string =>
  createHash('sha256').update(bytes).digest('hex');
function config(cap?: number): Config {
  return new Config({
    cwd: root(),
    targetDir: root(),
    sessionId: 'cap32',
    model: 'gpt-5.6',
    debugMode: false,
    telemetry: {
      enabled: true,
      logPrompts: true,
      logApiBodies: true,
      ...(cap === undefined ? {} : { logApiBodyMaxChars: cap }),
      outfile: join(root(), 'cap.jsonl'),
      outfileMaxBytes: 256 * 1024 * 1024,
    },
  });
}
async function staged(large: boolean): Promise<RuntimeRequestArtifact> {
  return {
    schema_version: 3,
    serialization: 'independent-safe-json-rows-v1',
    source: await stageTurnRequestArtifact(
      root(),
      (async function* () {
        for (let index = 0; index < 64; index++)
          yield telemetryCapRow(index, large);
      })(),
    ),
  };
}
async function records(): Promise<Array<Record<string, unknown>>> {
  return (await readFile(join(root(), 'cap.jsonl'), 'utf8'))
    .trim()
    .split('\n')
    .map((line) => recordSchema.parse(JSON.parse(line)).attributes)
    .filter((record) =>
      String(record['event.name']).startsWith('llxprt_code.api_request'),
    );
}
function verify(
  events: Array<Record<string, unknown>>,
  text: string,
  source: RuntimeRequestArtifact,
  prompt: string,
): void {
  const bytes = Buffer.from(JSON.stringify(text));
  const header = events[0];
  expect(header).toMatchObject({
    schema_version: 4,
    request_text_protocol: 'json-string-chunks-v1',
    'event.name': 'llxprt_code.api_request',
    prompt_id: prompt,
    model: 'gpt-5.6',
    'session.id': 'cap32',
    request_chars: source.source.content_chars,
    content_chars: source.source.content_chars,
    row_count: source.source.row_count,
    content_sha256: source.source.content_sha256,
    visible_chars: text.length,
    visible_bytes: bytes.length,
    visible_sha256: hash(bytes),
    truncated: text.length < source.source.content_chars,
  });
  expect(header.request_text).toBeUndefined();
  const chunks = events.filter(
    (record) => record['event.name'] === 'llxprt_code.api_request_chunk',
  );
  let offset = 0;
  for (const [index, chunk] of chunks.entries()) {
    const decoded = Buffer.from(z.string().parse(chunk.chunk_data), 'base64');
    expect(chunk).toMatchObject({
      chunk_index: index,
      chunk_byte_offset: offset,
      publication_id: header.publication_id,
      prompt_id: prompt,
    });
    expect(decoded.length).toBeLessThanOrEqual(16384);
    expect(
      decoded.equals(bytes.subarray(offset, offset + decoded.length)),
    ).toBe(true);
    offset += decoded.length;
  }
  expect(offset).toBe(bytes.length);
  expect(events[events.length - 1]).toMatchObject({
    'event.name': 'llxprt_code.api_request_complete',
    content_complete: true,
    chunk_count: chunks.length,
    visible_sha256: hash(bytes),
  });
  expect(events.every((record) => !('artifact_path' in record))).toBe(true);
}

describe('real Config SDK FileLogExporter chunk-only cap contract', () => {
  it.each([false, true])(
    'preserves every legacy visible JSON string byte at 32MiB, large=%s',
    async (large) => {
      const active = config(cap32);
      const source = await staged(large);
      const oracle = getRequestTextFromContents(
        Array.from({ length: 64 }, (_, index) => telemetryCapRow(index, large)),
      ).slice(0, cap32);
      initializeTelemetry(active);
      try {
        await createTelemetryAdapterFromConfig(active).logApiRequest({
          model: 'gpt-5.6',
          promptId: 'full-cap',
          requestArtifact: source,
        });
        verify(await records(), oracle, source, 'full-cap');
        expect(source.source.row_count).toBe(64);
        expect(oracle.length).toBe(large ? cap32 : source.source.content_chars);
        expect(source.source.content_bytes).toBeGreaterThan(
          large ? cap32 : 4000,
        );
      } finally {
        await shutdownTelemetry(active);
      }
    },
    120000,
  );
  it('uses the unchanged default 4000-character cap', async () => {
    const active = config();
    const source = await staged(true);
    const oracle = getRequestTextFromContents(
      Array.from({ length: 64 }, (_, index) => telemetryCapRow(index, true)),
    ).slice(0, 4000);
    initializeTelemetry(active);
    try {
      expect(active.getTelemetryLogApiBodyMaxChars()).toBe(4000);
      await createTelemetryAdapterFromConfig(active).logApiRequest({
        model: 'gpt-5.6',
        promptId: 'default',
        requestArtifact: source,
      });
      verify(await records(), oracle, source, 'default');
    } finally {
      await shutdownTelemetry(active);
    }
  }, 120000);
});

describe('chunk protocol UTF16 cap fidelity', () => {
  it.each([1, 2, 3, 16383, 16384, 16385])(
    'retains exact UTF16 split at cap %s',
    async (cap) => {
      const text = '🌊雪\n"\\\u0000'.repeat(6000);
      const path = join(root(), 'unicode');
      await writeFile(path, text);
      const source: RuntimeRequestArtifact = {
        schema_version: 3,
        serialization: 'legacy-request-text-v1',
        source: {
          schema_version: 2,
          artifact_id: 'unicode',
          artifact_path: path,
          content_offset: 0,
          content_bytes: Buffer.byteLength(text),
          content_chars: text.length,
          content_sha256: hash(text),
          row_count: 0,
        },
      };
      const active = config(cap);
      initializeTelemetry(active);
      try {
        await createTelemetryAdapterFromConfig(active).logApiRequest({
          model: 'gpt-5.6',
          promptId: 'unicode',
          requestArtifact: source,
        });
        const events = await records();
        expect(events[0].visible_chars).toBe(cap);
        verify(events, text.slice(0, cap), source, 'unicode');
      } finally {
        await shutdownTelemetry(active);
      }
    },
  );
});

describe('concurrent full-cap publication identities', () => {
  it('correlates two concurrent full-cap attempts with distinct prompt identities', async () => {
    const active = config(cap32);
    const source = await staged(true);
    const oracle = getRequestTextFromContents(
      Array.from({ length: 64 }, (_, index) => telemetryCapRow(index, true)),
    ).slice(0, cap32);
    initializeTelemetry(active);
    try {
      const adapter = createTelemetryAdapterFromConfig(active);
      await Promise.all(
        ['first', 'second'].map((promptId) =>
          adapter.logApiRequest({
            model: 'gpt-5.6',
            promptId,
            requestArtifact: source,
          }),
        ),
      );
      const events = await records();
      for (const prompt of ['first', 'second'])
        verify(
          events.filter((record) => record.prompt_id === prompt),
          oracle,
          source,
          prompt,
        );
      const headers = events.filter(
        (record) => record['event.name'] === 'llxprt_code.api_request',
      );
      expect(headers[0].publication_id).not.toBe(headers[1].publication_id);
    } finally {
      await shutdownTelemetry(active);
    }
  }, 120000);
});

describe('oversized row inside the configured visible prefix', () => {
  it('exports the complete >10MiB row when all 64 rows fit cap32', async () => {
    const active = config(cap32);
    const source: RuntimeRequestArtifact = {
      schema_version: 3,
      serialization: 'independent-safe-json-rows-v1',
      source: await stageTurnRequestArtifact(
        root(),
        (async function* () {
          for (let index = 0; index < 64; index++)
            yield diskTextRow(index, true);
        })(),
      ),
    };
    const fullLegacyVisiblePrefix = getRequestTextFromContents(
      Array.from({ length: 64 }, (_, index) => diskTextRow(index, true)),
    ).slice(0, cap32);
    try {
      await createTelemetryAdapterFromConfig(active).logApiRequest({
        model: 'gpt-5.6',
        promptId: 'oversized-visible',
        requestArtifact: source,
      });
      const events = await records();
      expect(events[0].truncated).toBe(false);
      expect(fullLegacyVisiblePrefix.length).toBeGreaterThan(10 * 1024 * 1024);
      verify(events, fullLegacyVisiblePrefix, source, 'oversized-visible');
    } finally {
      await shutdownTelemetry(active);
    }
  }, 120000);
});
