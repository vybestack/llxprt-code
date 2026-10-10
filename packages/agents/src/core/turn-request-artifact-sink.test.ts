/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { logs, type LogRecord } from '@opentelemetry/api-logs';
import { Config } from '@vybestack/llxprt-code-core/config/config.js';
import { createTelemetryAdapterFromConfig } from '@vybestack/llxprt-code-core/runtime/runtimeAdapters.js';
import type { ApiRequestEvent as RuntimeApiRequestEvent } from '@vybestack/llxprt-code-core/runtime/AgentRuntimeContext.js';
import { ApiRequestEvent } from '@vybestack/llxprt-code-telemetry/telemetry/types.js';
import { logApiRequest } from '@vybestack/llxprt-code-telemetry/telemetry/loggers.js';
import { emitRequestArtifact } from '../../../telemetry/src/telemetry/request-artifact.js';
import {
  initializeTelemetry,
  flushTelemetry,
  shutdownTelemetry,
} from '@vybestack/llxprt-code-telemetry/telemetry/sdk.js';
import { diskTextRow } from '@vybestack/llxprt-code-providers/openai-responses/__tests__/support/disk-text-fixture.js';
import { sourceRootSetup } from './__tests__/support/prompt-envelope-source-test-helpers.js';
import { stageTurnRequestArtifact } from './turn-request-artifact.js';
import { sourceHeap } from './__tests__/support/streamprocessor-source-measurements.js';
import { getRequestTextFromContents } from './turnLogging.js';

const root = sourceRootSetup();
const exportFailure = {
  abort: 'export abort',
  truncated: 'Truncated request artifact',
  digest: 'digest mismatch',
};
function config(): Config {
  return new Config({
    cwd: root(),
    targetDir: root(),
    sessionId: 'real-sink',
    model: 'gpt-5.6',
    debugMode: false,
    telemetry: {
      enabled: true,
      logPrompts: true,
      logApiBodies: true,
      outfile: join(root(), 'telemetry.jsonl'),
    },
  });
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
async function attributes(
  path: string,
): Promise<Array<Record<string, unknown>>> {
  return (await readFile(path, 'utf8'))
    .trim()
    .split('\n')
    .flatMap((line) => {
      const record: unknown = JSON.parse(line);
      return isRecord(record) && isRecord(record.attributes)
        ? [record.attributes]
        : [];
    });
}
async function artifact(large = false) {
  return stageTurnRequestArtifact(
    root(),
    (async function* () {
      for (let index = 0; index < 64; index++) yield diskTextRow(index, large);
    })(),
  );
}
function verifyChunks(
  events: Array<Record<string, unknown>>,
  bytes: Buffer,
): void {
  const chunks = events.filter(
    (event) => event['event.name'] === 'llxprt_code.api_request_chunk',
  );
  const completion = events.find(
    (event) => event['event.name'] === 'llxprt_code.api_request_complete',
  );
  if (completion === undefined)
    throw new Error('Missing complete content record');
  let offset = 0;
  for (const [index, chunk] of chunks.entries()) {
    expect(chunk.chunk_index).toBe(index);
    expect(chunk.chunk_byte_offset).toBe(offset);
    if (typeof chunk.chunk_data !== 'string') throw new Error('Missing bytes');
    const decoded = Buffer.from(chunk.chunk_data, 'base64');
    expect(decoded.length).toBeLessThanOrEqual(16384);
    expect(
      decoded.equals(bytes.subarray(offset, offset + decoded.length)),
    ).toBe(true);
    offset += decoded.length;
  }
  expect(offset).toBe(bytes.length);
  expect(completion).toMatchObject({
    content_complete: true,
    content_bytes: bytes.length,
    row_count: 64,
    chunk_count: chunks.length,
    content_sha256: createHash('sha256').update(bytes).digest('hex'),
  });
}

describe('actual file exporter accepts turn artifacts below legacy adapter', () => {
  it.each([false, true])(
    'exports every ordered byte and completion, oversized=%s',
    async (large) => {
      const active = config();
      initializeTelemetry(active);
      try {
        const staged = await artifact(large);
        await logApiRequest(
          active,
          new ApiRequestEvent('gpt-5.6', 'direct-turn', undefined, staged),
        );
        await flushTelemetry();
        const events = await attributes(join(root(), 'telemetry.jsonl'));
        verifyChunks(events, await readFile(staged.artifact_path));
        expect(
          events.find(
            (event) => event['event.name'] === 'llxprt_code.api_request',
          ),
        ).toMatchObject({
          'event.name': 'llxprt_code.api_request',
          prompt_id: 'direct-turn',
          request_chars: staged.content_chars,
        });
        expect(events.every((event) => !('artifact_path' in event))).toBe(true);
      } finally {
        await shutdownTelemetry(active);
      }
    },
    60000,
  );
});

describe('actual agent artifact protocol', () => {
  it('awaits versioned artifact completion at the runtime adapter', async () => {
    const active = config();
    initializeTelemetry(active);
    try {
      const staged = await artifact();
      const widerEvent: RuntimeApiRequestEvent = {
        model: 'gpt-5.6',
        promptId: 'adapter-turn',
        requestArtifact: {
          schema_version: 3,
          serialization: 'independent-safe-json-rows-v1',
          source: staged,
        },
      };
      const returned =
        createTelemetryAdapterFromConfig(active).logApiRequest(widerEvent);
      await returned;
      await flushTelemetry();
      const events = await attributes(join(root(), 'telemetry.jsonl'));
      expect(
        events.filter(
          (event) => event['event.name'] === 'llxprt_code.api_request',
        ),
      ).toHaveLength(1);
      expect(
        events.find(
          (event) => event['event.name'] === 'llxprt_code.api_request',
        )?.request_chars,
      ).toBe(staged.content_chars);
      expect(events.some((event) => event.content_complete === true)).toBe(
        true,
      );
      expect(
        events.some((event) => event.artifact_id === staged.artifact_id),
      ).toBe(true);
    } finally {
      await shutdownTelemetry(active);
    }
  });
});

describe('actual artifact export failure cleanup', () => {
  it.each(['abort', 'truncated', 'digest'] as const)(
    'never publishes completion for %s artifact export',
    async (mode) => {
      const active = config();
      initializeTelemetry(active);
      try {
        const staged = await artifact();
        const controller = new AbortController();
        if (mode === 'abort') controller.abort(new Error('export abort'));
        if (mode === 'truncated') await writeFile(staged.artifact_path, '[');
        const input =
          mode === 'digest'
            ? { ...staged, content_sha256: '0'.repeat(64) }
            : staged;
        await expect(
          logApiRequest(
            active,
            new ApiRequestEvent('gpt-5.6', 'bad-turn', undefined, input),
            controller.signal,
          ),
        ).rejects.toThrow(exportFailure[mode]);
        await flushTelemetry();
        expect(
          (await attributes(join(root(), 'telemetry.jsonl'))).some(
            (event) => event.content_complete === true,
          ),
        ).toBe(false);
      } finally {
        await shutdownTelemetry(active);
      }
    },
  );
});

describe('legacy string and descriptor protocols differ', () => {
  it('measures the legacy body cap rather than treating chunks as the same enabled event', async () => {
    const active = config();
    initializeTelemetry(active);
    try {
      const rows = Array.from({ length: 64 }, (_, index) =>
        diskTextRow(index, false),
      );
      const text = getRequestTextFromContents(rows);
      await createTelemetryAdapterFromConfig(active).logApiRequest({
        model: 'gpt-5.6',
        promptId: 'legacy-capped',
        requestText: text,
      });
      await flushTelemetry();
      const events = await attributes(join(root(), 'telemetry.jsonl'));
      const request = events.find(
        (event) => event.prompt_id === 'legacy-capped',
      );
      expect(request?.request_chars).toBe(text.length);
      expect(request?.request_text).toBe(
        text.slice(0, active.getTelemetryLogApiBodyMaxChars()),
      );
      expect(text.length).toBeGreaterThan(
        active.getTelemetryLogApiBodyMaxChars(),
      );
      expect(events.some((event) => event.content_complete === true)).toBe(
        false,
      );
    } finally {
      await shutdownTelemetry(active);
    }
  });
});

describe('request-wide identity protocol', () => {
  it('exposes cross-row identity semantics that a row-local writer cannot claim to preserve', async () => {
    const shared = diskTextRow(0, false);
    const staged = await stageTurnRequestArtifact(
      root(),
      (async function* () {
        yield shared;
        yield shared;
      })(),
    );
    const text = await readFile(staged.artifact_path, 'utf8');
    const legacy = getRequestTextFromContents([shared, shared]);
    expect(text).not.toBe(legacy);
    expect(legacy).toContain('"[Circular]"');
    expect(JSON.parse(text)).toHaveLength(2);
  });
});

async function measureChunkSinkRelease(trap: boolean) {
  const active = config();
  initializeTelemetry(active);
  const retained: LogRecord[] = [];
  try {
    const staged = await artifact(true);
    await flushTelemetry();
    const baseline = await sourceHeap();
    const logger = logs.getLogger('llxprt-code');
    await emitRequestArtifact(
      staged,
      { 'event.name': 'llxprt_code.api_request', prompt_id: 'sink-release' },
      (record) => {
        if (trap) retained.push(record);
        logger.emit(record);
      },
    );
    const settled = await sourceHeap();
    const delta = settled - baseline;
    if (trap) return { delta, retained };
    verifyChunks(
      await attributes(join(root(), 'telemetry.jsonl')),
      await readFile(staged.artifact_path),
    );
    return { delta, retained };
  } finally {
    await shutdownTelemetry(active);
  }
}

describe('actual chunk sink release', () => {
  it('releases exported chunk strings below strict 1 MiB with the retaining-sink trap unchanged', async () => {
    const facts = await measureChunkSinkRelease(false);
    expect(facts.delta).toBeLessThan(1_048_576);
    expect(facts.retained).toHaveLength(0);
  }, 60000);
  it('trap: a sink that retains exported records fails the release gate', async () => {
    const facts = await measureChunkSinkRelease(true);
    expect(() => expect(facts.retained).toHaveLength(0)).toThrow(
      'Expected length: 0',
    );
  }, 60000);
});
